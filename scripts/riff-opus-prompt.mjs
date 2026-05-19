#!/usr/bin/env node
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import {
  artifactPath,
  detectScope,
  normalizePhase,
  readIfExists,
  readText,
  toPosix,
  writeText,
} from './lib/artifacts.mjs';

process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

const ROOT = process.cwd();
const MAX_ARTIFACT_CHARS = 4000;
const MAX_CONTRACT_CHARS = 7000;
const MAX_CHANGED_FILE_CHARS = 20000;
const MAX_GIT_DIFF_CHARS = 12000;
const UNTRACKED_CONTEXT_PREFIXES = [
  '.planning/',
  'adapters/',
  'core/',
  'docs/',
  'scripts/',
];

const CAPABILITIES = {
  start: {
    prompt: 'start.md',
    tier: 'focused',
    phaseRequired: false,
    expectedOutput: 'Project-start guidance, ROADMAP.yaml-compatible draft, and first PLAN.md-compatible phase plan when enough context exists',
  },
  'phase-plan': {
    prompt: 'phase-plan.md',
    tier: 'focused',
    phaseRequired: true,
    expectedOutput: '.planning/phases/<phase>/PLAN.md-compatible content',
  },
  'architecture-review': {
    prompt: 'architecture-review.md',
    tier: 'focused',
    phaseRequired: true,
    expectedOutput: '.planning/phases/<phase>/ARCHITECTURE-REVIEW.md manual review content and PLAN.md-compatible revision guidance',
  },
};

function usage(exitCode = 0) {
  const commands = Object.keys(CAPABILITIES).join(', ');
  const text = `RIFF Opus prompt generator

Usage:
  node scripts/riff-opus-prompt.mjs <command> [options]

Commands:
  ${commands}

Options:
  --phase <id-or-path>       Required for phase-plan and architecture-review
  --scope <production|scratch>
  --print                    Print generated prompt pack
  --context-out <path>       Write generated prompt pack to a file
  --run-claude               Send the generated prompt to Claude Code with -p
  --yes                      Confirm the explicit programmatic Opus run
  --response-out <path>      Write Claude output to a file
  --claude-bin <name>        Claude executable; defaults to CLAUDE_BIN or claude
  --model <name>             Claude model alias; defaults to opus
  -h, --help                 Show help

Default mode only prints or writes a manual prompt. --run-claude requires --yes or RIFF_OPUS_ALLOW_PROGRAMMATIC=1.
`;
  process.stdout.write(text);
  process.exit(exitCode);
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    command: undefined,
    phase: undefined,
    scope: undefined,
    print: false,
    contextOut: undefined,
    runClaude: false,
    yes: false,
    responseOut: undefined,
    claudeBin: process.env.CLAUDE_BIN || 'claude',
    model: 'opus',
  };

  function readOptionValue(option, index) {
    const value = argv[index + 1];
    if (!value || value.startsWith('-')) {
      fail(`${option} requires a value`);
    }
    return value;
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-h' || token === '--help') usage(0);
    if (!args.command && !token.startsWith('-')) {
      args.command = token;
      continue;
    }
    if (token === '--phase') {
      args.phase = readOptionValue(token, index);
      index += 1;
      continue;
    }
    if (token === '--scope') {
      args.scope = readOptionValue(token, index);
      index += 1;
      continue;
    }
    if (token === '--print') {
      args.print = true;
      continue;
    }
    if (token === '--context-out') {
      args.contextOut = readOptionValue(token, index);
      index += 1;
      continue;
    }
    if (token === '--run-claude') {
      args.runClaude = true;
      continue;
    }
    if (token === '--yes') {
      args.yes = true;
      continue;
    }
    if (token === '--response-out') {
      args.responseOut = readOptionValue(token, index);
      index += 1;
      continue;
    }
    if (token === '--claude-bin') {
      args.claudeBin = readOptionValue(token, index);
      index += 1;
      continue;
    }
    if (token === '--model') {
      args.model = readOptionValue(token, index);
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${token}`);
  }

  if (!args.command) usage(1);
  if (!Object.prototype.hasOwnProperty.call(CAPABILITIES, args.command)) {
    fail(`Unknown command: ${args.command}`);
  }
  if (args.scope && args.scope !== 'production' && args.scope !== 'scratch') {
    fail('--scope must be production or scratch');
  }
  if (CAPABILITIES[args.command].phaseRequired && !args.phase) {
    fail(`--phase is required for ${args.command}`);
  }
  if (args.responseOut && !args.runClaude) {
    fail('--response-out requires --run-claude');
  }
  if (args.yes && !args.runClaude) {
    fail('--yes requires --run-claude');
  }
  if (!args.print && !args.contextOut && !args.runClaude) {
    args.print = true;
  }
  return args;
}

function truncateText(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n\n[excerpt truncated; read or provide the file directly before acting]`;
}

function artifactBlock(relativePath, maxChars = MAX_ARTIFACT_CHARS) {
  const normalized = toPosix(relativePath);
  const artifact = readIfExists(ROOT, normalized);
  if (!artifact.exists) {
    return `## ${normalized}\n\nStatus: missing\n`;
  }
  return `## ${normalized}\n\nStatus: present\n\n\`\`\`markdown\n${truncateText(artifact.text, maxChars)}\n\`\`\`\n`;
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) {
    return {
      ok: false,
      text: result.error.message,
    };
  }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
  return {
    ok: result.status === 0,
    text: output,
  };
}

function listFilesUnder(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  if (!existsSync(absolutePath)) return [];
  const stat = statSync(absolutePath);
  if (stat.isFile()) return [toPosix(relativePath)];
  if (!stat.isDirectory()) return [];

  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absoluteEntry = path.join(dir, entry.name);
      const relativeEntry = toPosix(path.relative(ROOT, absoluteEntry));
      if (entry.isDirectory()) {
        walk(absoluteEntry);
        continue;
      }
      if (entry.isFile()) {
        files.push(relativeEntry);
      }
    }
  };
  walk(absolutePath);
  return files.sort();
}

function parseStatusEntries(statusText) {
  if (!statusText) return [];
  const entries = [];
  for (const line of statusText.split('\n')) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const normalizedPath = rawPath.includes(' -> ')
      ? rawPath.split(' -> ').at(-1)
      : rawPath;
    entries.push({ code, line, path: normalizedPath });
  }
  return entries;
}

function isAllowedUntrackedContextPath(relativePath) {
  return UNTRACKED_CONTEXT_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

function changedPathsFromStatus(statusText) {
  const paths = [];
  for (const entry of parseStatusEntries(statusText)) {
    if (entry.code === '??' && !isAllowedUntrackedContextPath(entry.path)) {
      continue;
    }
    paths.push(...listFilesUnder(entry.path));
  }
  return [...new Set(paths)].sort();
}

function trackedChangedPathsFromStatus(statusText) {
  const paths = [];
  for (const entry of parseStatusEntries(statusText)) {
    if (entry.code === '??') continue;
    paths.push(...listFilesUnder(entry.path));
  }
  return [...new Set(paths)].sort();
}

function statusTextForContext(statusText) {
  const lines = [];
  let omittedUntrackedCount = 0;
  for (const entry of parseStatusEntries(statusText)) {
    if (entry.code === '??' && !isAllowedUntrackedContextPath(entry.path)) {
      omittedUntrackedCount += 1;
      continue;
    }
    lines.push(entry.line);
  }
  if (omittedUntrackedCount > 0) {
    const plural = omittedUntrackedCount === 1 ? 'path' : 'paths';
    lines.push(`[omitted ${omittedUntrackedCount} unrelated untracked ${plural}]`);
  }
  return lines.length > 0 ? lines.join('\n') : 'clean';
}

function isSensitivePath(relativePath) {
  const basename = path.basename(relativePath).toLowerCase();
  return basename === '.env'
    || basename.startsWith('.env.')
    || basename.endsWith('.key')
    || basename.endsWith('.pem')
    || basename.endsWith('.p12')
    || basename.endsWith('.pfx')
    || relativePath.includes('/.ssh/')
    || relativePath.includes('/secrets/');
}

function changedFileBlocks(statusText) {
  const files = changedPathsFromStatus(statusText)
    .filter((file) => !isSensitivePath(file))
    .filter((file) => /\.(md|mjs|js|json|yaml|yml|txt)$/.test(file));
  if (files.length === 0) {
    return '## Changed File Excerpts\n\nStatus: none\n';
  }
  return [
    '## Changed File Excerpts',
    '',
    ...files.map((file) => artifactBlock(file, MAX_CHANGED_FILE_CHARS)),
  ].join('\n');
}

function gitDiffForStatus(statusText, stat = false) {
  const files = trackedChangedPathsFromStatus(statusText)
    .filter((file) => !isSensitivePath(file));
  if (files.length === 0) return 'none';

  const args = stat
    ? ['diff', '--stat', '--', ...files]
    : ['diff', '--', ...files];
  const result = commandOutput('git', args);
  return result.text || 'none';
}

function readContract(relativePath, maxChars = MAX_CONTRACT_CHARS) {
  return `## ${relativePath}\n\n\`\`\`markdown\n${truncateText(readText(ROOT, relativePath), maxChars)}\n\`\`\`\n`;
}

function renderTemplate(text, phase) {
  if (!phase) return text;
  return text
    .replaceAll('<phase>', phase.id)
    .replaceAll('<phaseDir>', phase.dir);
}

function extractSection(text, heading) {
  const start = text.indexOf(heading);
  if (start === -1) return '';
  const next = text.indexOf('\n## ', start + heading.length);
  return text.slice(start, next === -1 ? text.length : next).trim();
}

function phaseArtifactContract(command) {
  const text = readText(ROOT, 'core/schemas/phase-artifacts.md');
  const sections = [
    extractSection(text, '## `ROADMAP.yaml`'),
    extractSection(text, '## `.planning/config.json`'),
    extractSection(text, '## `.planning/phases/<N-slug>/PLAN.md`'),
  ];
  if (command === 'architecture-review') {
    sections.push(extractSection(text, '## `.planning/phases/<N-slug>/PLAN-REVIEW.md`'));
  }
  return `## core/schemas/phase-artifacts.md\n\n\`\`\`markdown\n${sections.filter(Boolean).join('\n\n')}\n\`\`\`\n`;
}

function adapterEscalationContract() {
  const text = readText(ROOT, 'core/protocols/adapter-contract.md');
  const excerpt = [
    'Adapters may name the escalation capability `opus-prompt` when the target workflow is specifically an Opus prompt pack. Core treats it as an escalation prompt, not as a required executor.',
    extractSection(text, '`escalation-prompt`:'),
    'Manual escalation adapters may implement only `escalation-prompt` or `opus-prompt`. They are valid for planning and review assistance but are not full executors unless they also satisfy the execution, gate, and state capabilities.',
    extractSection(text, '## Provider Neutrality Rules'),
    extractSection(text, '## Context Pack Requirement'),
  ].filter(Boolean).join('\n\n');
  return `## core/protocols/adapter-contract.md\n\n\`\`\`markdown\n${excerpt}\n\`\`\`\n`;
}

function listMarkdownFiles(relativeDir) {
  const absoluteDir = path.resolve(ROOT, relativeDir);
  if (!existsSync(absoluteDir)) return [];

  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const absoluteEntry = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absoluteEntry);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(toPosix(path.relative(ROOT, absoluteEntry)));
      }
    }
  };
  walk(absoluteDir);
  return files.sort();
}

function roadmapBlock(phase) {
  const artifact = readIfExists(ROOT, 'ROADMAP.yaml');
  if (!artifact.exists || !phase) {
    return artifactBlock('ROADMAP.yaml');
  }

  const matchIndex = artifact.text.indexOf(phase.id);
  if (matchIndex === -1 || artifact.text.length <= MAX_ARTIFACT_CHARS) {
    return artifactBlock('ROADMAP.yaml');
  }

  const start = Math.max(0, matchIndex - 1200);
  const end = Math.min(artifact.text.length, matchIndex + 2800);
  const excerpt = artifact.text.slice(start, end);
  return `## ROADMAP.yaml\n\nStatus: present\n\n\`\`\`yaml\n[excerpt around ${phase.id}]\n${excerpt}\n\`\`\`\n`;
}

function designDocBlocks() {
  const files = listMarkdownFiles('.planning/design');
  if (files.length === 0) {
    return '## .planning/design\n\nStatus: missing or empty\n';
  }
  return files
    .map((file) => artifactBlock(file, 2500))
    .join('\n');
}

function phaseArtifactBlocks(phase) {
  const files = [
    artifactPath(phase.dir, 'PLAN.md'),
    artifactPath(phase.dir, 'PLAN-REVIEW.md'),
    artifactPath(phase.dir, 'SUMMARY.md'),
    artifactPath(phase.dir, 'HANDOFF.md'),
    artifactPath(phase.dir, 'GATES.md'),
  ];
  return files.map((file) => artifactBlock(file)).join('\n');
}

function gitBranchHint() {
  const gitHeadPath = path.resolve(ROOT, '.git', 'HEAD');
  if (!existsSync(gitHeadPath)) return 'unknown';
  const head = readText(ROOT, '.git/HEAD').trim();
  return head.startsWith('ref: refs/heads/') ? head.replace('ref: refs/heads/', '') : head;
}

function fileSizeHint(relativePath) {
  const absolutePath = path.resolve(ROOT, relativePath);
  if (!existsSync(absolutePath)) return 'missing';
  try {
    return `${statSync(absolutePath).size} bytes`;
  } catch {
    return 'unreadable';
  }
}

function sourceArtifactSnapshot(command, phase) {
  const shared = [
    roadmapBlock(phase),
    artifactBlock('STATE.md'),
    artifactBlock('.planning/config.json'),
  ];

  if (command === 'start') {
    return [
      artifactBlock('PROJECT.md'),
      ...shared,
      designDocBlocks(),
    ].join('\n');
  }

  return [
    ...shared,
    phaseArtifactBlocks(phase),
  ].join('\n');
}

function workingTreeSnapshot(command) {
  if (command !== 'architecture-review') return '';

  const status = commandOutput('git', ['status', '--short']);
  const statusText = status.text || 'clean';
  const contextStatusText = statusTextForContext(statusText);
  const diffStatText = gitDiffForStatus(statusText, true);
  const diffText = gitDiffForStatus(statusText);

  return `## Working Tree Snapshot

### git status --short

\`\`\`text
${contextStatusText}
\`\`\`

### git diff --stat

\`\`\`text
${diffStatText}
\`\`\`

### git diff

\`\`\`diff
${truncateText(diffText, MAX_GIT_DIFF_CHARS)}
\`\`\`

${changedFileBlocks(statusText)}
`;
}

function renderContextPack(args) {
  const capability = CAPABILITIES[args.command];
  const phase = args.phase ? normalizePhase(args.phase) : undefined;
  const scope = detectScope(ROOT, args.scope);
  const prompt = renderTemplate(
    readText(ROOT, path.join('adapters', 'opus', 'prompts', capability.prompt)),
    phase,
  );
  const expectedOutput = phase
    ? capability.expectedOutput.replaceAll('<phase>', phase.id)
    : capability.expectedOutput;
  const phaseLine = phase
    ? `Phase: \`${phase.id}\`\nPhase directory: \`${phase.dir}\``
    : 'Phase: `project-start`';

  return `# RIFF Opus Manual Prompt Pack

Capability: \`${args.command}\`
${phaseLine}
Scope: \`${scope}\`
Loading tier: \`${capability.tier}\`
Expected output: ${expectedOutput}
Repository branch hint: \`${gitBranchHint()}\`

## Escalation Workflow

This prompt may be pasted into Opus manually or sent through an explicit local programmatic command. Opus should return artifact-ready markdown or YAML only; it must not require hidden state or provider-specific commands in RIFF core artifacts.

After Opus responds, a human or calling adapter applies the result to the expected RIFF artifact and runs normal RIFF gates. This escalation does not bypass plan review, execution smoke, scope check, code review, security review, docs check, hooks, dashboard metadata, or finalization.

## Stop Conditions

- Stop if a human architecture decision is required before a safe plan can be written.
- Stop if required context is missing and guessing would affect security, data, public APIs, migrations, billing, auth, or phase boundaries.
- Stop if the requested output would plan multiple roadmap phases together.
- Stop if the result would require hidden automation or a provider-specific core contract.

## Core Contract Excerpts

${readContract('core/protocols/planning.md')}

${phaseArtifactContract(args.command)}

${adapterEscalationContract()}

## Source Artifact Snapshot

Artifact sizes: \`ROADMAP.yaml=${fileSizeHint('ROADMAP.yaml')}\`, \`STATE.md=${fileSizeHint('STATE.md')}\`, \`.planning/config.json=${fileSizeHint('.planning/config.json')}\`

${sourceArtifactSnapshot(args.command, phase)}

${workingTreeSnapshot(args.command)}

## Adapter Prompt

${prompt}

## Output Requirements

- Return only the requested planning or review output, with concise notes where needed.
- Start directly with the requested artifact heading.
- Do not wrap the whole answer in a code fence.
- Do not include conversational preambles or follow-up questions about writing files.
- Make every proposed phase plan compatible with the PLAN.md contract above.
- Name assumptions explicitly.
- Keep changes bounded to the selected phase or project-start planning scope.
- Do not include provider transcripts or instructions that require Opus to run again.
`;
}

function runClaude(args, contextPack) {
  if (!args.yes && process.env.RIFF_OPUS_ALLOW_PROGRAMMATIC !== '1') {
    fail('--run-claude requires --yes or RIFF_OPUS_ALLOW_PROGRAMMATIC=1');
  }

  const result = spawnSync(args.claudeBin, ['-p', '--model', args.model], {
    cwd: ROOT,
    input: contextPack,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    env: process.env,
  });

  if (result.error) {
    fail(`Failed to run ${args.claudeBin}: ${result.error.message}`);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  const exitCode = result.status ?? 1;
  if (exitCode !== 0) {
    fail(`${args.claudeBin} exited with ${exitCode}`);
  }

  const output = result.stdout ?? '';
  if (args.responseOut) {
    writeText(ROOT, args.responseOut, output);
    process.stdout.write(`Wrote ${args.responseOut}\n`);
    return;
  }
  process.stdout.write(output);
}

const args = parseArgs(process.argv.slice(2));
const contextPack = renderContextPack(args);

if (args.contextOut) {
  writeText(ROOT, args.contextOut, contextPack);
  process.stdout.write(`Wrote ${args.contextOut}\n`);
}

if (args.print) {
  process.stdout.write(contextPack);
}

if (args.runClaude) {
  runClaude(args, contextPack);
}

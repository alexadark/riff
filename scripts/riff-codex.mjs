#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const MAX_EXCERPT_CHARS = 6000;

const CAPABILITIES = {
  plan: {
    prompt: 'plan.md',
    artifact: 'PLAN.md',
    tier: 'focused',
    core: [
      'core/protocols/planning.md',
      'core/protocols/context-budget.md',
      'core/schemas/phase-artifacts.md',
    ],
  },
  execute: {
    prompt: 'execute.md',
    artifact: 'SUMMARY.md',
    tier: 'expanded',
    core: [
      'core/protocols/execution.md',
      'core/protocols/state.md',
      'core/schemas/phase-artifacts.md',
    ],
  },
  'plan-review': {
    prompt: 'plan-review.md',
    artifact: 'PLAN-REVIEW.md',
    tier: 'focused',
    core: [
      'core/protocols/review.md',
      'core/protocols/planning.md',
      'core/schemas/phase-artifacts.md',
    ],
  },
  review: {
    aliasFor: 'code-review',
  },
  'code-review': {
    prompt: 'code-review.md',
    artifact: 'REVIEW.md',
    tier: 'focused',
    core: [
      'core/protocols/review.md',
      'core/protocols/execution.md',
      'core/schemas/phase-artifacts.md',
    ],
  },
  'security-review': {
    prompt: 'security-review.md',
    artifact: 'SECURITY.md',
    tier: 'expanded',
    core: [
      'core/protocols/review.md',
      'core/protocols/execution.md',
      'core/schemas/phase-artifacts.md',
    ],
  },
  'docs-check': {
    prompt: 'docs-check.md',
    artifact: 'GATES.md',
    tier: 'focused',
    core: [
      'core/protocols/review.md',
      'core/protocols/execution.md',
      'core/schemas/phase-artifacts.md',
    ],
  },
  'dashboard-explain': {
    prompt: 'dashboard-explain.md',
    artifact: 'dashboard-explanation.json',
    tier: 'minimal',
    core: [
      'core/protocols/dashboard.md',
      'core/protocols/state.md',
      'core/schemas/phase-artifacts.md',
    ],
  },
};

function usage(exitCode = 0) {
  const commands = Object.keys(CAPABILITIES).join(', ');
  const text = `RIFF Codex adapter

Usage:
  node scripts/riff-codex.mjs <command> --phase <phase-id-or-path> [options]

Commands:
  ${commands}

Options:
  --phase <id-or-path>       Phase id or .planning/phases/<id> path
  --scope <production|scratch>
  --print                    Print generated context pack
  --context-out <path>       Write generated context pack to a file
  --run                      Run one "codex exec" invocation
  --codex-bin <name>         Codex executable; defaults to CODEX_BIN or codex
  -h, --help                 Show help
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
    run: false,
    codexBin: process.env.CODEX_BIN || 'codex',
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
    if (token === '--run') {
      args.run = true;
      continue;
    }
    if (token === '--codex-bin') {
      args.codexBin = readOptionValue(token, index);
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${token}`);
  }

  if (!args.command) usage(1);
  if (!Object.prototype.hasOwnProperty.call(CAPABILITIES, args.command)) {
    fail(`Unknown command: ${args.command}`);
  }
  if (!args.phase) {
    fail('--phase is required');
  }
  if (args.scope && args.scope !== 'production' && args.scope !== 'scratch') {
    fail('--scope must be production or scratch');
  }
  if (!args.print && !args.contextOut && !args.run) {
    args.print = true;
  }
  return args;
}

function resolveCapability(command) {
  const capability = CAPABILITIES[command];
  if (capability.aliasFor) {
    return {
      name: capability.aliasFor,
      ...CAPABILITIES[capability.aliasFor],
    };
  }
  return {
    name: command,
    ...capability,
  };
}

function normalizePhase(input) {
  const normalized = input.replace(/\/$/, '');
  if (normalized.includes('/')) {
    return {
      id: path.basename(normalized),
      dir: normalized,
    };
  }
  return {
    id: normalized,
    dir: path.join('.planning', 'phases', normalized),
  };
}

function readText(relativePath) {
  return readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function readIfExists(relativePath) {
  const absolutePath = path.join(ROOT, relativePath);
  if (!existsSync(absolutePath)) {
    return {
      exists: false,
      text: '',
    };
  }
  return {
    exists: true,
    text: readFileSync(absolutePath, 'utf8'),
  };
}

function detectScope(explicitScope) {
  if (explicitScope) return explicitScope;
  const config = readIfExists('.planning/config.json');
  if (!config.exists) return 'production';
  try {
    const parsed = JSON.parse(config.text);
    return parsed.scope === 'scratch' ? 'scratch' : 'production';
  } catch {
    return 'production';
  }
}

function artifactSnapshot(phaseDir) {
  const files = [
    'ROADMAP.yaml',
    'STATE.md',
    '.planning/config.json',
    path.join(phaseDir, 'PLAN.md'),
    path.join(phaseDir, 'PLAN-REVIEW.md'),
    path.join(phaseDir, 'SUMMARY.md'),
    path.join(phaseDir, 'REVIEW.md'),
    path.join(phaseDir, 'SECURITY.md'),
    path.join(phaseDir, 'GATES.md'),
    path.join(phaseDir, 'HANDOFF.md'),
  ];

  return files.map((file) => {
    const normalized = file.split(path.sep).join('/');
    const artifact = readIfExists(normalized);
    if (!artifact.exists) {
      return `## ${normalized}\n\nStatus: missing\n`;
    }
    const suffix = artifact.text.length > MAX_EXCERPT_CHARS
      ? '\n\n[excerpt truncated; read the file directly before acting]\n'
      : '';
    return `## ${normalized}\n\nStatus: present\n\n\`\`\`markdown\n${artifact.text.slice(0, MAX_EXCERPT_CHARS)}${suffix}\`\`\`\n`;
  }).join('\n');
}

function renderContextPack(args) {
  const capability = resolveCapability(args.command);
  const phase = normalizePhase(args.phase);
  const scope = detectScope(args.scope);
  const prompt = readText(path.join('adapters', 'codex', 'prompts', capability.prompt));
  const outputPath = path.join(phase.dir, capability.artifact).split(path.sep).join('/');
  const coreRefs = capability.core.map((file) => `- \`${file}\``).join('\n');

  return `# RIFF Codex Context Pack

Capability: \`${capability.name}\`
Requested command: \`${args.command}\`
Phase: \`${phase.id}\`
Phase directory: \`${phase.dir.split(path.sep).join('/')}\`
Scope: \`${scope}\`
Loading tier: \`${capability.tier}\`
Expected output: \`${outputPath}\`

## Mission

Run exactly this capability for exactly this phase. Do not chain into another phase or gate.

Use the RIFF core contracts as the source of truth. Adapter prompts may explain how to operate in Codex, but durable outputs must be normal RIFF artifacts.

## Stop Conditions

- Stop before changing files if the phase requires an unapproved architecture change.
- Stop if required context is missing and guessing would affect security, data, public APIs, or phase boundaries.
- Stop if the requested command would require unattended looping or running a different capability.

## Core Contracts To Read

${coreRefs}

## Existing Artifact Snapshot

${artifactSnapshot(phase.dir)}

## Adapter Prompt

${prompt}

## Output Requirements

- Write the expected artifact or documented gate result named above.
- State which files you read before acting.
- Record command evidence with exit codes when checks are run.
- Keep changes within the selected capability and the phase plan boundaries.
`;
}

function writeContext(filePath, text) {
  const absolutePath = path.resolve(ROOT, filePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, text, 'utf8');
}

const args = parseArgs(process.argv.slice(2));
const contextPack = renderContextPack(args);

if (args.contextOut) {
  writeContext(args.contextOut, contextPack);
  process.stdout.write(`Wrote ${args.contextOut}\n`);
}

if (args.print) {
  process.stdout.write(contextPack);
}

if (args.run) {
  const result = spawnSync(args.codexBin, ['exec', '-'], {
    cwd: ROOT,
    input: contextPack,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: process.env,
  });
  if (result.error) {
    fail(`Failed to run ${args.codexBin}: ${result.error.message}`);
  }
  process.exit(result.status ?? 1);
}

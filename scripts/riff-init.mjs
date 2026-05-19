#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  readlinkSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = path.dirname(realpathSync(fileURLToPath(import.meta.url)));
const FRAMEWORK_ROOT = path.resolve(SCRIPT_DIR, '..');
const VALID_HARNESSES = new Set(['claude', 'codex', 'commandcode', 'all']);
const CLAUDE_ALIASES = new Set(['claude-code', 'codeable']);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function usage(exitCode = 0) {
  process.stdout.write(`RIFF init

Usage:
  riff init [options]
  node scripts/riff-init.mjs [options]

Options:
  --harness <claude|codex|commandcode|all>   Harness files to install; default codex
                                             aliases: claude-code, codeable
  --scope <production|scratch>               Project scope; preserves existing config when present
  --project-root <path>                      Target project root; default current directory
  --force                                    Replace existing RIFF symlinks that point elsewhere
  -h, --help                                 Show help
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
    harness: 'codex',
    projectRoot: process.cwd(),
    scope: undefined,
    force: false,
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
    if (token === '--harness') {
      args.harness = readOptionValue(token, index);
      index += 1;
      continue;
    }
    if (token === '--project-root') {
      args.projectRoot = path.resolve(readOptionValue(token, index));
      index += 1;
      continue;
    }
    if (token === '--scope') {
      args.scope = readOptionValue(token, index);
      index += 1;
      continue;
    }
    if (token === '--force') {
      args.force = true;
      continue;
    }
    if (VALID_HARNESSES.has(token) || CLAUDE_ALIASES.has(token)) {
      args.harness = token;
      continue;
    }
    fail(`Unknown argument: ${token}`);
  }

  if (CLAUDE_ALIASES.has(args.harness)) {
    args.harness = 'claude';
  }
  if (!VALID_HARNESSES.has(args.harness)) {
    fail('--harness must be claude, codex, commandcode, all, claude-code, or codeable');
  }
  if (args.scope && args.scope !== 'production' && args.scope !== 'scratch') {
    fail('--scope must be production or scratch');
  }
  if (!existsSync(args.projectRoot)) {
    fail(`--project-root does not exist: ${args.projectRoot}`);
  }
  if (!lstatSync(args.projectRoot).isDirectory()) {
    fail(`--project-root must be a directory: ${args.projectRoot}`);
  }
  args.projectRoot = realpathSync(args.projectRoot);
  return args;
}

function ensureDir(relativePath) {
  mkdirSync(path.join(args.projectRoot, relativePath), { recursive: true });
}

function readJsonIfExists(relativePath) {
  const absolute = path.join(args.projectRoot, relativePath);
  if (!existsSync(absolute)) return undefined;
  return JSON.parse(readFileSync(absolute, 'utf8'));
}

function writeJson(relativePath, value) {
  const absolute = path.join(args.projectRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function lstatIfPresent(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
}

function linkTargetFor(sourceAbsolute, destAbsolute, viaRiff) {
  const sourceTarget = viaRiff
    ? path.join(args.projectRoot, '.riff', path.relative(FRAMEWORK_ROOT, sourceAbsolute))
    : sourceAbsolute;
  return path.relative(path.dirname(destAbsolute), sourceTarget) || '.';
}

function symlinkRelative(sourceAbsolute, destRelative, { force = args.force, viaRiff = false } = {}) {
  const destAbsolute = path.join(args.projectRoot, destRelative);
  const linkTarget = linkTargetFor(sourceAbsolute, destAbsolute, viaRiff);
  mkdirSync(path.dirname(destAbsolute), { recursive: true });
  const existing = lstatIfPresent(destAbsolute);
  if (existing) {
    const desiredResolved = path.resolve(path.dirname(destAbsolute), linkTarget);
    const desiredSource = viaRiff ? sourceAbsolute : desiredResolved;
    const stat = existing;
    if (stat.isSymbolicLink()) {
      const currentTarget = readlinkSync(destAbsolute);
      const current = path.resolve(path.dirname(destAbsolute), currentTarget);
      if (currentTarget === linkTarget) return false;
      if (current !== desiredResolved && current !== desiredSource && !force) {
        fail(`${destRelative} already points to ${current}; rerun with --force to replace it`);
      }
      rmSync(destAbsolute);
    } else {
      fail(`${destRelative} already exists and is not a symlink`);
    }
  }
  symlinkSync(linkTarget, destAbsolute);
  return true;
}

function ensureGitRepo() {
  if (existsSync(path.join(args.projectRoot, '.git'))) return false;
  const result = spawnSync('git', ['init', '-q'], {
    cwd: args.projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  if (result.error) fail(`Failed to run git init: ${result.error.message}`);
  if (result.status !== 0) fail(`git init failed with exit code ${result.status}`);
  return true;
}

function installRiffSymlink() {
  return symlinkRelative(FRAMEWORK_ROOT, '.riff');
}

function ensurePlanning(scope) {
  ensureDir('.planning/phases');
  ensureDir('.planning/expertise');
  ensureDir('.planning/seeds');
  ensureDir('.planning/debug');
  ensureDir('.planning/quick');
  ensureDir('.planning/specs');

  const existingConfig = readJsonIfExists('.planning/config.json');
  if (existingConfig?.scope) return false;
  writeJson('.planning/config.json', { scope: scope ?? 'production' });
  return true;
}

function installClaudeHarness() {
  ensureDir('.claude/commands/riff');
  ensureDir('.claude/agents/riff');
  ensureDir('.claude/hooks/riff');

  for (const file of readdirSync(path.join(FRAMEWORK_ROOT, 'commands'))) {
    if (file.endsWith('.md')) {
      symlinkRelative(path.join(FRAMEWORK_ROOT, 'commands', file), path.join('.claude/commands/riff', file), {
        viaRiff: true,
      });
    }
  }
  for (const file of readdirSync(path.join(FRAMEWORK_ROOT, 'agents'))) {
    if (file.endsWith('.md')) {
      symlinkRelative(path.join(FRAMEWORK_ROOT, 'agents', file), path.join('.claude/agents/riff', file), {
        viaRiff: true,
      });
    }
  }
  for (const file of readdirSync(path.join(FRAMEWORK_ROOT, 'hooks'))) {
    if (file.endsWith('.sh') && file !== 'security-scan.sh' && file !== 'commit-msg.sh') {
      symlinkRelative(path.join(FRAMEWORK_ROOT, 'hooks', file), path.join('.claude/hooks/riff', file), {
        viaRiff: true,
      });
    }
  }

  symlinkRelative(path.join(FRAMEWORK_ROOT, 'CLAUDE.md'), '.claude/agents/riff/CLAUDE.md', { viaRiff: true });
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'templates/banner.sh'), '.claude/hooks/riff/banner.sh', { viaRiff: true });
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'hooks/security-scan.sh'), '.git/hooks/pre-commit', { viaRiff: true });
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'hooks/commit-msg.sh'), '.git/hooks/commit-msg', { viaRiff: true });
}

function installCommandCodeHarness() {
  ensureDir('.commandcode/commands/riff');
  ensureDir('.commandcode/hooks');
  for (const file of readdirSync(path.join(FRAMEWORK_ROOT, 'adapters/commandcode/commands/riff'))) {
    if (file.endsWith('.md')) {
      symlinkRelative(
        path.join(FRAMEWORK_ROOT, 'adapters/commandcode/commands/riff', file),
        path.join('.commandcode/commands/riff', file),
        { viaRiff: true },
      );
    }
  }
  symlinkRelative(
    path.join(FRAMEWORK_ROOT, 'adapters/commandcode/settings.template.json'),
    '.commandcode/settings.json',
    { viaRiff: true },
  );
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'hooks/destructive-guard.sh'), '.commandcode/hooks/destructive-guard.sh', {
    viaRiff: true,
  });
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'hooks/boundary-check.sh'), '.commandcode/hooks/boundary-check.sh', {
    viaRiff: true,
  });
  for (const file of readdirSync(path.join(FRAMEWORK_ROOT, 'hooks/examples'))) {
    if (file.endsWith('.sh')) {
      symlinkRelative(path.join(FRAMEWORK_ROOT, 'hooks/examples', file), path.join('.commandcode/hooks', file), {
        viaRiff: true,
      });
    }
  }
}

function installCodexHarness() {
  ensureDir('.codex/riff');
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'adapters/codex/README.md'), '.codex/riff/README.md', { viaRiff: true });
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'adapters/codex/context-pack.md'), '.codex/riff/context-pack.md', {
    viaRiff: true,
  });
}

function selectedHarnesses(harness) {
  if (harness === 'all') return ['claude', 'codex', 'commandcode'];
  return [harness];
}

function nextStepsFor(harnesses) {
  const steps = [
    '  Profile: keep the framework profile, or run /riff:onboard in Claude Code for the profile interview',
    '  Start artifacts: node .riff/scripts/riff-codex.mjs start --brief "..." --run',
  ];
  if (harnesses.includes('claude')) {
    steps.push('  Claude: restart Claude Code, then /riff:start');
  }
  if (harnesses.includes('commandcode')) {
    steps.push('  CommandCode: run riff/start');
  }
  return steps.join('\n');
}

const args = parseArgs(process.argv.slice(process.argv[1]?.endsWith('riff') ? 3 : 2));
const gitInitialized = ensureGitRepo();
const riffLinked = installRiffSymlink();
const configWritten = ensurePlanning(args.scope);
const harnesses = selectedHarnesses(args.harness);

for (const harness of harnesses) {
  if (harness === 'claude') installClaudeHarness();
  if (harness === 'codex') installCodexHarness();
  if (harness === 'commandcode') installCommandCodeHarness();
}

process.stdout.write(`RIFF installed
project: ${args.projectRoot}
framework: ${FRAMEWORK_ROOT}
harnesses: ${harnesses.join(', ')}
git initialized: ${gitInitialized ? 'yes' : 'no'}
.riff linked: ${riffLinked ? 'yes' : 'already correct'}
config: ${configWritten ? 'created' : 'preserved'}

Next:
${nextStepsFor(harnesses)}
`);

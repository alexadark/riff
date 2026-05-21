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
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const SCRIPT_DIR = path.dirname(realpathSync(fileURLToPath(import.meta.url)));
const FRAMEWORK_ROOT = path.resolve(SCRIPT_DIR, '..');
const VALID_HARNESSES = new Set(['claude', 'codex', 'commandcode', 'all']);
const CLAUDE_ALIASES = new Set(['claude-code', 'codeable']);
const COMMANDCODE_ALIASES = new Set(['command', 'command-code']);
const PRESET_NAMES = new Set(['expert', 'neutre', 'apprentissage', 'alex']);
const CODEX_SKILLS_SOURCE_PATH = 'adapters/codex/skills';

const USE_COLOR = process.stdout.isTTY && !process.env.NO_COLOR;
const ANSI = USE_COLOR
  ? {
      reset: '\x1b[0m',
      dim: '\x1b[2m',
      bold: '\x1b[1m',
      green: '\x1b[38;2;120;220;160m',
      cyan: '\x1b[38;2;90;190;185m',
      yellow: '\x1b[38;2;240;200;90m',
      red: '\x1b[38;2;235;110;110m',
      teal1: '\x1b[38;2;0;130;130m',
      teal2: '\x1b[38;2;0;160;155m',
      teal3: '\x1b[38;2;0;190;180m',
      teal4: '\x1b[38;2;0;215;205m',
      teal5: '\x1b[38;2;0;240;230m',
    }
  : new Proxy({}, { get: () => '' });

function color(name, text) {
  return `${ANSI[name] || ''}${text}${ANSI.reset || ''}`;
}

function printBanner() {
  const lines = [
    `${ANSI.teal1} ____  ___ _____ _____ ${ANSI.reset}`,
    `${ANSI.teal2}|  _ \\|_ _|  ___|  ___|${ANSI.reset}`,
    `${ANSI.teal3}| |_) || || |_  | |_   ${ANSI.reset}`,
    `${ANSI.teal4}|  _ < | ||  _| |  _|  ${ANSI.reset}`,
    `${ANSI.teal5}|_| \\_\\___|_|   |_|    ${ANSI.reset}`,
    '',
    `${ANSI.cyan}Build like a band of six. Ship like one.${ANSI.reset}`,
    `${ANSI.dim}Solo dev framework for Claude Code${ANSI.reset}`,
    '',
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
}

const PRESETS = {
  expert: {
    user: {
      programming_level: 'expert',
      ai_agents_experience: 'regular',
      domains: ['backend'],
      work_mode: 'team',
      side_activities: ['none'],
      conversational_language: 'en',
      artifact_language: 'en',
      narrative_language: 'en',
    },
    executors: { available: ['claude'] },
    risk: { sensitive_task_preference: 'fast' },
    style: {
      length: 'terse',
      allow_jargon: 'free',
      when_uncertain: 'initiative',
      explanation_level: 'technical',
    },
    budget: { default_quality: 'balanced' },
    notifications: { channel: 'none' },
    git: { merge_strategy: 'github_button' },
    dashboard: { language: 'en' },
  },
  neutre: {
    user: {
      programming_level: 'intermediate',
      ai_agents_experience: 'tried',
      domains: ['generalist'],
      work_mode: 'solo',
      side_activities: ['none'],
      conversational_language: 'en',
      artifact_language: 'en',
      narrative_language: 'en',
    },
    executors: { available: ['claude'] },
    risk: { sensitive_task_preference: 'balanced' },
    style: {
      length: 'standard',
      allow_jargon: 'first_mention',
      when_uncertain: 'important_only',
      explanation_level: 'simple',
    },
    budget: { default_quality: 'balanced' },
    notifications: { channel: 'none' },
    git: { merge_strategy: 'github_button' },
    dashboard: { language: 'en' },
  },
  apprentissage: {
    user: {
      programming_level: 'learner',
      ai_agents_experience: 'none',
      domains: ['generalist'],
      work_mode: 'solo',
      side_activities: ['none'],
      conversational_language: 'fr',
      artifact_language: 'en',
      narrative_language: 'fr',
    },
    executors: { available: ['claude'] },
    risk: { sensitive_task_preference: 'cautious' },
    style: {
      length: 'detailed',
      allow_jargon: 'never',
      when_uncertain: 'always_ask',
      explanation_level: 'eli5',
    },
    budget: { default_quality: 'balanced' },
    notifications: { channel: 'none' },
    git: { merge_strategy: 'github_button' },
    dashboard: { language: 'fr' },
  },
  alex: {
    user: {
      programming_level: 'intermediate',
      ai_agents_experience: 'advanced',
      domains: ['frontend', 'fullstack'],
      work_mode: 'solo_plus_clients',
      side_activities: ['content', 'business'],
      conversational_language: 'fr',
      artifact_language: 'en',
      narrative_language: 'fr',
    },
    executors: { available: ['claude', 'codex'] },
    risk: { sensitive_task_preference: 'cautious' },
    style: {
      length: 'terse',
      allow_jargon: 'never',
      when_uncertain: 'important_only',
      explanation_level: 'simple',
      terminal_explanation_level: 'technical',
    },
    budget: { default_quality: 'max' },
    notifications: { channel: 'telegram' },
    git: { merge_strategy: 'local_no_ff' },
    dashboard: { language: 'fr' },
  },
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function usage(exitCode = 0) {
  process.stdout.write(`${color('bold', 'RIFF init')}

${color('cyan', 'Usage:')}
  riff init [options]
  node scripts/riff-init.mjs [options]

${color('cyan', 'Options:')}
  --harness <claude|codex|commandcode|all>   Harness files to install; default claude
                                             aliases: claude-code, codeable, command
  --scope <production|scratch>               Project scope; preserves existing config when present
  --project-root <path>                      Target project root; default current directory
  --force                                    Replace existing RIFF symlinks that point elsewhere
  --profile <preset|custom|skip>             Run terminal onboarding; presets: expert, neutre, apprentissage, alex
  --no-onboard                               Skip terminal profile onboarding
  -h, --help                                 Show help
`);
  process.exit(exitCode);
}

function normalizeHarness(value) {
  if (CLAUDE_ALIASES.has(value)) return 'claude';
  if (COMMANDCODE_ALIASES.has(value)) return 'commandcode';
  if (VALID_HARNESSES.has(value)) return value;
  return undefined;
}

function parseArgs(argv) {
  const args = {
    harness: 'claude',
    projectRoot: process.cwd(),
    scope: undefined,
    force: false,
    profile: undefined,
    onboard: true,
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
      args.harness = normalizeHarness(readOptionValue(token, index));
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
    if (token === '--profile') {
      args.profile = readOptionValue(token, index);
      index += 1;
      continue;
    }
    if (token === '--no-onboard') {
      args.onboard = false;
      args.profile = 'skip';
      continue;
    }
    const positionalHarness = normalizeHarness(token);
    if (positionalHarness) {
      args.harness = positionalHarness;
      continue;
    }
    fail(`Unknown argument: ${token}`);
  }

  if (!VALID_HARNESSES.has(args.harness)) {
    fail('--harness must be claude, codex, commandcode, all, claude-code, codeable, or command');
  }
  if (args.profile && args.profile !== 'skip' && args.profile !== 'custom' && !PRESET_NAMES.has(args.profile)) {
    fail('--profile must be custom, skip, expert, neutre, apprentissage, or alex');
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

function installCodexRepoSkills() {
  const sourceRoot = path.join(FRAMEWORK_ROOT, CODEX_SKILLS_SOURCE_PATH);
  ensureDir('.agents/skills');
  for (const name of readdirSync(sourceRoot)) {
    const source = path.join(sourceRoot, name);
    if (!lstatSync(source).isDirectory()) continue;
    if (!existsSync(path.join(source, 'SKILL.md'))) continue;
    symlinkRelative(source, path.join('.agents/skills', `riff-${name}`), { viaRiff: true });
  }
}

function installCodexHarness() {
  ensureDir('.codex/riff');
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'adapters/codex/README.md'), '.codex/riff/README.md', { viaRiff: true });
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'adapters/codex/context-pack.md'), '.codex/riff/context-pack.md', {
    viaRiff: true,
  });
  installCodexRepoSkills();
}

function yamlScalar(value) {
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value === null || value === undefined) return 'null';
  if (/^[a-zA-Z0-9_-]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function yamlValue(value, indent = 0) {
  const spaces = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${value.map((entry) => yamlScalar(entry)).join(', ')}]`;
  }
  if (isPlainObject(value)) {
    return `\n${Object.entries(value)
      .map(([key, child]) => isPlainObject(child)
        ? `${spaces}  ${key}:${yamlValue(child, indent + 2)}`
        : `${spaces}  ${key}: ${yamlValue(child, indent + 2)}`)
      .join('\n')}`;
  }
  return yamlScalar(value);
}

function profileYaml(profile) {
  return `${Object.entries(profile)
    .map(([key, value]) => isPlainObject(value) ? `${key}:${yamlValue(value, 0)}` : `${key}: ${yamlValue(value, 0)}`)
    .join('\n')}\n`;
}

function writeProfile(relativePath, profile) {
  const absolute = path.join(args.projectRoot, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  if (existsSync(absolute)) {
    writeFileSync(`${absolute}.bak`, readFileSync(absolute, 'utf8'), 'utf8');
  }
  writeFileSync(absolute, profileYaml(profile), 'utf8');
}

async function askChoice(rl, question, choices, defaultValue) {
  const renderedChoices = choices
    .map((choice) => choice === defaultValue ? `${choice}*` : choice)
    .join('/');
  while (true) {
    const answer = (await rl.question(`${question} (${renderedChoices}): `)).trim();
    const value = answer || defaultValue;
    if (choices.includes(value)) return value;
    output.write(`Choose one of: ${choices.join(', ')}\n`);
  }
}

async function askList(rl, question, choices, defaultValues) {
  const defaultText = defaultValues.join(',');
  while (true) {
    const answer = (await rl.question(`${question} (${choices.join(', ')}) [${defaultText}]: `)).trim();
    const values = (answer || defaultText)
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const invalid = values.filter((value) => !choices.includes(value));
    if (invalid.length === 0 && values.length > 0) return values;
    output.write(`Use comma-separated values from: ${choices.join(', ')}\n`);
  }
}

async function askText(rl, question, defaultValue) {
  const answer = (await rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `)).trim();
  return answer || defaultValue;
}

async function customProfile(rl) {
  const conversationalLanguage = await askChoice(rl, 'Conversational language', ['en', 'fr', 'mix', 'other'], 'fr');
  const artifactLanguage = await askChoice(rl, 'Artifact language for commits/docs/code', ['en', 'fr', 'other'], 'en');
  const narrativeLanguage = await askChoice(rl, 'Dashboard narrative language', ['en', 'fr', 'other'], conversationalLanguage === 'fr' ? 'fr' : 'en');
  const executorsChoice = await askChoice(rl, 'Which executors do you have installed?', ['claude', 'claude+codex'], 'claude');
  const notificationsChannel = await askChoice(rl, 'AFK notifications', ['none', 'telegram', 'email'], 'none');
  const notifications = { channel: notificationsChannel };
  if (notificationsChannel === 'telegram') {
    notifications.telegram_bot_token = await askText(rl, 'Telegram bot token', '');
    notifications.telegram_chat_id = await askText(rl, 'Telegram chat id', '');
  }
  if (notificationsChannel === 'email') {
    notifications.email_to = await askText(rl, 'Notification email', '');
  }

  return {
    executors: { available: executorsChoice === 'claude+codex' ? ['claude', 'codex'] : ['claude'] },
    user: {
      programming_level: await askChoice(rl, 'Programming level', ['novice', 'learner', 'intermediate', 'experienced', 'expert'], 'intermediate'),
      ai_agents_experience: await askChoice(rl, 'AI coding agents experience', ['none', 'tried', 'regular', 'advanced'], 'regular'),
      domains: await askList(rl, 'Primary domains', ['frontend', 'backend', 'fullstack', 'data_ml', 'systems', 'mobile', 'generalist'], ['fullstack']),
      work_mode: await askChoice(rl, 'Work mode', ['solo', 'team', 'solo_plus_clients', 'client_work', 'mix'], 'solo_plus_clients'),
      side_activities: await askList(rl, 'Side activities', ['none', 'content', 'business', 'design', 'ops', 'other'], ['content', 'business']),
      conversational_language: conversationalLanguage === 'other' ? await askText(rl, 'Conversational language code', 'en') : conversationalLanguage,
      artifact_language: artifactLanguage === 'other' ? await askText(rl, 'Artifact language code', 'en') : artifactLanguage,
      narrative_language: narrativeLanguage,
    },
    risk: {
      sensitive_task_preference: await askChoice(rl, 'Sensitive task preference', ['cautious', 'balanced', 'fast'], 'cautious'),
    },
    style: {
      length: await askChoice(rl, 'Message length', ['terse', 'standard', 'detailed'], 'terse'),
      allow_jargon: await askChoice(rl, 'Jargon policy', ['free', 'first_mention', 'never'], 'never'),
      when_uncertain: await askChoice(rl, 'When uncertain', ['always_ask', 'important_only', 'initiative'], 'important_only'),
      explanation_level: await askChoice(rl, 'Explanation level', ['technical', 'simple', 'eli5'], 'simple'),
      terminal_explanation_level: await askChoice(rl, 'Terminal explanation level', ['technical', 'simple', 'eli5'], 'technical'),
    },
    budget: {
      default_quality: await askChoice(rl, 'Budget and quality', ['frugal', 'balanced', 'max'], 'max'),
    },
    notifications,
    git: {
      merge_strategy: await askChoice(rl, 'Merge strategy', ['github_button', 'local_no_ff'], 'github_button'),
    },
    dashboard: {
      language: narrativeLanguage,
    },
  };
}

async function runProfileOnboarding(profileMode) {
  const profilePath = '.planning/profile.yaml';
  if (profileMode === 'skip' || args.onboard === false) return 'skipped';

  if (!input.isTTY || !output.isTTY) {
    if (PRESET_NAMES.has(profileMode)) {
      writeProfile(profilePath, PRESETS[profileMode]);
      return `wrote ${profilePath} from ${profileMode} preset`;
    }
    return 'skipped (non-interactive terminal)';
  }

  const existingProfile = existsSync(path.join(args.projectRoot, profilePath));
  const rl = createInterface({ input, output });
  try {
    if (existingProfile && !profileMode) {
      const replace = await askChoice(rl, `${profilePath} already exists. Replace it?`, ['no', 'yes'], 'no');
      if (replace === 'no') return 'preserved';
    }

    let mode = profileMode;
    if (!mode) {
      mode = await askChoice(rl, 'Profile setup', ['preset', 'custom', 'skip'], 'preset');
    }
    if (mode === 'skip') return 'skipped';
    if (mode === 'custom') {
      writeProfile(profilePath, await customProfile(rl));
      return `wrote ${profilePath} from custom answers`;
    }
    if (mode === 'preset') {
      mode = await askChoice(rl, 'Choose a preset', [...PRESET_NAMES], 'alex');
    }
    writeProfile(profilePath, PRESETS[mode]);
    return `wrote ${profilePath} from ${mode} preset`;
  } finally {
    rl.close();
  }
}

function selectedHarnesses(harness) {
  if (harness === 'all') return ['claude', 'codex', 'commandcode'];
  return [harness];
}

function nextStepsFor(harnesses) {
  const steps = [];
  if (harnesses.includes('claude')) {
    steps.push(`  ${color('cyan', 'Claude:')} restart Claude Code, then ${color('green', '/riff:start')}`);
  }
  if (harnesses.includes('codex')) {
    steps.push(`  ${color('cyan', 'Codex:')} restart Codex, then type ${color('green', '$riff:start')} in the composer (or ${color('green', '/skills')} then pick riff:start)`);
  }
  if (harnesses.includes('commandcode')) {
    steps.push(`  ${color('cyan', 'CommandCode:')} run ${color('green', 'riff/start')}`);
  }
  if (steps.length === 0) return `  ${color('yellow', 'No harness selected')}`;
  return steps.join('\n');
}

const args = parseArgs(process.argv.slice(process.argv[1]?.endsWith('riff') ? 3 : 2));

if (USE_COLOR) printBanner();

const gitInitialized = ensureGitRepo();
const riffLinked = installRiffSymlink();
const configWritten = ensurePlanning(args.scope);
const harnesses = selectedHarnesses(args.harness);

for (const harness of harnesses) {
  if (harness === 'claude') installClaudeHarness();
  if (harness === 'codex') installCodexHarness();
  if (harness === 'commandcode') installCommandCodeHarness();
}

const profileStatus = await runProfileOnboarding(args.profile);

function statusValue(flagText, condition) {
  return condition ? color('green', flagText) : color('dim', flagText);
}

process.stdout.write(`
${color('bold', 'RIFF installed')}
${color('cyan', 'project:')}         ${args.projectRoot}
${color('cyan', 'framework:')}       ${FRAMEWORK_ROOT}
${color('cyan', 'harnesses:')}       ${color('green', harnesses.join(', '))}
${color('cyan', 'git initialized:')} ${statusValue(gitInitialized ? 'yes' : 'no', gitInitialized)}
${color('cyan', '.riff linked:')}    ${statusValue(riffLinked ? 'yes' : 'already correct', riffLinked)}
${color('cyan', 'config:')}          ${statusValue(configWritten ? 'created' : 'preserved', configWritten)}
${color('cyan', 'profile:')}         ${profileStatus}

${color('bold', 'Next:')}
${nextStepsFor(harnesses)}
`);

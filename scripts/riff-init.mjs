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
const PRESET_NAMES = new Set(['default']);

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
  default: {
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
    executors: { available: ['claude', 'codex'] },
    risk: { sensitive_task_preference: 'balanced' },
    style: {
      length: 'standard',
      allow_jargon: 'first_mention',
      when_uncertain: 'important_only',
      explanation_level: 'simple',
    },
    budget: { default_quality: 'balanced' },
    notifications: { channel: 'none' },
    metadata: { pr_body: 'standard' },
    git: { merge_strategy: 'github_button' },
    dashboard: { language: 'en' },
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
  --scope <production|scratch>               Project scope; preserves existing config when present
  --project-root <path>                      Target project root; default current directory
  --force                                    Replace existing RIFF symlinks that point elsewhere
  --profile <default|custom|skip>            Run terminal onboarding; default writes the neutral baseline profile
  --no-onboard                               Skip terminal profile onboarding
  -h, --help                                 Show help
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = {
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
    fail(`Unknown argument: ${token}`);
  }

  if (args.profile && args.profile !== 'skip' && args.profile !== 'custom' && !PRESET_NAMES.has(args.profile)) {
    fail('--profile must be default, custom, or skip');
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
  writeJson('.planning/config.json', { ...(existingConfig || {}), scope: scope ?? 'production' });
  return true;
}

function installClaudeRuntime() {
  ensureDir('.claude/commands/riff');
  ensureDir('.claude/agents/riff');
  ensureDir('.claude/hooks/riff');
  ensureDir('.claude/skills');

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
    if (file.endsWith('.sh') && !['security-scan.sh', 'commit-msg.sh'].includes(file)) {
      symlinkRelative(path.join(FRAMEWORK_ROOT, 'hooks', file), path.join('.claude/hooks/riff', file), {
        viaRiff: true,
      });
    }
  }
  for (const name of readdirSync(path.join(FRAMEWORK_ROOT, 'skills'))) {
    if (lstatSync(path.join(FRAMEWORK_ROOT, 'skills', name)).isDirectory()) {
      symlinkRelative(path.join(FRAMEWORK_ROOT, 'skills', name), path.join('.claude/skills', name), {
        force: true,
        viaRiff: true,
      });
    }
  }

  symlinkRelative(path.join(FRAMEWORK_ROOT, 'CLAUDE.md'), '.claude/agents/riff/CLAUDE.md', { viaRiff: true });
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'templates/banner.sh'), '.claude/hooks/riff/banner.sh', { viaRiff: true });
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'hooks/security-scan.sh'), '.git/hooks/pre-commit', { viaRiff: true });
  symlinkRelative(path.join(FRAMEWORK_ROOT, 'hooks/commit-msg.sh'), '.git/hooks/commit-msg', { viaRiff: true });
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
  const executorsChoice = await askChoice(rl, 'Which executors do you have installed?', ['claude+codex', 'claude'], 'claude+codex');
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
    metadata: {
      pr_body: await askChoice(rl, 'PR metadata detail', ['standard', 'off', 'full'], 'standard'),
    },
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
      return `wrote ${profilePath} from ${profileMode} profile`;
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
      mode = await askChoice(rl, 'Profile setup', ['default', 'custom', 'skip'], 'default');
    }
    if (mode === 'skip') return 'skipped';
    if (mode === 'custom') {
      writeProfile(profilePath, await customProfile(rl));
      return `wrote ${profilePath} from custom answers`;
    }
    writeProfile(profilePath, PRESETS.default);
    return `wrote ${profilePath} from default profile`;
  } finally {
    rl.close();
  }
}

function profileScalar(profileText, section, key) {
  let inSection = false;
  for (const rawLine of profileText.split('\n')) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (new RegExp(`^${section}:\\s*$`).test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) {
      return undefined;
    }
    const match = inSection ? line.match(new RegExp(`^\\s+${key}:\\s*([^#]+?)\\s*$`)) : undefined;
    if (match) return match[1].replace(/^["']|["']$/g, '').trim();
  }
  return undefined;
}

function resolvedProfileText() {
  const projectProfile = path.join(args.projectRoot, '.planning/profile.yaml');
  const frameworkProfile = path.join(FRAMEWORK_ROOT, 'profile.yaml');
  const defaultProfile = path.join(FRAMEWORK_ROOT, 'templates/profile.default.yaml');
  for (const candidate of [projectProfile, frameworkProfile, defaultProfile]) {
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
  }
  return '';
}

function settingsTemplateForProfile() {
  const risk = profileScalar(resolvedProfileText(), 'risk', 'sensitive_task_preference');
  if (risk === 'cautious') return 'settings-cautious.json';
  if (risk === 'balanced') return 'settings-balanced.json';
  return 'settings.json';
}

function installClaudeSettings() {
  const settingsPath = path.join(args.projectRoot, '.claude/settings.json');
  if (existsSync(settingsPath)) return 'preserved';
  const template = settingsTemplateForProfile();
  const content = readFileSync(path.join(FRAMEWORK_ROOT, 'templates', template), 'utf8');
  mkdirSync(path.dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, content, 'utf8');
  return `created from ${template}`;
}

function appendMissingLines(relativePath, lines) {
  const absolute = path.join(args.projectRoot, relativePath);
  const current = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
  const existing = new Set(current.split('\n'));
  const missing = lines.filter((line) => !existing.has(line));
  if (missing.length === 0) return false;
  const prefix = current && !current.endsWith('\n') ? '\n' : '';
  writeFileSync(absolute, `${current}${prefix}${missing.join('\n')}\n`, 'utf8');
  return true;
}

function ensureProjectClaudeSection() {
  const absolute = path.join(args.projectRoot, 'CLAUDE.md');
  const current = existsSync(absolute) ? readFileSync(absolute, 'utf8') : '';
  if (current.includes('<!-- RIFF-INSTALL:START -->')) return false;
  const section = `\n<!-- RIFF-INSTALL:START -->\n## RIFF\n\nThis project uses RIFF via the local \`.riff/\` symlink. Use \`/riff:start\`, \`/riff:map\`, and \`/riff:next\` from Claude Code. The framework source of truth lives under \`.riff/commands/\`, \`.riff/protocols/\`, and \`.riff/CLAUDE.md\`.\n<!-- RIFF-INSTALL:END -->\n`;
  writeFileSync(absolute, `${current}${current.endsWith('\n') || current === '' ? '' : '\n'}${section}`, 'utf8');
  return true;
}

async function resolveScope() {
  const existingConfig = readJsonIfExists('.planning/config.json');
  if (existingConfig?.scope) return existingConfig.scope;
  if (args.scope) return args.scope;
  if (input.isTTY && output.isTTY) {
    const rl = createInterface({ input, output });
    try {
      return await askChoice(rl, 'Project scope', ['production', 'scratch'], 'production');
    } finally {
      rl.close();
    }
  }
  output.write('No --scope provided and terminal is non-interactive; defaulting scope to production.\n');
  return 'production';
}

function nextSteps() {
  return [
    `  ${color('cyan', 'Claude:')} restart Claude Code, then ${color('green', '/riff:start')}`,
    `  ${color('cyan', 'Codex executor:')} no project install needed; RIFF calls Codex through the configured skill/CLI when available`,
  ].join('\n');
}

const args = parseArgs(process.argv.slice(process.argv[1]?.endsWith('riff') ? 3 : 2));

if (USE_COLOR) printBanner();

const gitInitialized = ensureGitRepo();
const riffLinked = installRiffSymlink();
const scope = await resolveScope();
const configWritten = ensurePlanning(scope);
installClaudeRuntime();
const profileStatus = await runProfileOnboarding(args.profile);
const settingsStatus = installClaudeSettings();
const gitignoreUpdated = appendMissingLines('.gitignore', ['.riff/', '.planning/debug/']);
const claudeSectionUpdated = ensureProjectClaudeSection();

function statusValue(flagText, condition) {
  return condition ? color('green', flagText) : color('dim', flagText);
}

process.stdout.write(`
${color('bold', 'RIFF installed')}
${color('cyan', 'project:')}         ${args.projectRoot}
${color('cyan', 'framework:')}       ${FRAMEWORK_ROOT}
${color('cyan', 'runtime files:')}   ${color('green', 'claude')}
${color('cyan', 'executor default:')} ${color('green', 'codex')}
${color('cyan', 'git initialized:')} ${statusValue(gitInitialized ? 'yes' : 'no', gitInitialized)}
${color('cyan', '.riff linked:')}    ${statusValue(riffLinked ? 'yes' : 'already correct', riffLinked)}
${color('cyan', 'config:')}          ${statusValue(configWritten ? 'created' : 'preserved', configWritten)}
${color('cyan', 'profile:')}         ${profileStatus}
${color('cyan', 'settings:')}        ${settingsStatus}
${color('cyan', '.gitignore:')}      ${statusValue(gitignoreUpdated ? 'updated' : 'already correct', gitignoreUpdated)}
${color('cyan', 'CLAUDE.md:')}       ${statusValue(claudeSectionUpdated ? 'updated' : 'already correct', claudeSectionUpdated)}

${color('bold', 'Next:')}
${nextSteps()}
`);

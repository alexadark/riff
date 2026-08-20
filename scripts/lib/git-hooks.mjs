import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const MARKER = '# RIFF managed Git-hook dispatcher.';
const EVENTS = Object.freeze(['pre-commit', 'commit-msg']);

function fail(message) { throw new Error(message); }

function git(projectRoot, args) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1' },
  }).trim();
}

function within(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(`${base}${path.sep}`);
}

function lstatOrNull(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function atomicExecutable(file, bytes) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o700);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.chmodSync(temporary, 0o755);
  fs.renameSync(temporary, file);
}

export function effectiveHooksDirectory(projectRoot) {
  const project = fs.realpathSync(projectRoot);
  const raw = git(project, ['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
  const hooks = path.resolve(raw);
  const common = fs.realpathSync(git(project, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  if (!within(project, hooks) && !within(common, hooks)) {
    fail(`effective Git hooks directory is outside the project and Git common directory: ${hooks}`);
  }
  return hooks;
}

function isOwnedDispatcher(file) {
  const stat = lstatOrNull(file);
  if (!stat || stat.isSymbolicLink() || !stat.isFile()) return false;
  return fs.readFileSync(file, 'utf8').split(/\r?\n/, 3).includes(MARKER);
}

function isLegacyRiffLink(file, projectRoot, event) {
  const stat = lstatOrNull(file);
  if (!stat?.isSymbolicLink()) return false;
  let resolved;
  try { resolved = fs.realpathSync(file); } catch { return false; }
  const expected = fs.realpathSync(path.join(projectRoot, '.riff', 'hooks', event === 'pre-commit' ? 'security-scan.sh' : 'commit-msg.sh'));
  return resolved === expected;
}

export function installGitHookDispatchers({ projectRoot, frameworkRoot }) {
  const project = fs.realpathSync(projectRoot);
  const framework = fs.realpathSync(frameworkRoot);
  const source = path.join(framework, 'hooks', 'git-hook-dispatch.sh');
  const sourceStat = fs.lstatSync(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) fail('RIFF Git hook dispatcher source must be a regular file');
  const bytes = fs.readFileSync(source);
  const hooks = effectiveHooksDirectory(project);
  fs.mkdirSync(hooks, { recursive: true, mode: 0o700 });
  const hooksStat = fs.lstatSync(hooks);
  if (!hooksStat.isDirectory() || hooksStat.isSymbolicLink()) fail('effective Git hooks path must be a real directory');

  const installed = [];
  for (const event of EVENTS) {
    const entry = path.join(hooks, event);
    const backup = path.join(hooks, `${event}.user`);
    const existing = lstatOrNull(entry);
    if (existing && !isOwnedDispatcher(entry) && !isLegacyRiffLink(entry, project, event)) {
      if (lstatOrNull(backup)) fail(`cannot chain existing ${event}: ${backup} already exists`);
      fs.renameSync(entry, backup);
    }
    atomicExecutable(entry, bytes);
    installed.push({ event, path: entry, user_hook: lstatOrNull(backup) ? backup : null });
  }
  return { hooks_directory: hooks, installed };
}

export function assertGitHookDispatchers(projectRoot) {
  const hooks = effectiveHooksDirectory(projectRoot);
  const source = path.join(fs.realpathSync(projectRoot), '.riff', 'hooks', 'git-hook-dispatch.sh');
  const sourceStat = lstatOrNull(source);
  if (!sourceStat || !sourceStat.isFile()) fail('RIFF Git hook dispatcher source is unavailable; run riff resync');
  const expected = fs.readFileSync(source);
  for (const event of EVENTS) {
    const file = path.join(hooks, event);
    if (!isOwnedDispatcher(file)) fail(`RIFF ${event} dispatcher is not installed in the effective Git hooks directory; run riff resync`);
    fs.accessSync(file, fs.constants.X_OK);
    if (!fs.readFileSync(file).equals(expected)) fail(`RIFF ${event} dispatcher differs from the installed framework source; run riff resync`);
  }
  return hooks;
}

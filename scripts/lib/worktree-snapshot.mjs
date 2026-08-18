import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveContainedPath } from './artifact-contracts.mjs';

const GIT_HELPER_TIMEOUT_MS = 30000;
const GIT_NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

function gitEnvironment() {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_NULL_DEVICE,
    GIT_CONFIG_SYSTEM: GIT_NULL_DEVICE,
    GIT_EXTERNAL_DIFF: '',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function gitArgs(argv) {
  return ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${GIT_NULL_DEVICE}`, ...argv];
}

function git(root, argv) {
  return execFileSync('git', gitArgs(argv), {
    cwd: root,
    encoding: 'buffer',
    env: gitEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: GIT_HELPER_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
  });
}

export function gitRoot(cwd = process.cwd()) {
  return execFileSync('git', gitArgs(['rev-parse', '--show-toplevel']), {
    cwd,
    encoding: 'utf8',
    env: gitEnvironment(),
    timeout: GIT_HELPER_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
  }).trim();
}

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function splitGitNullRecords(output) {
  const records = [];
  let start = 0;
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== 0) continue;
    if (index > start) records.push(output.subarray(start, index).toString('utf8'));
    start = index + 1;
  }
  if (start < output.length) records.push(output.subarray(start).toString('utf8'));
  return records;
}

function gitPaths(root) {
  const tracked = git(root, ['ls-files', '-z', '--cached']);
  const untracked = git(root, ['ls-files', '-z', '--others', '--exclude-standard']);
  const ignored = git(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard']);
  return [...new Set([tracked, untracked, ignored]
    .flatMap((output) => splitGitNullRecords(output)))]
    .filter((relative) => !ignoredPath(relative) || relative.replaceAll(path.sep, '/') === '.riff');
}

function dirtyPaths(root) {
  const paths = new Set();
  const add = (relative) => {
    const normalized = relative.replaceAll(path.sep, '/').replace(/^\.\//, '');
    if (!normalized || ignoredPath(normalized)) return;
    paths.add(normalized);
    let parent = path.posix.dirname(normalized);
    while (parent && parent !== '.') {
      paths.add(parent);
      parent = path.posix.dirname(parent);
    }
  };
  for (const args of [
    ['diff', '--name-only', '--no-ext-diff', '-z'],
    ['diff', '--cached', '--name-only', '--no-ext-diff', '-z'],
    ['ls-files', '-z', '--others', '--exclude-standard'],
    ['ls-files', '-z', '--others', '--ignored', '--exclude-standard'],
  ]) {
    for (const item of splitGitNullRecords(git(root, args))) add(item);
  }
  return [...paths].sort();
}

function ignoredPath(relative) {
  const normalized = relative.replaceAll(path.sep, '/');
  return normalized.startsWith('.riff/');
}

function fileRecord(root, relative) {
  if (ignoredPath(relative)) return undefined;
  const absolute = path.join(root, relative);
  let stat;
  try { stat = fs.lstatSync(absolute); } catch (error) {
    if (error.code === 'ENOENT') return { kind: 'missing' };
    throw error;
  }
  if (stat.isDirectory()) return { kind: 'directory', mode: (stat.mode & 0o7777).toString(8) };
  const record = { mode: (stat.mode & 0o7777).toString(8), size: stat.size };
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(absolute);
    record.kind = 'symlink';
    record.symlink_target = target;
    record.content_hash = hash(Buffer.from(target));
    return record;
  }
  if (!stat.isFile()) {
    record.kind = 'other';
    record.content_hash = hash(Buffer.from(`${stat.dev}:${stat.ino}:${stat.size}`));
    return record;
  }
  record.kind = 'file';
  record.content_hash = hash(fs.readFileSync(absolute));
  return record;
}

function porcelainStatusHash(root) {
  return hash(git(root, ['status', '--porcelain=v2', '--untracked-files=all']));
}

function stagedDiffHash(root) {
  return hash(git(root, ['diff', '--cached', '--binary', '--no-ext-diff']));
}

function statIdentity(stat) {
  return {
    dev: stat.dev,
    ino: stat.ino,
    ctime_ns: typeof stat.ctimeNs === 'bigint' ? stat.ctimeNs.toString() : undefined,
    ctime_ms: stat.ctimeMs,
    size: stat.size,
    mode: stat.mode,
  };
}

function metadataRecord(file, relative, { objectStore = false } = {}) {
  const stat = fs.lstatSync(file);
  const base = { mode: (stat.mode & 0o7777).toString(8), size: stat.size };
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(file);
    return { ...base, kind: 'symlink', symlink_target: target, content_hash: hash(Buffer.from(target)) };
  }
  if (stat.isDirectory()) return { ...base, kind: 'directory', ctime_ms: stat.ctimeMs };
  if (!stat.isFile()) return { ...base, kind: 'other', identity: statIdentity(stat) };
  if (objectStore) return { ...base, kind: 'file', identity: statIdentity(stat) };
  return { ...base, kind: 'file', content_hash: hash(fs.readFileSync(file)), relative };
}

function isObjectStorePath(relative) {
  const normalized = relative.replaceAll(path.sep, '/');
  return normalized === 'objects' || normalized.startsWith('objects/');
}

function assertSafeMetadataDirectory(candidate, label) {
  if (!candidate || !path.isAbsolute(candidate)) {
    throw new Error(`Git did not return an absolute ${label} directory`);
  }
  const absolute = path.normalize(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      throw new Error(`Git ${label} directory is unavailable: ${error.message}`);
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Git ${label} directory contains a symbolic-link component: ${absolute}`);
    }
    if (!stat.isDirectory()) {
      throw new Error(`Git ${label} directory contains a non-directory component: ${absolute}`);
    }
  }
  let finalStat;
  try {
    finalStat = fs.lstatSync(absolute);
  } catch (error) {
    throw new Error(`Git ${label} directory is unavailable: ${error.message}`);
  }
  if (!finalStat.isDirectory() || finalStat.isSymbolicLink()) {
    throw new Error(`Git ${label} path is not a real directory: ${absolute}`);
  }
  return absolute;
}

function captureMetadataDirectory(root, namespace, metadata) {
  const walk = (absolute, relative) => {
    let stat;
    try { stat = fs.lstatSync(absolute); } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    const objectStore = isObjectStorePath(relative);
    const namespaced = `${namespace}/${relative || '.'}`;
    metadata[namespaced] = metadataRecord(absolute, relative, { objectStore });
    if (!stat.isDirectory() || stat.isSymbolicLink()) return;
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      walk(path.join(absolute, entry.name), relative ? path.join(relative, entry.name) : entry.name);
    }
  };
  walk(root, '');
}

function captureGitMetadata(root) {
  const gitDirectory = assertSafeMetadataDirectory(
    git(root, ['rev-parse', '--absolute-git-dir']).toString('utf8').trim(),
    'worktree metadata',
  );
  const commonDirectory = assertSafeMetadataDirectory(
    git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir']).toString('utf8').trim(),
    'common metadata',
  );
  const entries = {};
  captureMetadataDirectory(gitDirectory, 'worktree', entries);
  if (commonDirectory !== gitDirectory) captureMetadataDirectory(commonDirectory, 'common', entries);
  return { root: gitDirectory, common_root: commonDirectory, entries };
}

/** Capture tracked, non-ignored untracked, and ignored files except .riff. */
export function snapshotWorktree({ root = gitRoot(), explicitPaths = [] } = {}) {
  const gitRootPath = fs.realpathSync(root);
  const paths = new Set(gitPaths(gitRootPath));
  paths.add('.riff');
  for (const candidate of explicitPaths) {
    const absolute = resolveContainedPath(gitRootPath, candidate, { allowMissing: true });
    paths.add(path.relative(gitRootPath, absolute));
  }
  for (const relative of [...paths]) {
    let parent = path.dirname(relative);
    while (parent && parent !== '.') {
      paths.add(parent);
      parent = path.dirname(parent);
    }
  }
  const files = {};
  for (const relative of [...paths].sort()) {
    const record = fileRecord(gitRootPath, relative);
    if (record) files[relative.replaceAll(path.sep, '/')] = record;
  }
  const statusHash = porcelainStatusHash(gitRootPath);
  const stagedHash = stagedDiffHash(gitRootPath);
  const gitMetadata = captureGitMetadata(gitRootPath);
  const dirty = dirtyPaths(gitRootPath);
  const snapshotBody = { files, stagedHash, statusHash, gitMetadata };
  return {
    schema_version: 2,
    root: gitRootPath,
    captured_at: new Date().toISOString(),
    files,
    git_metadata_root: gitMetadata.root,
    git_metadata_roots: { worktree: gitMetadata.root, common: gitMetadata.common_root },
    git_metadata: gitMetadata.entries,
    staged_diff_hash: stagedHash,
    porcelain_v2_status_hash: statusHash,
    status_hash: statusHash,
    dirty_paths: dirty,
    snapshot_hash: hash(Buffer.from(JSON.stringify(snapshotBody))),
  };
}

function equalRecord(a, b) { return JSON.stringify(a || null) === JSON.stringify(b || null); }

export function compareSnapshots(before, after) {
  const beforeFiles = before?.files || {};
  const afterFiles = after?.files || {};
  const paths = [...new Set([...Object.keys(beforeFiles), ...Object.keys(afterFiles)])].sort();
  const added = []; const removed = []; const modified = [];
  for (const relative of paths) {
    if (!beforeFiles[relative] && afterFiles[relative]) added.push(relative);
    else if (beforeFiles[relative] && !afterFiles[relative]) removed.push(relative);
    else if (!equalRecord(beforeFiles[relative], afterFiles[relative])) modified.push(relative);
  }
  const changed = [...added, ...removed, ...modified].sort();
  const beforeMetadata = before?.git_metadata || {};
  const afterMetadata = after?.git_metadata || {};
  const metadataPaths = [...new Set([...Object.keys(beforeMetadata), ...Object.keys(afterMetadata)])].sort();
  const gitMetadataAdded = []; const gitMetadataRemoved = []; const gitMetadataModified = [];
  for (const relative of metadataPaths) {
    if (!beforeMetadata[relative] && afterMetadata[relative]) gitMetadataAdded.push(relative);
    else if (beforeMetadata[relative] && !afterMetadata[relative]) gitMetadataRemoved.push(relative);
    else if (!equalRecord(beforeMetadata[relative], afterMetadata[relative])) gitMetadataModified.push(relative);
  }
  const gitMetadataChanged = [...gitMetadataAdded, ...gitMetadataRemoved, ...gitMetadataModified].sort();
  const beforeMetadataRoots = before?.git_metadata_roots || { worktree: before?.git_metadata_root };
  const afterMetadataRoots = after?.git_metadata_roots || { worktree: after?.git_metadata_root };
  const gitMetadataRootChanged = JSON.stringify(beforeMetadataRoots) !== JSON.stringify(afterMetadataRoots);
  const stagedDiffChanged = before?.staged_diff_hash !== after?.staged_diff_hash;
  const statusChanged = before?.porcelain_v2_status_hash !== after?.porcelain_v2_status_hash;
  return {
    changed,
    added,
    removed,
    modified,
    exact_worker_deltas: changed,
    git_metadata_changed: gitMetadataChanged.length > 0,
    git_metadata_root_changed: gitMetadataRootChanged,
    git_metadata_changed_paths: gitMetadataChanged,
    git_metadata_changed_files: gitMetadataChanged.map((item) => path.join('.git', item).replaceAll(path.sep, '/')),
    git_metadata_added: gitMetadataAdded,
    git_metadata_removed: gitMetadataRemoved,
    git_metadata_modified: gitMetadataModified,
    staged_diff_changed: stagedDiffChanged,
    status_changed: statusChanged,
    clean: changed.length === 0 && gitMetadataChanged.length === 0 && !gitMetadataRootChanged && !stagedDiffChanged && !statusChanged,
  };
}

export function snapshotHash(snapshot) {
  return hash(Buffer.from(JSON.stringify(snapshot)));
}

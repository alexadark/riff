import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

import { compareSnapshots, snapshotWorktree } from './worktree-snapshot.mjs';

const NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
const GIT_TIMEOUT_MS = 30_000;
const DARWIN_WORKER_CONTAINER_BASE = '/Users/Shared';
const LINUX_WORKER_CONTAINER_BASE = '/dev/shm';
const DARWIN_CODESIGN = '/usr/bin/codesign';
const DARWIN_BUN_TEAM_IDENTIFIER = '7FRXF46ZSN';
const RUNTIME_LEASE_FILE = '.riff-next-runtime-lease';
const RUNTIME_DIRECTORY_PREFIX = 'riff-next-';

const runtimeLeaseState = {
  path: undefined,
  fd: undefined,
  inode: undefined,
  token: undefined,
  references: 0,
};
const runtimeLeaseHandles = new WeakMap();
const releasedRuntimeLeaseHandles = new WeakSet();

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function pathWithin(root, target) {
  const normalizedRoot = path.resolve(root);
  const normalizedTarget = path.resolve(target);
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}${path.sep}`);
}

function hostHomeDirectory() {
  return os.userInfo().homedir;
}

function realDirectory(candidate, label) {
  let resolved;
  try { resolved = fs.realpathSync(candidate); } catch (error) { throw new Error(`${label} is unavailable: ${error.message}`); }
  let stat;
  try { stat = fs.statSync(resolved); } catch (error) { throw new Error(`${label} cannot be inspected: ${error.message}`); }
  if (!stat.isDirectory()) throw new Error(`${label} must be a directory`);
  return resolved;
}

function secureWorkerContainerBase() {
  const candidate = process.platform === 'darwin' ? DARWIN_WORKER_CONTAINER_BASE : process.platform === 'linux' ? LINUX_WORKER_CONTAINER_BASE : undefined;
  if (!candidate) throw new Error(`worker sandbox requires a supported secure container base on ${process.platform}`);
  const base = realDirectory(candidate, 'worker secure container base');
  const home = realDirectory(hostHomeDirectory(), 'host home');
  const sharedTemp = realDirectory(os.tmpdir(), 'shared temporary directory');
  if (pathWithin(home, base) || pathWithin(sharedTemp, base) || pathWithin(base, home) || pathWithin(base, sharedTemp)) {
    throw new Error('worker secure container base must be outside host home and shared temporary directories');
  }
  return base;
}

function processUid() {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function runtimeLeasePath(base) {
  return path.join(base, RUNTIME_LEASE_FILE);
}

function leaseOwnerAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error.code === 'EPERM') return true;
    if (error.code === 'ESRCH') return false;
    return true;
  }
}

function readRuntimeLease(pathname, expected = {}) {
  let stat;
  try { stat = fs.lstatSync(pathname); } catch (error) { throw new Error(`RIFF runtime lease is unavailable: ${error.message}`); }
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('RIFF runtime lease must be a regular file');
  const uid = processUid();
  if (uid !== undefined && stat.uid !== uid) throw new Error('RIFF runtime lease owner uid mismatch');
  let record;
  try { record = JSON.parse(fs.readFileSync(pathname, 'utf8')); } catch (error) { throw new Error(`RIFF runtime lease is corrupt: ${error.message}`); }
  if (!record || !Number.isSafeInteger(record.pid) || record.pid <= 0 || typeof record.token !== 'string' || !record.token
    || !Number.isSafeInteger(record.inode) || record.inode !== stat.ino
    || (uid !== undefined && record.uid !== uid) || record.uid !== stat.uid) {
    throw new Error('RIFF runtime lease ownership record is invalid');
  }
  if (expected.inode !== undefined && record.inode !== expected.inode) throw new Error('RIFF runtime lease inode changed');
  if (expected.uid !== undefined && (record.uid !== expected.uid || stat.uid !== expected.uid)) throw new Error('RIFF runtime lease uid changed');
  if (expected.token !== undefined && record.token !== expected.token) throw new Error('RIFF runtime lease content changed');
  if (expected.pid !== undefined && record.pid !== expected.pid) throw new Error('RIFF runtime lease pid changed');
  return { stat, record };
}

function unlinkOwnedRuntimeLease(pathname, expected) {
  readRuntimeLease(pathname, expected);
  fs.unlinkSync(pathname);
}

function recoverStaleRuntimeLease(pathname) {
  const { stat, record } = readRuntimeLease(pathname);
  if (leaseOwnerAlive(record.pid)) throw new Error(`RIFF runtime lease is held by another process (pid ${record.pid})`);
  try {
    unlinkOwnedRuntimeLease(pathname, { inode: stat.ino, uid: stat.uid, pid: record.pid, token: record.token });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
}

function assertCurrentRuntimeLease() {
  if (!runtimeLeaseState.path || runtimeLeaseState.references < 1) throw new Error('RIFF runtime lease is not held by this process');
  readRuntimeLease(runtimeLeaseState.path, {
    inode: runtimeLeaseState.inode,
    uid: processUid(),
    token: runtimeLeaseState.token,
    pid: process.pid,
  });
}

function makeRuntimeLeaseHandle() {
  const handle = Object.freeze({
    path: runtimeLeaseState.path,
    inode: runtimeLeaseState.inode,
    token: runtimeLeaseState.token,
    pid: process.pid,
  });
  runtimeLeaseHandles.set(handle, true);
  return handle;
}

export function acquireRuntimeLease() {
  const base = secureWorkerContainerBase();
  const pathname = runtimeLeasePath(base);
  if (runtimeLeaseState.references > 0) {
    if (runtimeLeaseState.path !== pathname) throw new Error('RIFF runtime lease base changed while held');
    assertCurrentRuntimeLease();
    runtimeLeaseState.references += 1;
    return makeRuntimeLeaseHandle();
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let fd;
    let tempPath;
    let published = false;
    let publishedRecord;
    try {
      const token = crypto.randomBytes(24).toString('hex');
      tempPath = path.join(base, `.${RUNTIME_LEASE_FILE}.${process.pid}.${token}.tmp`);
      fd = fs.openSync(tempPath, 'wx', 0o600);
      const stat = fs.fstatSync(fd);
      const uid = processUid();
      const record = { pid: process.pid, uid: uid === undefined ? stat.uid : uid, inode: stat.ino, token };
      publishedRecord = record;
      fs.writeFileSync(fd, JSON.stringify(record));
      fs.fsyncSync(fd);
      fs.chmodSync(tempPath, 0o400);
      fs.fsyncSync(fd);
      fs.linkSync(tempPath, pathname);
      published = true;
      readRuntimeLease(pathname, { inode: stat.ino, uid: stat.uid, pid: process.pid, token });
      fs.unlinkSync(tempPath);
      const verified = fs.fstatSync(fd);
      if (verified.ino !== stat.ino || (uid !== undefined && verified.uid !== uid)) throw new Error('RIFF runtime lease changed during creation');
      runtimeLeaseState.path = pathname;
      runtimeLeaseState.fd = fd;
      runtimeLeaseState.inode = stat.ino;
      runtimeLeaseState.token = token;
      runtimeLeaseState.references = 1;
      return makeRuntimeLeaseHandle();
    } catch (error) {
      if (fd !== undefined) {
        if (published) {
          try {
            const owned = fs.fstatSync(fd);
            const current = fs.lstatSync(pathname);
            if (current.ino === owned.ino && publishedRecord && (publishedRecord.uid === undefined || current.uid === publishedRecord.uid)) {
              unlinkOwnedRuntimeLease(pathname, publishedRecord);
            }
          } catch { /* preserve original error */ }
        }
        try { if (tempPath) fs.unlinkSync(tempPath); } catch { /* preserve original error */ }
        try { fs.closeSync(fd); } catch { /* preserve original error */ }
      }
      if (error.code !== 'EEXIST' || attempt > 0) throw error.code === 'EEXIST' ? new Error('RIFF runtime lease is held by another process') : error;
      recoverStaleRuntimeLease(pathname);
    }
  }
  throw new Error('RIFF runtime lease acquisition failed');
}

export function releaseRuntimeLease(handle) {
  if (!handle || !runtimeLeaseHandles.has(handle) || releasedRuntimeLeaseHandles.has(handle)) return;
  if (runtimeLeaseState.references < 1) throw new Error('RIFF runtime lease reference count is invalid');
  assertCurrentRuntimeLease();
  releasedRuntimeLeaseHandles.add(handle);
  runtimeLeaseState.references -= 1;
  if (runtimeLeaseState.references > 0) return;
  let releaseError;
  try {
    readRuntimeLease(runtimeLeaseState.path, {
      inode: runtimeLeaseState.inode,
      uid: processUid(),
      token: runtimeLeaseState.token,
      pid: process.pid,
    });
    unlinkOwnedRuntimeLease(runtimeLeaseState.path, {
      inode: runtimeLeaseState.inode,
      uid: processUid(),
      pid: process.pid,
      token: runtimeLeaseState.token,
    });
  } catch (error) { releaseError = error; }
  try { fs.closeSync(runtimeLeaseState.fd); } catch (error) { if (!releaseError) releaseError = error; }
  runtimeLeaseState.path = undefined;
  runtimeLeaseState.fd = undefined;
  runtimeLeaseState.inode = undefined;
  runtimeLeaseState.token = undefined;
  runtimeLeaseState.references = 0;
  if (releaseError) throw releaseError;
}

export function runtimeSiblingPaths(currentContainerRoot = undefined) {
  const base = secureWorkerContainerBase();
  let current;
  if (currentContainerRoot) {
    try { current = fs.realpathSync(currentContainerRoot); } catch (error) { throw new Error(`current RIFF runtime container is unavailable: ${error.message}`); }
  }
  const siblings = [];
  for (const entry of fs.readdirSync(base, { withFileTypes: true })) {
    if (!entry.name.startsWith(RUNTIME_DIRECTORY_PREFIX)) continue;
    const candidate = path.join(base, entry.name);
    let stat;
    try { stat = fs.lstatSync(candidate); } catch (error) { throw new Error(`RIFF runtime sibling cannot be inspected: ${error.message}`); }
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`RIFF runtime sibling must be a real directory: ${entry.name}`);
    let resolved;
    try { resolved = fs.realpathSync(candidate); } catch (error) { throw new Error(`RIFF runtime sibling cannot be resolved: ${error.message}`); }
    if (resolved !== candidate) throw new Error(`RIFF runtime sibling must remain lexical: ${entry.name}`);
    if (resolved !== current) siblings.push(resolved);
  }
  return siblings;
}

function createSecureWorkerContainer(prefix) {
  const containerRoot = fs.mkdtempSync(path.join(secureWorkerContainerBase(), prefix));
  fs.chmodSync(containerRoot, 0o700);
  return containerRoot;
}

export function createSecureRuntimeContainer(prefix = 'riff-next-runtime-') {
  return createSecureWorkerContainer(prefix);
}

function executablePath(command) {
  const pathValue = process.env.PATH || '';
  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile()) return fs.realpathSync(candidate);
    } catch { /* continue */ }
  }
  return undefined;
}

function toolchainEnvironment() {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
}

function standaloneToolProbeEnvironment() {
  return {
    PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
    LANG: 'C',
    LC_ALL: 'C',
  };
}

function compatibleDarwinBun(candidate) {
  if (process.platform !== 'darwin') return false;
  const verification = spawnSync(DARWIN_CODESIGN, ['--verify', '--strict', candidate], {
    encoding: 'utf8', env: standaloneToolProbeEnvironment(), timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (verification.error || verification.status !== 0) return false;
  const details = spawnSync(DARWIN_CODESIGN, ['-dv', '--verbose=4', candidate], {
    encoding: 'utf8', env: standaloneToolProbeEnvironment(), timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (details.error || details.status !== 0) return false;
  const metadata = `${details.stdout || ''}\n${details.stderr || ''}`;
  return /^Identifier=bun$/m.test(metadata)
    && new RegExp(`^TeamIdentifier=${DARWIN_BUN_TEAM_IDENTIFIER}$`, 'm').test(metadata)
    && new RegExp(`^Authority=Developer ID Application: .+ \\(${DARWIN_BUN_TEAM_IDENTIFIER}\\)$`, 'm').test(metadata);
}

function compatibleNode(nodeReal) {
  let output;
  try {
    output = execFileSync(nodeReal, ['-p', 'JSON.stringify({ platform: process.platform, arch: process.arch, modules: process.versions.modules })'], {
      encoding: 'utf8', env: toolchainEnvironment(), timeout: 15_000, maxBuffer: 16 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { return false; }
  let probe;
  try { probe = JSON.parse(output); } catch { return false; }
  return probe?.platform === process.platform && probe?.arch === process.arch && String(probe?.modules) === String(process.versions.modules);
}

function validNpmVersion(nodeReal, npmReal) {
  let output;
  try {
    output = execFileSync(nodeReal, [npmReal, '--version'], {
      encoding: 'utf8', env: toolchainEnvironment(), timeout: 15_000, maxBuffer: 16 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch { return false; }
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(output);
}

function compatibleDarwinNode(nodeReal) {
  if (process.platform !== 'darwin') return true;
  const details = spawnSync(DARWIN_CODESIGN, ['-dv', '--verbose=4', nodeReal], {
    encoding: 'utf8', env: toolchainEnvironment(), timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (details.error || details.status !== 0) return true;
  const metadata = `${details.stdout || ''}\n${details.stderr || ''}`;
  if (!/flags\s*=\s*0x[0-9a-f]+\s*\([^)]*runtime[^)]*\)/i.test(metadata)) return true;
  const entitlements = spawnSync(DARWIN_CODESIGN, ['-d', '--entitlements', ':-', nodeReal], {
    encoding: 'utf8', env: toolchainEnvironment(), timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const plist = `${entitlements.stdout || ''}\n${entitlements.stderr || ''}`;
  return entitlements.status === 0 && /<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\s*\/?\s*>/i.test(plist);
}

function validToolchainRoot(candidate, sharedTemp) {
  let root;
  try { root = fs.realpathSync(candidate); } catch { return undefined; }
  if (pathWithin(sharedTemp, root) || pathWithin(root, sharedTemp)) return undefined;
  const nodeCandidate = path.join(root, 'bin', 'node');
  const npmCandidate = path.join(root, 'bin', 'npm');
  let nodeReal;
  let npmReal;
  try {
    nodeReal = fs.realpathSync(nodeCandidate);
    npmReal = fs.realpathSync(npmCandidate);
    if (!fs.statSync(nodeReal).isFile() || !fs.statSync(npmReal).isFile()) return undefined;
    fs.accessSync(nodeReal, fs.constants.X_OK);
    fs.accessSync(npmReal, fs.constants.X_OK);
  } catch { return undefined; }
  if (!pathWithin(root, nodeReal) || !pathWithin(root, npmReal)) return undefined;
  if (!compatibleNode(nodeReal) || !validNpmVersion(nodeReal, npmReal) || !compatibleDarwinNode(nodeReal)) return undefined;
  return root;
}

function ancestorDirectories(candidate) {
  const start = path.resolve(candidate);
  let current = start;
  try { if (!fs.statSync(current).isDirectory()) current = path.dirname(current); }
  catch { current = path.dirname(current); }
  const result = [];
  while (true) {
    result.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return result;
}

export function resolveExternalNodeToolchain() {
  const sharedTemp = realDirectory(os.tmpdir(), 'shared temporary directory');
  const npmReal = executablePath('npm');
  if (npmReal) {
    for (const candidate of ancestorDirectories(npmReal)) {
      const valid = validToolchainRoot(candidate, sharedTemp);
      if (valid) return valid;
    }
  }
  let nodeReal;
  try { nodeReal = fs.realpathSync(process.execPath); } catch { nodeReal = undefined; }
  if (nodeReal) {
    for (const candidate of ancestorDirectories(nodeReal)) {
      const valid = validToolchainRoot(candidate, sharedTemp);
      if (valid) return valid;
    }
  }
  if (!npmReal) throw new Error('external Node toolchain is unavailable: npm was not found');
  throw new Error('external Node toolchain must contain usable bin/node and bin/npm outside the shared temporary directory');
}

function copyToolchainEntry(source, destination, sourceRoot, bundleRoot) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    const target = fs.realpathSync(source);
    if (!pathWithin(sourceRoot, target)) throw new Error(`node toolchain symlink escapes its source root: ${path.relative(sourceRoot, source)}`);
    const bundledTarget = path.join(bundleRoot, path.relative(sourceRoot, target));
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.symlinkSync(path.relative(path.dirname(destination), bundledTarget), destination);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
    fs.cpSync(source, destination, { recursive: true, dereference: false, force: false, errorOnExist: true });
    fs.chmodSync(destination, stat.mode & 0o7777);
    return;
  }
  if (!stat.isFile()) throw new Error(`node toolchain contains unsupported special file: ${path.relative(sourceRoot, source)}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, stat.mode & 0o7777);
}

function validateToolchainSymlinks(bundleRoot) {
  const pending = [bundleRoot];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        let resolved;
        try { resolved = fs.realpathSync(target); } catch (error) { throw new Error(`node toolchain contains a broken symlink: ${path.relative(bundleRoot, target)} (${error.message})`); }
        if (!pathWithin(bundleRoot, resolved)) throw new Error(`node toolchain symlink escapes its bundle: ${path.relative(bundleRoot, target)}`);
      } else if (entry.isDirectory()) pending.push(target);
    }
  }
}

const PRIVATE_TOOLCHAIN_EXECUTABLES = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun']);

function requiredToolchainExecutables(values) {
  const names = [...new Set((values || []).map((value) => String(value || '').trim()).filter(Boolean))];
  const unsupported = names.filter((name) => !PRIVATE_TOOLCHAIN_EXECUTABLES.has(name));
  if (unsupported.length) throw new Error(`private toolchain does not support executable: ${unsupported.join(', ')}`);
  return names;
}

function executableRecord(file, label) {
  const resolved = fs.realpathSync(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must resolve to a real regular file`);
  fs.accessSync(resolved, fs.constants.X_OK);
  return {
    resolved,
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mode: stat.mode & 0o7777,
    mtimeMs: stat.mtimeMs,
    contentHash: hash(fs.readFileSync(resolved)),
  };
}

function copyStandaloneExecutable(name, bundleRoot, forbiddenRoots) {
  if (name !== 'bun') throw new Error(`standalone private toolchain executable is unsupported: ${name}`);
  const source = executablePath(name);
  if (!source) throw new Error(`planned smoke executable is unavailable: ${name}`);
  const sharedTemp = realDirectory(os.tmpdir(), 'shared temporary directory');
  const sharedSlashTemp = realDirectory('/tmp', 'shared /tmp directory');
  const forbidden = [sharedTemp, sharedSlashTemp, ...(forbiddenRoots || [])]
    .map((candidate) => fs.realpathSync(candidate));
  if (forbidden.some((root) => pathWithin(root, source))) {
    throw new Error(`planned smoke executable comes from a forbidden source root: ${name}`);
  }
  const before = executableRecord(source, `planned smoke executable ${name}`);
  if (!compatibleDarwinBun(before.resolved)) throw new Error('planned Bun executable failed signature verification');
  const destination = path.join(bundleRoot, 'bin', name);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(before.resolved, destination, fs.constants.COPYFILE_FICLONE || 0);
  fs.chmodSync(destination, before.mode);
  const after = executableRecord(source, `planned smoke executable ${name}`);
  const copied = executableRecord(destination, `bundled smoke executable ${name}`);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
    || before.mode !== after.mode || before.mtimeMs !== after.mtimeMs || before.contentHash !== after.contentHash) {
    throw new Error(`planned smoke executable changed while it was bundled: ${name}`);
  }
  if (copied.contentHash !== before.contentHash || copied.mode !== before.mode) {
    throw new Error(`bundled smoke executable differs from its source: ${name}`);
  }
  if (!compatibleDarwinBun(after.resolved) || !compatibleDarwinBun(copied.resolved)) {
    throw new Error('planned Bun executable signature changed while it was bundled');
  }
}

export function createNodeToolchainBundle(containerRoot, { directory = 'toolchain', requiredExecutables = [], forbiddenExecutableRoots = [] } = {}) {
  const container = fs.realpathSync(containerRoot);
  const secureBase = secureWorkerContainerBase();
  if (!pathWithin(secureBase, container) || pathWithin(realDirectory(hostHomeDirectory(), 'host home'), container)
    || pathWithin(realDirectory(os.tmpdir(), 'shared temporary directory'), container)) {
    throw new Error('node toolchain bundle container must remain inside the secure runtime container base');
  }
  const sourceRoot = resolveExternalNodeToolchain();
  const required = requiredToolchainExecutables(requiredExecutables);
  const bundleRoot = path.join(container, directory);
  if (!pathWithin(container, bundleRoot)) throw new Error('node toolchain bundle path escapes its container');
  fs.mkdirSync(bundleRoot, { mode: 0o700 });
  try {
    const sourceBin = path.join(sourceRoot, 'bin');
    const sourceNpmPackage = path.join(sourceRoot, 'lib', 'node_modules', 'npm');
    const npmPackageStat = fs.lstatSync(sourceNpmPackage);
    if (!npmPackageStat.isDirectory() || npmPackageStat.isSymbolicLink()) throw new Error('external Node toolchain npm package must be a real directory');
    copyToolchainEntry(sourceNpmPackage, path.join(bundleRoot, 'lib', 'node_modules', 'npm'), sourceRoot, bundleRoot);
    for (const name of ['node', 'npm', 'npx']) {
      const source = path.join(sourceBin, name);
      let stat;
      try { stat = fs.lstatSync(source); } catch (error) {
        if (name === 'npx' && error.code === 'ENOENT') continue;
        throw new Error(`external Node toolchain is missing bin/${name}: ${error.message}`);
      }
      if (!stat.isFile() && !stat.isSymbolicLink()) throw new Error(`external Node toolchain bin/${name} must be a file or symlink`);
      copyToolchainEntry(source, path.join(bundleRoot, 'bin', name), sourceRoot, bundleRoot);
    }
    const optionalPackages = new Map([
      ['corepack', 'corepack'],
      ['pnpm', 'pnpm'],
      ['pnpx', 'pnpm'],
      ['yarn', 'corepack'],
      ['yarnpkg', 'corepack'],
    ]);
    for (const [wrapper, packageName] of optionalPackages) {
      const source = path.join(sourceBin, wrapper);
      if (!fs.existsSync(source)) continue;
      const sourcePackage = path.join(sourceRoot, 'lib', 'node_modules', packageName);
      let packageStat;
      try { packageStat = fs.lstatSync(sourcePackage); } catch { continue; }
      if (!packageStat.isDirectory() || packageStat.isSymbolicLink()) continue;
      const destinationPackage = path.join(bundleRoot, 'lib', 'node_modules', packageName);
      if (!fs.existsSync(destinationPackage)) copyToolchainEntry(sourcePackage, destinationPackage, sourceRoot, bundleRoot);
      copyToolchainEntry(source, path.join(bundleRoot, 'bin', wrapper), sourceRoot, bundleRoot);
    }
    if (required.includes('bun') && !fs.existsSync(path.join(bundleRoot, 'bin', 'bun'))) {
      copyStandaloneExecutable('bun', bundleRoot, forbiddenExecutableRoots);
    }
    validateToolchainSymlinks(bundleRoot);
    for (const name of ['node', 'npm']) {
      const copied = path.join(bundleRoot, 'bin', name);
      const resolved = fs.realpathSync(copied);
      if (!pathWithin(bundleRoot, resolved) || !fs.statSync(resolved).isFile()) throw new Error(`bundled Node toolchain bin/${name} is unusable`);
      fs.accessSync(resolved, fs.constants.X_OK);
    }
    const bundledNode = fs.realpathSync(path.join(bundleRoot, 'bin', 'node'));
    const bundledNpm = fs.realpathSync(path.join(bundleRoot, 'bin', 'npm'));
    if (!compatibleNode(bundledNode) || !validNpmVersion(bundledNode, bundledNpm) || !compatibleDarwinNode(bundledNode)) {
      throw new Error('bundled Node toolchain failed runner compatibility checks');
    }
    for (const name of required) {
      const bundled = path.join(bundleRoot, 'bin', name);
      let record;
      try { record = executableRecord(bundled, `bundled smoke executable ${name}`); }
      catch (error) { throw new Error(`planned smoke executable is unavailable in the private toolchain: ${name} (${error.message})`); }
      if (!pathWithin(bundleRoot, record.resolved)) throw new Error(`bundled smoke executable escapes the private toolchain: ${name}`);
    }
    if (required.includes('bun')) {
      const bun = fs.realpathSync(path.join(bundleRoot, 'bin', 'bun'));
      const probe = spawnSync(bun, ['--version'], {
        cwd: bundleRoot, encoding: 'utf8', env: standaloneToolProbeEnvironment(), timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
      });
      if (probe.error || probe.status !== 0 || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\s*$/.test(probe.stdout || '')) {
        throw new Error('bundled Bun executable failed runner compatibility checks');
      }
    }
    return bundleRoot;
  } catch (error) {
    try { fs.rmSync(bundleRoot, { recursive: true, force: true }); } catch { /* preserve original error */ }
    throw error;
  }
}

export function createRoleBundle(containerRoot, frameworkRoot, canonicalRoleSpecPath, { directory = 'bundle' } = {}) {
  const sourcePath = path.resolve(canonicalRoleSpecPath);
  const framework = path.resolve(frameworkRoot);
  if (fs.realpathSync(framework) !== framework) throw new Error('framework root must remain at its lexical path');
  if (!pathWithin(framework, sourcePath)) throw new Error('canonical role specification must remain inside the framework');
  let sourceStat;
  try { sourceStat = fs.lstatSync(sourcePath); } catch (error) { throw new Error(`canonical role specification is unavailable: ${error.message}`); }
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink() || fs.realpathSync(sourcePath) !== sourcePath) throw new Error('canonical role specification must be a non-symlink lexical regular file');
  const relativeRolePath = path.relative(framework, sourcePath);
  const bundleRoot = path.join(containerRoot, directory);
  const roleSpecPath = path.join(bundleRoot, relativeRolePath);
  fs.mkdirSync(path.dirname(roleSpecPath), { recursive: true, mode: 0o700 });
  fs.copyFileSync(sourcePath, roleSpecPath);
  fs.chmodSync(path.dirname(bundleRoot), 0o700);
  let current = path.dirname(roleSpecPath);
  while (pathWithin(bundleRoot, current)) {
    fs.chmodSync(current, 0o500);
    if (current === bundleRoot) break;
    current = path.dirname(current);
  }
  fs.chmodSync(roleSpecPath, 0o400);
  return { bundleRoot, roleSpecPath, sourcePath, hash: hash(fs.readFileSync(sourcePath)) };
}

export function verifyRoleBundle(bundle) {
  if (!bundle) return;
  const sourceHash = hash(fs.readFileSync(bundle.sourcePath));
  const copyHash = hash(fs.readFileSync(bundle.roleSpecPath));
  if (sourceHash !== bundle.hash || copyHash !== bundle.hash) throw new Error('role bundle changed or no longer matches its canonical specification');
}

export function verifyWorkerBundle(bundle) {
  try { verifyRoleBundle(bundle); }
  catch (error) { throw new Error(`worker ${error.message}`); }
}

function unlockRoleBundle(bundle) {
  if (!bundle) return;
  try { fs.chmodSync(bundle.roleSpecPath, 0o600); } catch { /* preserve cleanup attempt */ }
  let current = path.dirname(bundle.roleSpecPath);
  while (pathWithin(bundle.bundleRoot, current)) {
    try { fs.chmodSync(current, 0o700); } catch { /* preserve cleanup attempt */ }
    if (current === bundle.bundleRoot) break;
    current = path.dirname(current);
  }
}

function normalized(relative) {
  return String(relative).replaceAll(path.sep, '/').replace(/^\.\//, '');
}

function gitEnv() {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: NULL_DEVICE,
    GIT_CONFIG_SYSTEM: NULL_DEVICE,
    GIT_EXTERNAL_DIFF: '',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function gitArgs(args) {
  return ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${NULL_DEVICE}`, ...args];
}

function git(root, args, { encoding = 'utf8' } = {}) {
  return execFileSync('git', gitArgs(args), {
    cwd: root,
    env: gitEnv(),
    encoding,
    timeout: GIT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertLexical(root, relative, { allowMissingFinal = false, allowMissingComponents = false } = {}) {
  const normalizedRoot = fs.realpathSync(root);
  const target = path.resolve(normalizedRoot, relative);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`worker staging path escapes project root: ${relative}`);
  }
  const parts = path.relative(normalizedRoot, target).split(path.sep).filter(Boolean);
  let current = normalizedRoot;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && (allowMissingComponents || (allowMissingFinal && index === parts.length - 1))) return target;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`worker promotion path contains a symlink: ${path.relative(normalizedRoot, current)}`);
    if (index < parts.length - 1 && !stat.isDirectory()) throw new Error(`worker promotion parent is not a directory: ${relative}`);
  }
  return target;
}

function preserveSymlinkMode(destination, mode, relative) {
  const expectedMode = mode & 0o7777;
  if ((fs.lstatSync(destination).mode & 0o7777) === expectedMode) return;
  if (typeof fs.lchmodSync !== 'function') {
    throw new Error(`consumer symlink mode cannot be preserved: ${relative}`);
  }
  try {
    fs.lchmodSync(destination, expectedMode);
  } catch (error) {
    throw new Error(`consumer symlink mode cannot be preserved: ${relative} (${error.message})`);
  }
  if ((fs.lstatSync(destination).mode & 0o7777) !== expectedMode) {
    throw new Error(`consumer symlink mode differs after copy: ${relative}`);
  }
}

function copyEntry(source, destination, relative = '') {
  const stat = fs.lstatSync(source);
  if (relative === '.git' || relative.startsWith(`.git${path.sep}`)) return;
  if (stat.isSymbolicLink()) {
    fs.symlinkSync(fs.readlinkSync(source), destination);
    preserveSymlinkMode(destination, stat.mode, relative);
    return;
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: false, mode: stat.mode & 0o7777 });
    for (const entry of fs.readdirSync(source, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      copyEntry(path.join(source, entry.name), path.join(destination, entry.name), childRelative);
    }
    fs.chmodSync(destination, stat.mode & 0o7777);
    return;
  }
  if (!stat.isFile()) throw new Error(`consumer contains unsupported special file: ${relative}`);
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, stat.mode & 0o7777);
}

function copyConsumerWorktree(consumerRoot, stageRoot) {
  for (const entry of fs.readdirSync(consumerRoot, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '.git') continue;
    copyEntry(path.join(consumerRoot, entry.name), path.join(stageRoot, entry.name), entry.name);
  }
}

function recreateStageFrameworkLink(stageRoot, frameworkRoot) {
  const stageRiff = path.join(stageRoot, '.riff');
  let stat;
  try {
    stat = fs.lstatSync(stageRiff);
  } catch (error) {
    throw new Error(`worker staging .riff is unavailable: ${error.message}`);
  }
  if (!stat.isSymbolicLink()) throw new Error('worker staging .riff must remain a symbolic link');
  const framework = fs.realpathSync(frameworkRoot);
  fs.unlinkSync(stageRiff);
  fs.symlinkSync(path.relative(stageRoot, framework), stageRiff);
}

function seedPrivateCodexAuth(runtimeCodexRoot, inheritedCodexRoot = undefined) {
  const sourceRoot = path.resolve(inheritedCodexRoot || process.env.CODEX_HOME || path.join(hostHomeDirectory(), '.codex'));
  const source = path.join(sourceRoot, 'auth.json');
  let stat;
  try { stat = fs.lstatSync(source); } catch (error) {
    if (error.code === 'ENOENT') return { seeded: false, sourcePath: source, destinationPath: path.join(runtimeCodexRoot, 'auth.json') };
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Codex auth.json must be a real regular non-symlink file');
  const destination = path.join(runtimeCodexRoot, 'auth.json');
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o600);
  return { seeded: true, sourcePath: source, destinationPath: destination };
}

function privateCodexProtectedPaths(runtimeCodexRoot, inheritedCodexRoot = undefined, auth = undefined) {
  const sourceRoot = path.resolve(inheritedCodexRoot || process.env.CODEX_HOME || path.join(hostHomeDirectory(), '.codex'));
  const candidates = [
    auth?.sourcePath || path.join(sourceRoot, 'auth.json'),
    auth?.destinationPath || path.join(runtimeCodexRoot, 'auth.json'),
    ...['.credentials.json', 'config.toml', 'rules', 'history.jsonl', 'sessions'].flatMap((name) => [path.join(sourceRoot, name), path.join(runtimeCodexRoot, name)]),
  ].filter(Boolean);
  return [...new Set(candidates.map((candidate) => path.resolve(candidate)))];
}

function createDispatchRoot(containerRoot, name) {
  const dispatchRoot = path.join(containerRoot, name);
  fs.mkdirSync(dispatchRoot, { mode: 0o700 });
  fs.chmodSync(dispatchRoot, 0o700);
  return dispatchRoot;
}

export function createPrivateCodexRuntime({
  prefix = 'riff-next-control-runtime-',
  inheritedCodexRoot,
  consumerRoot,
  frameworkRoot,
  internalTestAllowNonDarwinSandbox = false,
} = {}) {
  if (process.platform !== 'darwin' && !internalTestAllowNonDarwinSandbox) {
    throw new Error('persisted-output dispatches require Darwin Codex read-deny enforcement');
  }
  if (!consumerRoot || !frameworkRoot) throw new Error('control runtime requires consumer and framework roots');
  const runtimeLease = acquireRuntimeLease();
  let containerRoot;
  try {
    containerRoot = createSecureWorkerContainer(prefix);
    const directories = {
      HOME: path.join(containerRoot, 'home'),
      CODEX_HOME: path.join(containerRoot, 'codex'),
      TMPDIR: path.join(containerRoot, 'tmp'),
      XDG_CACHE_HOME: path.join(containerRoot, 'cache'),
    };
    for (const directory of Object.values(directories)) fs.mkdirSync(directory, { mode: 0o700 });
    const privateAuth = seedPrivateCodexAuth(directories.CODEX_HOME, inheritedCodexRoot);
    const toolchainRoot = createNodeToolchainBundle(containerRoot);
    const dispatchRoots = {
      controller: createDispatchRoot(containerRoot, 'controller'),
      architectureController: createDispatchRoot(containerRoot, 'architecture-controller'),
      planner: createDispatchRoot(containerRoot, 'planner'),
      planReviewer: createDispatchRoot(containerRoot, 'plan-reviewer'),
      codeReviewer: createDispatchRoot(containerRoot, 'code-reviewer'),
    };
    const hostRoots = [
      realDirectory(hostHomeDirectory(), 'host home'),
      process.env.HOME && path.isAbsolute(process.env.HOME) ? path.resolve(process.env.HOME) : undefined,
      realDirectory(os.tmpdir(), 'shared temporary directory'),
      realDirectory('/tmp', 'shared /tmp directory'),
      path.resolve('/tmp'),
      fs.realpathSync(consumerRoot),
      fs.realpathSync(frameworkRoot),
      ...runtimeSiblingPaths(containerRoot),
    ].filter(Boolean);
    return {
      containerRoot,
      runtimeLease,
      runtimeEnv: directories,
      privateAuthSeeded: privateAuth.seeded,
      authSourcePath: privateAuth.sourcePath,
      authDestinationPath: privateAuth.destinationPath,
      protectedPaths: [...new Set([...hostRoots, ...privateCodexProtectedPaths(directories.CODEX_HOME, inheritedCodexRoot, privateAuth)])],
      toolchainRoot,
      toolchainPath: `${path.join(toolchainRoot, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
      dispatchRoots,
    };
  } catch (error) {
    try { fs.rmSync(containerRoot, { recursive: true, force: true }); } catch { /* preserve original error */ }
    try { releaseRuntimeLease(runtimeLease); } catch { /* preserve original error */ }
    throw error;
  }
}

export function cleanupPrivateCodexRuntime(runtime) {
  if (!runtime?.containerRoot) return;
  let cleanupError;
  try { fs.rmSync(runtime.containerRoot, { recursive: true, force: true }); } catch (error) { cleanupError = error; }
  try { releaseRuntimeLease(runtime.runtimeLease); } catch (error) { if (!cleanupError) cleanupError = error; }
  if (cleanupError) throw cleanupError;
}

function assertCopiedWorktree(consumerRoot, snapshotRoot) {
  if (stageGitHead(snapshotRoot) !== git(consumerRoot, ['rev-parse', '--verify', 'HEAD']).trim()) {
    throw new Error('control evidence snapshot HEAD differs from consumer HEAD');
  }
  const consumer = snapshotWorktree({ root: consumerRoot });
  const snapshot = snapshotWorktree({ root: snapshotRoot });
  const fileDifferences = compareFileMaps(consumer, snapshot).filter((item) => item !== '.git');
  if (fileDifferences.length) throw new Error(`control evidence snapshot differs: ${fileDifferences.join(', ')}`);
  if (consumer.staged_diff_hash !== snapshot.staged_diff_hash) throw new Error('control evidence snapshot staged diff differs from consumer');
  if (consumer.porcelain_v2_status_hash !== snapshot.porcelain_v2_status_hash) throw new Error('control evidence snapshot status differs from consumer');
  if (indexEntriesHash(consumerRoot) !== indexEntriesHash(snapshotRoot)) throw new Error('control evidence snapshot index differs from consumer');
}

function removeSnapshotPaths(snapshotRoot, relativePaths) {
  for (const relativePath of [...new Set(relativePaths || [])]) {
    if (!relativePath) continue;
    const target = assertLexical(snapshotRoot, relativePath, { allowMissingFinal: true, allowMissingComponents: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
}

function writeControlEvidenceFiles(snapshotRoot, evidenceFiles) {
  const written = [];
  for (const entry of evidenceFiles || []) {
    const relative = normalized(entry?.path || '');
    if (!relative.startsWith('.planning/riff-next-evidence/') || relative.endsWith('/')) {
      throw new Error(`control evidence file has an invalid path: ${relative}`);
    }
    const target = assertLexical(snapshotRoot, relative, { allowMissingFinal: true, allowMissingComponents: true });
    try {
      fs.lstatSync(target);
      throw new Error(`control evidence file already exists: ${relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    assertLexical(snapshotRoot, path.dirname(relative));
    fs.writeFileSync(target, entry.content, { flag: 'wx', mode: 0o400 });
    fs.chmodSync(target, 0o400);
    written.push(relative);
  }
  return written;
}

export function createControlDispatchSnapshot({ runtime, consumerRoot, frameworkRoot, roleSpecPath, name, removePaths = [], evidenceFiles = [] }) {
  if (!runtime?.containerRoot || !pathWithin(runtime.containerRoot, runtime.dispatchRoots?.[name] || '')) {
    throw new Error(`control runtime does not own dispatch root: ${name}`);
  }
  if (!/^(?:controller|architectureController|planner|planReviewer|codeReviewer)$/.test(name)) throw new Error(`invalid control snapshot name: ${name}`);
  const evidenceParent = path.join(runtime.containerRoot, 'evidence');
  fs.mkdirSync(evidenceParent, { recursive: true, mode: 0o700 });
  const evidenceRoot = path.join(evidenceParent, name);
  fs.mkdirSync(evidenceRoot, { mode: 0o700 });
  const projectRoot = path.join(evidenceRoot, 'project');
  try {
    createClone(consumerRoot, projectRoot);
    copyConsumerWorktree(consumerRoot, projectRoot);
    assertCopiedWorktree(consumerRoot, projectRoot);
    removeSnapshotPaths(projectRoot, removePaths);
    const writtenEvidenceFiles = writeControlEvidenceFiles(projectRoot, evidenceFiles);
    const roleBundle = createRoleBundle(evidenceRoot, frameworkRoot, roleSpecPath);
    const baseline = snapshotWorktree({ root: projectRoot });
    return { name, evidenceRoot, projectRoot, roleBundle, baseline, evidenceFiles: writtenEvidenceFiles, indexEntriesHash: indexEntriesHash(projectRoot) };
  } catch (error) {
    try { fs.rmSync(evidenceRoot, { recursive: true, force: true }); } catch { /* preserve original error */ }
    throw error;
  }
}

export function verifyControlDispatchSnapshot(snapshot) {
  if (!snapshot) return;
  verifyRoleBundle(snapshot.roleBundle);
  const after = snapshotWorktree({ root: snapshot.projectRoot });
  const comparison = compareSnapshots(snapshot.baseline, after);
  if (comparison.changed.length || comparison.git_metadata_changed || comparison.git_metadata_root_changed
    || comparison.staged_diff_changed || comparison.status_changed
    || snapshot.indexEntriesHash !== indexEntriesHash(snapshot.projectRoot)) {
    throw new Error(`control dispatch mutated its evidence snapshot: ${comparison.changed.join(', ') || comparison.git_metadata_changed_paths.join(', ') || 'worktree metadata'}`);
  }
}

export function cleanupControlDispatchSnapshot(snapshot) {
  if (!snapshot?.evidenceRoot) return;
  let verificationError;
  try { verifyControlDispatchSnapshot(snapshot); } catch (error) { verificationError = error; }
  unlockRoleBundle(snapshot.roleBundle);
  fs.rmSync(snapshot.evidenceRoot, { recursive: true, force: true });
  if (verificationError) throw verificationError;
}

function sameRecords(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function compareFileMaps(expected, actual) {
  const paths = [...new Set([...Object.keys(expected?.files || {}), ...Object.keys(actual?.files || {})])].sort();
  return paths.filter((relative) => !sameRecords(expected?.files?.[relative], actual?.files?.[relative]));
}

function stageGitHead(stageRoot) {
  return git(stageRoot, ['rev-parse', '--verify', 'HEAD']).trim();
}

function stagePlanHash(stageRoot, phase) {
  return hash(fs.readFileSync(path.join(stageRoot, '.planning', 'phases', phase, 'PLAN.md')));
}

export function workerStageExplicitPaths(phase) {
  return [
    `.planning/phases/${phase}/PLAN.md`,
    `.planning/phases/${phase}/PLAN-REVIEW.md`,
    `.planning/phases/${phase}/SUMMARY.md`,
    `.planning/phases/${phase}/REVIEW.md`,
    `.planning/phases/${phase}/SCOPE-CHECK.json`,
    `.planning/riff-next/${phase}.json`,
    `.planning/riff-next/${phase}.failure.json`,
    `.planning/riff-next/${phase}.worker-delta.json`,
  ];
}

function indexEntriesHash(root) {
  return hash(git(root, ['ls-files', '--stage', '-z'], { encoding: 'buffer' }));
}

function splitNullRecords(output) {
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

function comparableStatusHash(root) {
  return hash(git(root, [
    'status',
    '--porcelain=v2',
    '--untracked-files=all',
    '--',
    '.',
    ':(exclude).riff',
  ], { encoding: 'buffer' }));
}

function directoryInventory(root) {
  const directories = {};
  const walk = (absolute, relative = '') => {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return;
    if (relative) directories[normalized(relative)] = { mode: (stat.mode & 0o7777).toString(8) };
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.git') continue;
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      if (normalized(childRelative) === '.riff') continue;
      const child = path.join(absolute, entry.name);
      const childStat = fs.lstatSync(child);
      if (childStat.isSymbolicLink()) continue;
      if (childStat.isDirectory()) walk(child, childRelative);
    }
  };
  walk(fs.realpathSync(root));
  return directories;
}

export function snapshotWorkerWorkspace(root, phase) {
  return {
    ...snapshotWorktree({ root, explicitPaths: workerStageExplicitPaths(phase) }),
    directory_inventory: directoryInventory(root),
    index_entries_hash: indexEntriesHash(root),
  };
}

export function compareWorkerWorkspaceSnapshots(before, after) {
  const comparison = compareSnapshots(before, after);
  const beforeDirectories = before?.directory_inventory || {};
  const afterDirectories = after?.directory_inventory || {};
  // snapshotWorktree only records ancestors of Git-visible paths. An empty,
  // untracked ancestor can therefore appear in `files` after a worker creates
  // an allowed nested file even though the directory itself existed unchanged
  // before the worker started. directory_inventory is the authoritative record
  // for that case, so omit only this duplicate representation from the delta.
  const unchangedDirectoryRepresentations = new Set(comparison.added.filter((relative) => {
    const beforeDirectory = beforeDirectories[relative];
    const afterDirectory = afterDirectories[relative];
    const afterFile = after?.files?.[relative];
    return !before?.files?.[relative]
      && sameRecords(beforeDirectory, afterDirectory)
      && afterFile?.kind === 'directory'
      && afterFile.mode === afterDirectory?.mode;
  }));
  const addedFromFiles = comparison.added.filter((relative) => !unchangedDirectoryRepresentations.has(relative));
  const changedFromFiles = comparison.changed.filter((relative) => !unchangedDirectoryRepresentations.has(relative));
  const changedDirectories = [...new Set([...Object.keys(beforeDirectories), ...Object.keys(afterDirectories)])]
    .filter((relative) => !sameRecords(beforeDirectories[relative], afterDirectories[relative]));
  if (!changedDirectories.length) {
    if (!unchangedDirectoryRepresentations.size) return comparison;
    return {
      ...comparison,
      added: addedFromFiles,
      changed: changedFromFiles,
      exact_worker_deltas: changedFromFiles,
      clean: changedFromFiles.length === 0 && !comparison.git_metadata_changed
        && !comparison.git_metadata_root_changed && !comparison.staged_diff_changed && !comparison.status_changed,
    };
  }
  const add = (key, predicate) => [...new Set([...comparison[key], ...changedDirectories.filter(predicate)])].sort();
  const added = [...new Set([...addedFromFiles, ...changedDirectories.filter((relative) => !beforeDirectories[relative] && afterDirectories[relative])])].sort();
  const removed = add('removed', (relative) => beforeDirectories[relative] && !afterDirectories[relative]);
  const modified = add('modified', (relative) => beforeDirectories[relative] && afterDirectories[relative]);
  const changed = [...new Set([...changedFromFiles, ...changedDirectories])].sort();
  return {
    ...comparison,
    added,
    removed,
    modified,
    changed,
    exact_worker_deltas: changed,
    clean: changed.length === 0 && !comparison.git_metadata_changed
      && !comparison.git_metadata_root_changed && !comparison.staged_diff_changed && !comparison.status_changed,
  };
}

function relativeOverlapsBoundary(relative, boundary) {
  const item = normalized(relative).replace(/\/$/, '');
  const allowed = normalized(boundary).replace(/\/$/, '');
  return item === allowed || item.startsWith(`${allowed}/`) || allowed.startsWith(`${item}/`);
}

function safeTransientTree(root, relative) {
  const absolute = assertLexical(root, relative);
  const walk = (candidate) => {
    const stat = fs.lstatSync(candidate);
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) return false;
    if (!stat.isDirectory()) return true;
    for (const entry of fs.readdirSync(candidate, { withFileTypes: true })) {
      if (!walk(path.join(candidate, entry.name))) return false;
    }
    return true;
  };
  return walk(absolute);
}

function ignoredByReference(ignoreReferenceRoot, relative, isDirectory) {
  const result = spawnSync('git', gitArgs(['check-ignore', '--no-index', '-z', '--stdin']), {
    cwd: ignoreReferenceRoot,
    input: Buffer.from(`${relative}${isDirectory ? '/' : ''}\0`),
    encoding: 'buffer',
    env: gitEnv(),
    timeout: GIT_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw new Error(`cannot classify worker transient artifact: ${result.error.message}`);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`cannot classify worker transient artifact: git check-ignore exited ${result.status}`);
}

function protectedTransientPath(relative) {
  const item = normalized(relative).replace(/\/$/, '');
  return item === '.git' || item.startsWith('.git/') || item === '.riff' || item.startsWith('.riff/') || item === '.planning' || item.startsWith('.planning/');
}

function workspacePaths(root) {
  const paths = [];
  const walk = (absolute, relative = '') => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.git') continue;
      const child = path.join(absolute, entry.name);
      const childRelative = relative ? path.join(relative, entry.name) : entry.name;
      paths.push(normalized(childRelative));
      const stat = fs.lstatSync(child);
      if (stat.isDirectory() && !stat.isSymbolicLink()) walk(child, childRelative);
    }
  };
  walk(fs.realpathSync(root));
  return paths;
}

/** Remove only new, immutable-rule-ignored worker outputs before planned-delta validation. */
export function scrubWorkerTransientArtifacts({ stageRoot, ignoreReferenceRoot, stageBaseline, phase, boundaries = [] }) {
  const candidates = workspacePaths(stageRoot)
    .filter((relative) => !stageBaseline?.files?.[relative] && !stageBaseline?.directory_inventory?.[relative])
    .map((relative) => normalized(relative).replace(/\/$/, ''))
    .filter((relative) => relative && !protectedTransientPath(relative))
    .filter((relative) => !boundaries.some((boundary) => relativeOverlapsBoundary(relative, boundary)))
    .filter((relative) => ignoredByReference(ignoreReferenceRoot, relative, fs.lstatSync(assertLexical(stageRoot, relative)).isDirectory()))
    .sort((left, right) => left.split('/').length - right.split('/').length || left.localeCompare(right));
  const removed = [];
  for (const relative of candidates) {
    if (removed.some((ancestor) => relative === ancestor || relative.startsWith(`${ancestor}/`))) continue;
    if (!safeTransientTree(stageRoot, relative)) continue;
    fs.rmSync(assertLexical(stageRoot, relative), { recursive: true, force: false });
    removed.push(relative);
  }
  return removed;
}

function assertStageBaseline({ consumerRoot, stageRoot, phase, planHash, baselineSnapshot, frameworkRoot }) {
  const consumerHead = git(consumerRoot, ['rev-parse', '--verify', 'HEAD']).trim();
  if (stageGitHead(stageRoot) !== consumerHead) throw new Error('worker staging HEAD differs from consumer HEAD');
  if (stagePlanHash(stageRoot, phase) !== planHash) throw new Error('worker staging PLAN hash differs from validated PLAN');
  const riff = path.join(stageRoot, '.riff');
  const riffStat = fs.lstatSync(riff);
  if (!riffStat.isSymbolicLink() || fs.realpathSync(riff) !== fs.realpathSync(frameworkRoot)) {
    throw new Error('worker staging .riff does not resolve to the framework');
  }
  const stagedSnapshot = snapshotWorkerWorkspace(stageRoot, phase);
  const fileDifferences = compareFileMaps(baselineSnapshot, stagedSnapshot).filter((item) => item !== '.git' && item !== '.riff');
  if (fileDifferences.length) throw new Error(`worker staging baseline differs: ${fileDifferences.join(', ')}`);
  if (baselineSnapshot.staged_diff_hash !== stagedSnapshot.staged_diff_hash) throw new Error(`worker staging staged-diff state differs from consumer baseline: ${baselineSnapshot.staged_diff_hash} != ${stagedSnapshot.staged_diff_hash}`);
  const consumerStatusHash = comparableStatusHash(consumerRoot);
  const stagedStatusHash = comparableStatusHash(stageRoot);
  if (consumerStatusHash !== stagedStatusHash) throw new Error(`worker staging status differs from consumer baseline: ${consumerStatusHash} != ${stagedStatusHash}`);
  if (indexEntriesHash(consumerRoot) !== stagedSnapshot.index_entries_hash) throw new Error('worker staging index entries differ from consumer baseline');
  return stagedSnapshot;
}

function createClone(consumerRoot, stageRoot) {
  git(consumerRoot, ['clone', '--no-local', '--no-hardlinks', '--no-checkout', consumerRoot, stageRoot]);
  try { git(stageRoot, ['remote', 'remove', 'origin']); } catch { /* older Git may have no origin */ }
  git(stageRoot, ['read-tree', 'HEAD']);
  const alternates = path.join(stageRoot, '.git', 'objects', 'info', 'alternates');
  if (fs.existsSync(alternates)) throw new Error('worker staging clone must not use Git object alternates');
  if (git(stageRoot, ['remote']).trim()) throw new Error('worker staging clone must not retain a Git remote');
  if (git(stageRoot, ['config', '--local', '--list']).includes(consumerRoot)) throw new Error('worker staging Git config must not retain the consumer path');
  for (const [key, value] of [['core.fsmonitor', 'false'], ['core.hooksPath', NULL_DEVICE]]) {
    try { git(stageRoot, ['config', '--local', key, value]); } catch { /* remote removal may already delete the key */ }
  }
}

function copyImmutableIgnoreFile(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`ignore reference input must be a regular file: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  fs.copyFileSync(source, destination);
  fs.chmodSync(destination, 0o400);
}

function lockIgnoreReferenceTree(root) {
  const walk = (absolute) => {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('ignore reference contains a symlink');
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) walk(path.join(absolute, entry.name));
      fs.chmodSync(absolute, 0o500);
      return;
    }
    if (!stat.isFile()) throw new Error('ignore reference contains a special entry');
    fs.chmodSync(absolute, 0o400);
  };
  walk(root);
}

function unlockIgnoreReferenceTree(root) {
  const walk = (absolute) => {
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error('ignore reference contains a symlink');
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) walk(path.join(absolute, entry.name));
      fs.chmodSync(absolute, 0o700);
      return;
    }
    if (!stat.isFile()) throw new Error('ignore reference contains a special entry');
    fs.chmodSync(absolute, 0o600);
  };
  walk(root);
}

function createIgnoreReference(containerRoot, consumerRoot) {
  const referenceRoot = path.join(containerRoot, 'ignore-reference');
  fs.mkdirSync(referenceRoot, { mode: 0o700 });
  try {
    git(referenceRoot, ['init', '-q']);
    const walk = (absolute, relative = '') => {
      for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
        if (entry.name === '.git' || entry.name === '.riff') continue;
        const source = path.join(absolute, entry.name);
        const targetRelative = relative ? path.join(relative, entry.name) : entry.name;
        const stat = fs.lstatSync(source);
        if (entry.name === '.gitignore') {
          copyImmutableIgnoreFile(source, path.join(referenceRoot, targetRelative));
          continue;
        }
        if (stat.isSymbolicLink() || !stat.isDirectory()) continue;
        walk(source, targetRelative);
      }
    };
    walk(fs.realpathSync(consumerRoot));
    const excludePath = git(consumerRoot, ['rev-parse', '--git-path', 'info/exclude']).trim();
    const sourceExclude = path.isAbsolute(excludePath) ? excludePath : path.join(consumerRoot, excludePath);
    try { copyImmutableIgnoreFile(sourceExclude, path.join(referenceRoot, '.git', 'info', 'exclude')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    lockIgnoreReferenceTree(referenceRoot);
    return referenceRoot;
  } catch (error) {
    try { fs.rmSync(referenceRoot, { recursive: true, force: true }); } catch { /* preserve reference failure */ }
    throw error;
  }
}

const disposableSmokeWorkspaces = new WeakSet();

function assertDisposableSmokeClone(sourceRoot, workspaceRoot, phase) {
  if (stageGitHead(workspaceRoot) !== stageGitHead(sourceRoot)) throw new Error('disposable smoke workspace HEAD differs from source stage');
  const source = snapshotWorkerWorkspace(sourceRoot, phase);
  const workspace = snapshotWorkerWorkspace(workspaceRoot, phase);
  const fileDifferences = compareFileMaps(source, workspace).filter((relative) => relative !== '.riff');
  if (fileDifferences.length) {
    throw new Error(`disposable smoke workspace differs from source stage: ${fileDifferences.join(', ')}`);
  }
  if (source.staged_diff_hash !== workspace.staged_diff_hash) throw new Error('disposable smoke workspace staged diff differs from source stage');
  if (comparableStatusHash(sourceRoot) !== comparableStatusHash(workspaceRoot)) throw new Error('disposable smoke workspace status differs from source stage');
  if (source.index_entries_hash !== workspace.index_entries_hash) throw new Error('disposable smoke workspace index differs from source stage');
}

export function createDisposableSmokeWorkspace({ sourceRoot, containerRoot, phase }) {
  const source = fs.realpathSync(sourceRoot);
  const container = fs.realpathSync(containerRoot);
  if (!pathWithin(container, source) || source === container) throw new Error('disposable smoke source must be inside its runtime container');
  const parentRoot = fs.mkdtempSync(path.join(container, 'riff-next-smoke-'));
  const workspaceRoot = path.join(parentRoot, 'workspace');
  try {
    fs.chmodSync(parentRoot, 0o700);
    createClone(source, workspaceRoot);
    copyConsumerWorktree(source, workspaceRoot);
    recreateStageFrameworkLink(workspaceRoot, fs.realpathSync(path.join(source, '.riff')));
    assertDisposableSmokeClone(source, workspaceRoot, phase);
    const workspace = Object.freeze({ sourceRoot: source, containerRoot: container, parentRoot, workspaceRoot, phase });
    disposableSmokeWorkspaces.add(workspace);
    return workspace;
  } catch (error) {
    try { fs.rmSync(parentRoot, { recursive: true, force: true }); } catch { /* preserve clone failure */ }
    throw error;
  }
}

export function isDisposableSmokeWorkspace(workspace, root) {
  if (!workspace || !disposableSmokeWorkspaces.has(workspace)) return false;
  try {
    return fs.realpathSync(root) === workspace.workspaceRoot
      && fs.realpathSync(workspace.parentRoot) === workspace.parentRoot
      && pathWithin(workspace.containerRoot, workspace.workspaceRoot)
      && !pathWithin(workspace.workspaceRoot, workspace.sourceRoot);
  } catch { return false; }
}

export function cleanupDisposableSmokeWorkspace(workspace) {
  if (!workspace || !disposableSmokeWorkspaces.has(workspace)) return;
  disposableSmokeWorkspaces.delete(workspace);
  if (!pathWithin(workspace.containerRoot, workspace.parentRoot) || workspace.parentRoot === workspace.containerRoot) {
    throw new Error('disposable smoke workspace cleanup target escapes its runtime container');
  }
  fs.rmSync(workspace.parentRoot, { recursive: true, force: true });
}

export function createWorkerStage({ consumerRoot, phase, planHash, baselineSnapshot, frameworkRoot, forModel = true, requiredExecutables = [], internalTestAllowNonDarwinWorkerSandbox = false }) {
  if (forModel && process.platform !== 'darwin' && !internalTestAllowNonDarwinWorkerSandbox) {
    throw new Error('worker dispatch requires Darwin Codex read-deny enforcement');
  }
  const runtimeLease = acquireRuntimeLease();
  let containerRoot;
  try {
    containerRoot = createSecureWorkerContainer('riff-next-worker-stage-');
    const stageRoot = path.join(containerRoot, 'workspace');
    const runtimeRoot = path.join(containerRoot, 'runtime');
    const dispatchRoot = path.join(containerRoot, 'worker');
    fs.mkdirSync(stageRoot, { mode: 0o700 });
    fs.mkdirSync(dispatchRoot, { mode: 0o700 });
    fs.chmodSync(dispatchRoot, 0o700);
    for (const directory of ['home', 'codex', 'tmp', 'cache']) fs.mkdirSync(path.join(runtimeRoot, directory), { recursive: true, mode: 0o700 });
    const privateAuth = seedPrivateCodexAuth(path.join(runtimeRoot, 'codex'));
    const toolchainRoot = createNodeToolchainBundle(containerRoot, {
      requiredExecutables,
      forbiddenExecutableRoots: [consumerRoot, frameworkRoot],
    });
    const workerBundle = forModel
      ? createRoleBundle(containerRoot, frameworkRoot, path.join(frameworkRoot, 'agents/roles/worker.md'))
      : undefined;
    createClone(consumerRoot, stageRoot);
    copyConsumerWorktree(consumerRoot, stageRoot);
    recreateStageFrameworkLink(stageRoot, frameworkRoot);
    const stageBaseline = assertStageBaseline({ consumerRoot, stageRoot, phase, planHash, baselineSnapshot, frameworkRoot });
    const ignoreReferenceRoot = createIgnoreReference(containerRoot, consumerRoot);
    const hostHome = realDirectory(hostHomeDirectory(), 'host home');
    const sharedTemp = realDirectory(os.tmpdir(), 'shared temporary directory');
    const sharedSlashTemp = realDirectory('/tmp', 'shared /tmp directory');
    const workerDeniedPaths = [hostHome, consumerRoot, frameworkRoot, ignoreReferenceRoot, sharedTemp, sharedSlashTemp, '/tmp', ...runtimeSiblingPaths(containerRoot), ...privateCodexProtectedPaths(path.join(runtimeRoot, 'codex'), undefined, privateAuth)];
    return {
      containerRoot,
      runtimeLease,
      stageRoot,
      dispatchRoot,
      stageBaseline,
      ignoreReferenceRoot,
      workerBundle,
      toolchainRoot,
      toolchainPath: `${path.join(toolchainRoot, 'bin')}:/usr/bin:/bin:/usr/sbin:/sbin`,
      runtimeEnv: {
        HOME: path.join(runtimeRoot, 'home'),
        CODEX_HOME: path.join(runtimeRoot, 'codex'),
        TMPDIR: path.join(runtimeRoot, 'tmp'),
        XDG_CACHE_HOME: path.join(runtimeRoot, 'cache'),
      },
      authSourcePath: privateAuth.sourcePath,
      authDestinationPath: privateAuth.destinationPath,
      protectedPaths: workerDeniedPaths,
      readPaths: [workerBundle?.bundleRoot, toolchainRoot].filter(Boolean),
    };
  } catch (error) {
    try { fs.rmSync(containerRoot, { recursive: true, force: true }); } catch { /* preserve original error */ }
    try { releaseRuntimeLease(runtimeLease); } catch { /* preserve original error */ }
    throw error;
  }
}

export function cleanupWorkerStage(stage) {
  if (!stage?.containerRoot) return;
  let verificationError;
  try { verifyWorkerBundle(stage.workerBundle); } catch (error) { verificationError = error; }
  unlockRoleBundle(stage.workerBundle);
  try { if (stage.ignoreReferenceRoot) unlockIgnoreReferenceTree(stage.ignoreReferenceRoot); } catch (error) { if (!verificationError) verificationError = error; }
  try { fs.rmSync(stage.containerRoot, { recursive: true, force: true }); } catch (error) { if (!verificationError) verificationError = error; }
  try { releaseRuntimeLease(stage.runtimeLease); } catch (error) { if (!verificationError) verificationError = error; }
  if (verificationError) throw verificationError;
}

function pathWithinBoundary(relative, boundary) {
  const item = normalized(relative).replace(/\/$/, '');
  const allowed = normalized(boundary).replace(/\/$/, '');
  return item === allowed || item.startsWith(`${allowed}/`);
}

function boundaryContainsPath(boundary, relative) {
  const item = normalized(relative).replace(/\/$/, '');
  const allowed = normalized(boundary).replace(/\/$/, '');
  return item === allowed || allowed.startsWith(`${item}/`);
}

function allowedPath(relative, boundaries) {
  return boundaries.some((boundary) => pathWithinBoundary(relative, boundary) || boundaryContainsPath(boundary, relative));
}

function directlyAllowedPath(relative, boundaries) {
  return boundaries.some((boundary) => pathWithinBoundary(relative, boundary));
}

function ancestorOnlyPath(relative, boundaries) {
  return !directlyAllowedPath(relative, boundaries)
    && boundaries.some((boundary) => boundaryContainsPath(boundary, relative));
}

function readRegularFile(root, relative, record) {
  assertLexical(root, relative);
  const stat = fs.lstatSync(path.join(root, relative));
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`worker promotion output must be a regular file: ${relative}`);
  const bytes = fs.readFileSync(path.join(root, relative));
  if (hash(bytes) !== record.content_hash) throw new Error(`worker staging file changed before promotion: ${relative}`);
  return { bytes, mode: stat.mode & 0o7777, hash: record.content_hash };
}

function validateOutputKind(root, relative, record) {
  assertLexical(root, relative, { allowMissingFinal: true });
  if (record && !['file', 'directory', 'missing'].includes(record.kind)) throw new Error(`worker promotion rejects special or symlink output: ${relative}`);
  if (record?.kind === 'file') return readRegularFile(root, relative, record);
  if (record?.kind === 'directory') {
    const stat = fs.lstatSync(path.join(root, relative));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`worker promotion directory is unsafe: ${relative}`);
  }
  return undefined;
}

function snapshotChangedPaths(before, after) {
  const paths = [...new Set([...Object.keys(before?.files || {}), ...Object.keys(after?.files || {})])].sort();
  return paths.filter((relative) => !sameRecords(before?.files?.[relative], after?.files?.[relative]));
}

export function freezePromotionPayload({ consumerRoot, stageRoot, baselineSnapshot, stagedSnapshot, boundaries }) {
  const changed = snapshotChangedPaths(baselineSnapshot, stagedSnapshot);
  const unplanned = changed.filter((relative) => !allowedPath(relative, boundaries));
  if (unplanned.length) throw new Error(`worker changed unplanned paths: ${unplanned.join(', ')}`);
  const files = [];
  const directories = [];
  const removals = [];
  for (const relative of changed) {
    if (relative === '.riff') throw new Error('worker changed unplanned paths: .riff');
    const before = baselineSnapshot.files?.[relative];
    const after = stagedSnapshot.files?.[relative];
    const afterMissing = !after || after.kind === 'missing';
    if (ancestorOnlyPath(relative, boundaries)) {
      if (!(!before || before.kind === 'missing') || after?.kind !== 'directory') {
        throw new Error(`worker promotion rejects ancestor mutation: ${relative}`);
      }
      validateOutputKind(stageRoot, relative, after);
      const mode = parseInt(after.mode || '700', 8);
      const consumerTarget = assertLexical(consumerRoot, relative, { allowMissingFinal: true, allowMissingComponents: true });
      let consumerStat;
      try { consumerStat = fs.lstatSync(consumerTarget); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (consumerStat) {
        if (consumerStat.isSymbolicLink() || !consumerStat.isDirectory()) {
          throw new Error(`worker promotion rejects ancestor mutation: ${relative}`);
        }
        if ((consumerStat.mode & 0o7777) !== mode) {
          throw new Error(`worker promotion rejects ancestor mode change: ${relative}`);
        }
      } else {
        directories.push({ relative, mode });
      }
      continue;
    }
    if (after?.kind === 'file') {
      const content = readRegularFile(stageRoot, relative, after);
      files.push({ relative, kind: before ? 'update' : 'create', ...content });
    } else if (after?.kind === 'directory') {
      validateOutputKind(stageRoot, relative, after);
      directories.push({ relative, mode: parseInt(after.mode || '700', 8) });
    } else if (afterMissing && before?.kind === 'file') {
      assertLexical(consumerRoot, relative);
      const stat = fs.lstatSync(path.join(consumerRoot, relative));
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`worker promotion deletion target is not a regular file: ${relative}`);
      removals.push({ relative, mode: stat.mode & 0o7777, bytes: fs.readFileSync(path.join(consumerRoot, relative)) });
    } else if (afterMissing && before?.kind === 'directory') {
      assertLexical(consumerRoot, relative, { allowMissingFinal: true });
      removals.push({ relative, directory: true });
    } else {
      throw new Error(`worker promotion rejects non-regular output: ${relative}`);
    }
  }
  return { changed, files, directories, removals, frozenAt: new Date().toISOString() };
}

function backupEntry(root, relative) {
  const target = assertLexical(root, relative, { allowMissingFinal: true, allowMissingComponents: true });
  let stat;
  try { stat = fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return { relative, missing: true }; throw error; }
  if (stat.isSymbolicLink()) throw new Error(`consumer promotion target is a symlink: ${relative}`);
  if (stat.isDirectory()) return { relative, directory: true, mode: stat.mode & 0o7777 };
  if (!stat.isFile()) throw new Error(`consumer promotion target is a special file: ${relative}`);
  return { relative, bytes: fs.readFileSync(target), mode: stat.mode & 0o7777 };
}

function writeAtomic(root, relative, bytes, mode) {
  const target = assertLexical(root, relative, { allowMissingFinal: true, allowMissingComponents: true });
  const parent = path.dirname(target);
  assertLexical(root, path.relative(root, parent), { allowMissingComponents: true });
  fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  assertLexical(root, path.relative(root, parent));
  const temp = path.join(parent, `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.riff-tmp`);
  const fd = fs.openSync(temp, 'wx', mode & 0o7777);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.chmodSync(temp, mode & 0o7777);
  fs.renameSync(temp, target);
}

function restoreBackup(root, backup) {
  const target = assertLexical(root, backup.relative, { allowMissingFinal: true, allowMissingComponents: true });
  if (backup.missing) {
    try {
      const stat = fs.lstatSync(target);
      if (stat.isDirectory()) fs.rmdirSync(target);
      else fs.unlinkSync(target);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  if (backup.directory) { fs.mkdirSync(target, { recursive: true, mode: backup.mode }); fs.chmodSync(target, backup.mode); return; }
  writeAtomic(root, backup.relative, backup.bytes, backup.mode);
}

export function promoteWorkerDelta({ consumerRoot, stageRoot, baselineSnapshot, stagedSnapshot, boundaries, allowExistingDelta = false }) {
  const payload = freezePromotionPayload({ consumerRoot, stageRoot, baselineSnapshot, stagedSnapshot, boundaries });
  const consumerBeforePromotion = allowExistingDelta ? snapshotWorktree({ root: consumerRoot }) : undefined;
  const existingDelta = allowExistingDelta
    ? snapshotChangedPaths(baselineSnapshot, consumerBeforePromotion).filter((relative) => !relative.startsWith('.planning/'))
    : [];
  const expectedDelta = snapshotChangedPaths(baselineSnapshot, stagedSnapshot);
  const conflictingExisting = existingDelta.filter((relative) => expectedDelta.includes(relative)
    && !sameRecords(consumerBeforePromotion.files[relative], stagedSnapshot.files[relative]));
  if (conflictingExisting.length) {
    throw new Error(`parallel worker promotion conflicts with an integrated task delta: ${conflictingExisting.join(',')}`);
  }
  const backupPaths = [...payload.files.map((item) => item.relative), ...payload.removals.map((item) => item.relative), ...payload.directories.map((item) => item.relative)];
  const backups = backupPaths.map((relative) => backupEntry(consumerRoot, relative));
  const applied = [];
  const rollback = () => {
    for (const relative of applied.reverse()) {
      const backup = backups.find((item) => item.relative === relative);
      try { restoreBackup(consumerRoot, backup); } catch { /* preserve original promotion failure */ }
    }
  };
  try {
    for (const item of payload.directories) {
      const stagedDirectory = assertLexical(stageRoot, item.relative);
      const stagedStat = fs.lstatSync(stagedDirectory);
      if (!stagedStat.isDirectory() || stagedStat.isSymbolicLink() || (stagedStat.mode & 0o7777) !== item.mode) throw new Error(`worker staging directory changed before promotion: ${item.relative}`);
      assertLexical(consumerRoot, item.relative, { allowMissingFinal: true, allowMissingComponents: true });
      fs.mkdirSync(path.join(consumerRoot, item.relative), { recursive: true, mode: item.mode });
      fs.chmodSync(path.join(consumerRoot, item.relative), item.mode);
      applied.push(item.relative);
    }
    for (const item of payload.files) {
      const current = readRegularFile(stageRoot, item.relative, stagedSnapshot.files[item.relative]);
      if (current.hash !== item.hash) throw new Error(`worker staging file changed before promotion: ${item.relative}`);
      writeAtomic(consumerRoot, item.relative, current.bytes, item.mode);
      applied.push(item.relative);
    }
    const removals = [...payload.removals].sort((left, right) => right.relative.split('/').length - left.relative.split('/').length);
    for (const item of removals) {
      const target = assertLexical(consumerRoot, item.relative);
      if (item.directory) fs.rmdirSync(target);
      else fs.unlinkSync(target);
      applied.push(item.relative);
    }
    const after = snapshotWorktree({ root: consumerRoot });
    const expected = expectedDelta;
    const actual = snapshotChangedPaths(baselineSnapshot, after).filter((relative) => !relative.startsWith('.planning/'));
    const mismatched = expected.filter((relative) => !sameRecords(stagedSnapshot.files[relative], after.files[relative]));
    const preserved = existingDelta.filter((relative) => !expected.includes(relative));
    const changedExisting = preserved.filter((relative) => !sameRecords(consumerBeforePromotion.files[relative], after.files[relative]));
    const accepted = [...new Set([...expected, ...preserved])].sort();
    if (JSON.stringify(actual) !== JSON.stringify(accepted) || mismatched.length || changedExisting.length) {
      throw new Error(`consumer product delta differs from frozen worker staging delta: expected=${accepted.join(',')} actual=${actual.join(',')} mismatched=${[...mismatched, ...changedExisting].join(',')}`);
    }
    return { payload, after };
  } catch (error) {
    rollback();
    throw error;
  }
}

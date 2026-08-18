#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const STATES = Object.freeze([
  'initialized', 'controller_passed', 'plan_validated', 'plan_reviewed', 'worker_dispatched',
  'mechanics_passed', 'summary_validated', 'reviewer_dispatched', 'review_passed',
  'post_review_mechanics_passed', 'completed', 'failed',
]);

const NEXT = new Map([
  ['initialized', { action: 'controller', state: 'controller_passed' }],
  ['controller_passed', { action: 'planner', state: 'plan_validated' }],
  ['plan_validated', { action: 'plan_review', state: 'plan_reviewed' }],
  ['plan_reviewed', { action: 'worker', state: 'worker_dispatched' }],
  ['worker_dispatched', { action: 'mechanics', state: 'mechanics_passed' }],
  ['mechanics_passed', { action: 'summary', state: 'summary_validated' }],
  ['summary_validated', { action: 'reviewer', state: 'reviewer_dispatched' }],
  ['reviewer_dispatched', { action: 'review', state: 'review_passed' }],
  ['review_passed', { action: 'post_review_mechanics', state: 'post_review_mechanics_passed' }],
  ['post_review_mechanics_passed', { action: 'complete', state: 'completed' }],
]);

function sha(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }

const SAFE_PHASE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validatePhase(phase) {
  if (typeof phase !== 'string' || !SAFE_PHASE.test(phase) || phase === '.' || phase === '..') {
    throw new Error(`invalid phase identifier: ${phase}`);
  }
  return phase;
}

export function stateDirectory(root, phase) {
  validatePhase(phase);
  const directory = path.join(fs.realpathSync(root), '.planning', 'riff-next');
  stateComponents(root, phase);
  return directory;
}
export function statePath(root, phase) {
  validatePhase(phase);
  return path.join(stateDirectory(root, phase), `${phase}.json`);
}
function runtimeRootPath(runtimeLockRoot) {
  const candidate = runtimeLockRoot === undefined ? path.join(fs.realpathSync(os.tmpdir()), 'riff-next-locks') : path.resolve(runtimeLockRoot);
  return candidate;
}

function currentUid() { return typeof process.getuid === 'function' ? process.getuid() : undefined; }

function assertLockRecord(lock, { allowStale = false } = {}) {
  let stat;
  try { stat = fs.lstatSync(lock); } catch (error) {
    if (error.code === 'ENOENT') throw new Error('phase lock is missing');
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('phase lock must be a regular file');
  const uid = currentUid();
  if (uid !== undefined && stat.uid !== uid) throw new Error('phase lock is not owned by the current uid');
  let record;
  try { record = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { throw new Error('phase lock contains malformed JSON'); }
  if (!record || typeof record !== 'object' || Array.isArray(record)
    || !Number.isInteger(record.pid) || record.pid <= 0
    || typeof record.acquired_at !== 'string' || !record.acquired_at.trim()) {
    throw new Error('phase lock contains invalid metadata');
  }
  if (!allowStale) return { stat, record };
  return { stat, record };
}

function processIsDead(pid) {
  try { process.kill(pid, 0); return false; }
  catch (error) { return error?.code === 'ESRCH'; }
}

function assertDirectory(parent, { create = false } = {}) {
  let ancestor = path.resolve(parent);
  while (!fs.existsSync(ancestor)) {
    const next = path.dirname(ancestor);
    if (next === ancestor) break;
    ancestor = next;
  }
  if (create && !fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
  let stat;
  try { stat = fs.lstatSync(parent); } catch (error) { throw new Error(`runtime lock parent is unavailable: ${error.message}`); }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('runtime lock parent must be a real directory');
  if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) throw new Error('runtime lock parent is not owned by the current uid');
  return stat;
}

export function lockPath(root, phase, { runtimeLockRoot } = {}) {
  validatePhase(phase);
  const rootReal = fs.realpathSync(root);
  const lockRoot = runtimeRootPath(runtimeLockRoot);
  return path.join(lockRoot, `${sha(`${rootReal}\0${phase}`)}.lock`);
}

export function acquirePhaseLock(root, phase, { runtimeLockRoot } = {}) {
  validatePhase(phase);
  const lockRoot = runtimeRootPath(runtimeLockRoot);
  assertDirectory(lockRoot, { create: true });
  const lock = lockPath(root, phase, { runtimeLockRoot });
  let fd;
  let attemptedRecovery = false;
  while (true) {
    try { fd = fs.openSync(lock, 'wx', 0o600); break; }
    catch (error) {
      if (error.code !== 'EEXIST' || attemptedRecovery) {
        if (error.code === 'EEXIST') throw new Error(`phase is already locked: ${phase}`);
        throw error;
      }
      attemptedRecovery = true;
      const observed = assertLockRecord(lock, { allowStale: true });
      if (!processIsDead(observed.record.pid)) throw new Error(`phase is already locked: ${phase}`);
      let current;
      try { current = fs.lstatSync(lock); } catch (recheckError) {
        if (recheckError.code === 'ENOENT') continue;
        throw recheckError;
      }
      if (!current.isFile() || current.isSymbolicLink()) throw new Error('phase lock must be a regular file');
      const uid = currentUid();
      if (uid !== undefined && current.uid !== uid) throw new Error('phase lock is not owned by the current uid');
      if (current.dev !== observed.stat.dev || current.ino !== observed.stat.ino) throw new Error(`phase is already locked: ${phase}`);
      fs.unlinkSync(lock);
    }
  }
  let ownedContents = '';
  try {
    fs.fchmodSync(fd, 0o600);
    const lockRecord = `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`;
    fs.writeSync(fd, lockRecord);
    fs.fsyncSync(fd);
    ownedContents = lockRecord;
  } catch (error) {
    fs.closeSync(fd);
    try { fs.unlinkSync(lock); } catch { /* preserve the acquisition error */ }
    throw error;
  }
  const opened = fs.fstatSync(fd);
  return {
    fd,
    path: lock,
    assertOwned() {
      const current = assertLockRecord(lock).stat;
      if (current.dev !== opened.dev || current.ino !== opened.ino) throw new Error('phase lock was unlinked or replaced');
      const held = fs.fstatSync(fd);
      if (held.dev !== opened.dev || held.ino !== opened.ino) throw new Error('phase lock descriptor changed');
      if (fs.readFileSync(lock, 'utf8') !== ownedContents) throw new Error('phase lock metadata was changed');
      return true;
    },
    release() {
      try { fs.closeSync(fd); } finally {
        try {
          const current = fs.lstatSync(lock);
          if (current.dev === opened.dev && current.ino === opened.ino && fs.readFileSync(lock, 'utf8') === ownedContents) fs.unlinkSync(lock);
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    },
  };
}

function stateComponents(root, phase) {
  validatePhase(phase);
  const rootReal = fs.realpathSync(root);
  const planning = path.join(rootReal, '.planning');
  const stateRoot = path.join(planning, 'riff-next');
  const file = path.join(stateRoot, `${phase}.json`);
  let current = rootReal;
  for (const [name, final] of [['.planning', planning], ['riff-next', stateRoot], [`${phase}.json`, file]]) {
    current = final;
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    if (stat.isSymbolicLink()) throw new Error(`state path component must not be a symlink: ${name}`);
    if (name !== `${phase}.json` && !stat.isDirectory()) throw new Error(`state path component must be a directory: ${name}`);
    if (name === `${phase}.json` && !stat.isFile()) throw new Error(`state path component must be a regular file: ${name}`);
    const real = fs.realpathSync(current);
    if (real !== current && !real.startsWith(`${rootReal}${path.sep}`)) throw new Error(`state path escapes Git root: ${file}`);
  }
  return { rootReal, planning, stateRoot, file };
}

export function validateState(state, { phase, task } = {}) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('state must be an object');
  if (state.schema_version !== 1) throw new Error('state schema_version must be 1');
  validatePhase(phase);
  if (state.phase !== phase) throw new Error(`state phase does not match requested phase: ${state.phase}`);
  if (!STATES.includes(state.state)) throw new Error(`state has unknown state: ${state.state}`);
  if (state.previous_state !== null && !STATES.includes(state.previous_state)) throw new Error('state previous_state is invalid');
  if (state.failure_kind !== undefined && (state.state !== 'failed' || state.failure_kind !== 'blocked')) throw new Error('state failure_kind is invalid');
  if (!state.evidence_hashes || typeof state.evidence_hashes !== 'object' || Array.isArray(state.evidence_hashes)) throw new Error('state evidence_hashes must be an object');
  for (const [key, value] of Object.entries(state.evidence_hashes)) {
    if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error(`state evidence hash is invalid: ${key}`);
  }
  const planReviewRequired = ['plan_reviewed', 'worker_dispatched', 'mechanics_passed', 'summary_validated', 'reviewer_dispatched', 'review_passed', 'post_review_mechanics_passed', 'completed'].includes(state.state);
  if (planReviewRequired && !state.evidence_hashes.plan_review) throw new Error('state plan_review evidence hash is required after plan review');
  if (task !== undefined && state.evidence_hashes.task !== sha(task)) throw new Error('state task evidence does not match the current task');
  return state;
}

export function readState(root, phase) {
  const file = stateComponents(root, phase).file;
  try { return validateState(JSON.parse(fs.readFileSync(file, 'utf8')), { phase }); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}

export function initializeState(root, phase, { evidence = {} } = {}) {
  const file = stateComponents(root, phase).file;
  if (readState(root, phase)) throw new Error(`state already exists for phase: ${phase}`);
  const state = {
    schema_version: 1, phase, state: 'initialized', previous_state: null,
    evidence_hashes: normalizeEvidence(evidence), updated_at: new Date().toISOString(),
  };
  stateComponents(root, phase);
  atomicWrite(file, state);
  return state;
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return {};
  return Object.fromEntries(Object.entries(evidence).map(([key, value]) => [key, typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value) ? value : sha(typeof value === 'string' ? value : JSON.stringify(value))]));
}

export function transitionState(root, phase, { expectedState, nextState, evidence, evidenceHashes } = {}) {
  if (!STATES.includes(nextState)) throw new Error(`unknown next state: ${nextState}`);
  const paths = stateComponents(root, phase);
  const current = readState(root, phase);
  if (!current) {
    if (nextState !== 'initialized' || expectedState !== null && expectedState !== undefined) throw new Error('state is not initialized');
    return initializeState(root, phase, { evidence: evidenceHashes || evidence });
  }
  validateState(current, { phase });
  if (current.state !== expectedState) throw new Error(`expected state ${expectedState}, found ${current.state}`);
  if (nextState !== 'failed' && NEXT.get(current.state)?.state !== nextState) throw new Error(`invalid transition ${current.state} -> ${nextState}`);
  if (nextState === 'failed' && current.state === 'completed') throw new Error('completed state cannot fail');
  const hashes = normalizeEvidence(evidenceHashes || evidence);
  if (Object.keys(hashes).length === 0) throw new Error('every transition requires evidence hashes');
  const next = { ...current, previous_state: current.state, state: nextState, evidence_hashes: { ...current.evidence_hashes, ...hashes }, updated_at: new Date().toISOString() };
  stateComponents(root, phase);
  atomicWrite(paths.file, next);
  return next;
}

export function failState(root, phase, { state, error } = {}) {
  const paths = stateComponents(root, phase);
  validateState(state, { phase });
  const next = {
    ...state,
    previous_state: state.state,
    state: 'failed',
    ...(error?.code === 'RIFF_PHASE_BLOCKED' ? { failure_kind: 'blocked' } : {}),
    evidence_hashes: { ...state.evidence_hashes, failure: sha(error instanceof Error ? error.message : error) },
    updated_at: new Date().toISOString(),
  };
  stateComponents(root, phase);
  atomicWrite(paths.file, next);
  return next;
}

export function nextDispatch(state) {
  const next = NEXT.get(state?.state);
  return next ? { ...next, phase: state.phase } : null;
}

function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), phase: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]; const value = argv[index + 1];
    if (token === '--project-root') { if (!value) throw new Error('--project-root requires a value'); args.projectRoot = path.resolve(value); index += 1; }
    else if (token === '--phase') { if (!value) throw new Error('--phase requires a value'); args.phase = value; index += 1; }
    else if (token === '--help' || token === '-h') { process.stdout.write('Usage: riff-next-stage --project-root <path> --phase <name>\n'); process.exit(0); }
    else throw new Error(`unknown argument: ${token}`);
  }
  if (!args.phase) throw new Error('--phase is required');
  return args;
}

export function main(argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv);
    process.stdout.write(`${JSON.stringify(readState(args.projectRoot, args.phase) || null)}\n`);
    return 0;
  } catch (error) { process.stderr.write(`${error.message}\n`); return 1; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());

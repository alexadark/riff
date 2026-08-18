import fs from 'node:fs';
import path from 'node:path';

export const WAVE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(message) { throw new Error(message); }

export function assertWaveRunId(value) {
  if (typeof value !== 'string' || !WAVE_RUN_ID.test(value)) fail(`invalid wave run identifier: ${value}`);
  return value;
}

export function secureWaveRoot(projectRoot, { create = false } = {}) {
  let current = projectRoot;
  for (const component of ['.planning', 'riff-wave']) {
    current = path.join(current, component);
    try {
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`RIFF wave state ancestor must be a real directory: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      fs.mkdirSync(current, { recursive: false, mode: 0o700 });
      const stat = fs.lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`RIFF wave state ancestor must be a real directory: ${current}`);
    }
  }
  return current;
}

export function readRegularJson(file, label = file) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') fail(`${label} must be a regular file`);
    throw error;
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) fail(`${label} must be a regular file`);
    const bytes = fs.readFileSync(descriptor);
    try { return { value: JSON.parse(bytes.toString('utf8')), bytes }; }
    catch { fail(`${label} is malformed`); }
  } finally {
    fs.closeSync(descriptor);
  }
}

function validWaveState(state, run) {
  return state && typeof state === 'object' && !Array.isArray(state)
    && state.schema_version === 1 && state.run === run
    && ['running', 'awaiting_human', 'paused', 'blocked', 'completed'].includes(state.state)
    && ['wave', 'loop'].includes(state.mode)
    && (state.selected_provider === null || ['codex', 'claude'].includes(state.selected_provider))
    && (state.provider_override === null || ['codex', 'claude'].includes(state.provider_override))
    && Array.isArray(state.requested_phase_ids) && state.requested_phase_ids.every((id) => typeof id === 'string')
    && Array.isArray(state.waves) && Array.isArray(state.phases)
    && (state.current === null || (typeof state.current === 'object' && !Array.isArray(state.current)))
    && (state.max_phases === null || Number.isInteger(state.max_phases))
    && (state.max_runs === null || Number.isInteger(state.max_runs))
    && (state.stop_reason === null || typeof state.stop_reason === 'string')
    && typeof state.started_at === 'string' && typeof state.updated_at === 'string';
}

export function readWaveState(projectRoot, run) {
  assertWaveRunId(run);
  const root = secureWaveRoot(projectRoot);
  const result = readRegularJson(path.join(root, `${run}.json`), `RIFF wave state: ${run}`);
  if (!result || !validWaveState(result.value, run)) fail(`RIFF wave state is missing or malformed: ${run}`);
  return result.value;
}

export function readActiveWaveRun(projectRoot) {
  const root = secureWaveRoot(projectRoot);
  const result = readRegularJson(path.join(root, 'active.json'), 'RIFF active wave state');
  if (!result) return null;
  const active = result.value;
  if (!active || typeof active !== 'object' || Array.isArray(active) || Object.keys(active).length !== 1 || !assertSafeActiveRun(active.run)) fail('RIFF active wave state is malformed');
  return active.run;
}

function assertSafeActiveRun(value) {
  try { assertWaveRunId(value); return true; } catch { return false; }
}

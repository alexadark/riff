#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  atomicWrite,
  loadRoadmap,
  phaseKey,
  phaseTask,
  remainingPhases,
  requiresConfirmation,
  resolveFrameworkRoot,
  resolveProjectRoot,
  selectReadyPhases,
  updatePhaseStatus,
  validateRoadmap,
} from './lib/roadmap-workflow.mjs';
import { resolveRuntimeProfile } from './lib/runtime-provider.mjs';

const scriptFrameworkRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RETRY_SAFE_STATES = new Set(['initialized', 'controller_passed', 'plan_validated', 'plan_reviewed', 'worker_dispatched', 'failed']);
const POST_PROMOTION_STATES = new Set(['mechanics_passed', 'summary_validated', 'reviewer_dispatched', 'review_passed', 'post_review_mechanics_passed', 'completed']);
const SECURITY_VERDICTS = new Set(['PASS', 'PASS_WITH_NOTES', 'FAIL']);

function fail(message) { throw new Error(message); }

function parseArgs(argv) {
  const options = { autonomous: false, loop: false, resume: false, requestedIds: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = () => {
      const result = argv[index + 1];
      if (!result || result.startsWith('--')) fail(`${value} requires a value`);
      index += 1;
      return result;
    };
    if (value === '--autonomous') options.autonomous = true;
    else if (value === '--loop') { options.loop = true; options.autonomous = true; }
    else if (value === '--resume') { options.resume = true; options.autonomous = true; }
    else if (value === '--run') options.runId = next();
    else if (value === '--phases') options.requestedIds = next().split(',').map((entry) => entry.trim()).filter(Boolean);
    else if (value === '--max-phases') options.maxPhases = Number.parseInt(next(), 10);
    else if (value === '--max-runs') options.maxRuns = Number.parseInt(next(), 10);
    else if (value === '--provider') options.provider = next();
    else if (value === '--project-root') options.projectRoot = next();
    else if (value === '--status') options.status = true;
    else if (value === '-h' || value === '--help') options.help = true;
    else fail(`unknown riff wave option: ${value}`);
  }
  if (options.provider && !['codex', 'claude'].includes(options.provider)) fail('--provider must be codex or claude');
  if (options.maxPhases !== undefined && (!Number.isInteger(options.maxPhases) || options.maxPhases < 1)) fail('--max-phases must be a positive integer');
  if (options.maxRuns !== undefined && (!Number.isInteger(options.maxRuns) || options.maxRuns < 1)) fail('--max-runs must be a positive integer');
  return options;
}

function runId() {
  return `W-${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

function stateRoot(projectRoot) { return path.join(projectRoot, '.planning', 'riff-wave'); }
function stateFile(projectRoot, id) { return path.join(stateRoot(projectRoot), `${id}.json`); }
function activeFile(projectRoot) { return path.join(stateRoot(projectRoot), 'active.json'); }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return null; }
}

function writeState(projectRoot, state) {
  state.updated_at = new Date().toISOString();
  atomicWrite(stateFile(projectRoot, state.run), `${JSON.stringify(state, null, 2)}\n`);
  if (state.state !== 'completed') {
    atomicWrite(activeFile(projectRoot), `${JSON.stringify({ run: state.run }, null, 2)}\n`);
  } else if (fs.existsSync(activeFile(projectRoot))) {
    const active = readJson(activeFile(projectRoot));
    if (active?.run === state.run) fs.unlinkSync(activeFile(projectRoot));
  }
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function acquireLease(projectRoot, id) {
  const root = stateRoot(projectRoot);
  fs.mkdirSync(root, { recursive: true });
  const lease = path.join(root, 'lease.json');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lease, 'wx', 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, run: id, acquired_at: new Date().toISOString() })}\n`);
      fs.closeSync(descriptor);
      return () => {
        const current = readJson(lease);
        if (current?.pid === process.pid && current?.run === id) fs.unlinkSync(lease);
      };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = readJson(lease);
      if (current && processExists(current.pid)) fail(`RIFF autonomous wave ${current.run} is already running (pid ${current.pid})`);
      const stat = fs.lstatSync(lease);
      if (!stat.isFile() || stat.isSymbolicLink()) fail('RIFF wave lease is not a regular file');
      fs.unlinkSync(lease);
    }
  }
  fail('unable to acquire RIFF wave lease');
}

function nativeState(projectRoot, nativePhase) {
  return readJson(path.join(projectRoot, '.planning', 'riff-next', `${nativePhase}.json`));
}

function safeToRetry(native) {
  if (!native) return true;
  if (POST_PROMOTION_STATES.has(native.state) || POST_PROMOTION_STATES.has(native.previous_state)) return false;
  return RETRY_SAFE_STATES.has(native.state) || RETRY_SAFE_STATES.has(native.previous_state);
}

function latestState(projectRoot, requestedRun) {
  const active = readJson(activeFile(projectRoot));
  const id = requestedRun || active?.run;
  if (!id) fail('no resumable RIFF autonomous wave exists');
  const state = readJson(stateFile(projectRoot, id));
  if (!state) fail(`RIFF wave state is missing or malformed: ${id}`);
  return state;
}

function makeState(projectRoot, options) {
  const id = options.runId || runId();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) fail(`invalid wave run identifier: ${id}`);
  if (fs.existsSync(stateFile(projectRoot, id))) fail(`RIFF wave run already exists: ${id}; use --resume --run ${id}`);
  return {
    schema_version: 1,
    run: id,
    state: 'running',
    mode: options.loop ? 'loop' : 'wave',
    provider_override: options.provider || null,
    selected_provider: null,
    requested_phase_ids: options.requestedIds,
    max_phases: options.maxPhases || null,
    max_runs: options.maxRuns || null,
    waves: [],
    phases: [],
    current: null,
    stop_reason: null,
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function resolveWaveProfile(projectRoot, frameworkRoot, state) {
  const provider = state.provider_override === null || state.provider_override === undefined ? undefined : state.provider_override;
  const resolved = resolveRuntimeProfile({ projectRoot, frameworkRoot, provider });
  if (state.selected_provider === null || state.selected_provider === undefined) {
    state.selected_provider = resolved.provider;
  } else if (!['codex', 'claude'].includes(state.selected_provider)) {
    fail(`invalid selected provider in RIFF wave state: ${state.selected_provider}`);
  }
  const cap = resolved.profile.autonomy?.debug_cycle_cap === undefined ? 3 : resolved.profile.autonomy.debug_cycle_cap;
  if (!Number.isInteger(cap) || cap < 0 || cap > 10) fail('autonomy.debug_cycle_cap must be a nonnegative integer no greater than 10');
  state.recovery_cycle_cap = cap;
  state.recovery_profile = resolved.profilePath;
  return cap;
}

function invokeNativeNext({ frameworkRoot, projectRoot, phase, task, provider }) {
  const argv = [path.join(frameworkRoot, 'scripts', 'riff-next.mjs'), '--project-root', projectRoot, '--phase', phase, '--task', task];
  if (provider) argv.push('--provider', provider);
  return spawnSync(process.execPath, argv, { cwd: projectRoot, stdio: 'inherit', shell: false });
}

function phaseRecord(state, phase) {
  let record = state.phases.find((entry) => entry.id === phase.id);
  if (!record) {
    record = { id: phase.id, slug: phase.slug, title: phase.title, status: 'pending', attempts: [] };
    state.phases.push(record);
  }
  return record;
}

function authoritativeChangedPaths(projectRoot, state) {
  const paths = new Set();
  for (const phase of state.phases) {
    for (const attempt of phase.attempts || []) {
      if (attempt.status !== 'completed') continue;
      const delta = readJson(path.join(projectRoot, '.planning', 'riff-next', `${attempt.native_phase}.worker-delta.json`));
      for (const changed of delta?.changed || []) {
        if (typeof changed === 'string' && changed && !path.isAbsolute(changed) && !changed.split('/').includes('..')) paths.add(changed);
      }
    }
  }
  return [...paths].sort();
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finalSecurityArtifact(projectRoot, state) {
  return path.join(stateRoot(projectRoot), `${state.run}.security.json`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function isSha256(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function lstatKind(stat) {
  if (stat.isSymbolicLink()) return 'symlink';
  if (stat.isFile()) return 'regular';
  if (stat.isDirectory()) return 'directory';
  if (stat.isBlockDevice()) return 'block';
  if (stat.isCharacterDevice()) return 'character';
  if (stat.isFIFO()) return 'fifo';
  if (stat.isSocket()) return 'socket';
  return 'other';
}

function readRegularFileNoFollow(file) {
  let descriptor;
  try {
    descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ELOOP') return null;
    throw error;
  }
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile()) return null;
    return { content: fs.readFileSync(descriptor), stat };
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateChangedPathAncestors(projectRoot, relative) {
  const components = relative.split('/');
  let current = projectRoot;
  for (const component of components.slice(0, -1)) {
    if (!component || component === '.' || component === '..') fail(`invalid final-security path: ${relative}`);
    current = path.join(current, component);
    let stat;
    try { stat = fs.lstatSync(current); }
    catch (error) {
      if (error.code === 'ENOENT') return false;
      fail(`cannot inspect final-security ancestor ${relative}: ${error.message}`);
    }
    if (stat.isSymbolicLink()) fail(`final-security ancestor is a symlink: ${relative}`);
    if (!stat.isDirectory()) fail(`final-security ancestor is not a directory: ${relative}`);
  }
  return true;
}

function snapshotChangedPath(projectRoot, relative, retry = 0) {
  const absolute = path.join(projectRoot, relative);
  if (!validateChangedPathAncestors(projectRoot, relative)) return { path: relative, kind: 'missing', mode: null };
  let stat;
  try { stat = fs.lstatSync(absolute); }
  catch (error) {
    if (error.code === 'ENOENT') return { path: relative, kind: 'missing', mode: null };
    fail(`cannot inspect final-security input ${relative}: ${error.message}`);
  }
  const kind = lstatKind(stat);
  const entry = { path: relative, kind, mode: stat.mode & 0o7777 };
  if (kind === 'symlink') {
    try { return { ...entry, target: fs.readlinkSync(absolute) }; }
    catch (error) { fail(`cannot inspect final-security symlink ${relative}: ${error.message}`); }
  }
  if (kind !== 'regular') return entry;
  const opened = readRegularFileNoFollow(absolute);
  if (opened !== null && (opened.stat.mode & 0o7777) === entry.mode) return { ...entry, content_sha256: sha256(opened.content) };
  if (retry < 1) return snapshotChangedPath(projectRoot, relative, retry + 1);
  fail(`final-security input changed while hashing: ${relative}`);
}

function finalSecurityInput(projectRoot, state) {
  const changedPaths = authoritativeChangedPaths(projectRoot, state);
  const records = changedPaths.map((relative) => snapshotChangedPath(projectRoot, relative));
  return { changedPaths, records, input_sha256: sha256(JSON.stringify(records)) };
}

function currentRecordedRegularFile(projectRoot, record) {
  const absolute = path.join(projectRoot, record.path);
  if (!validateChangedPathAncestors(projectRoot, record.path)) fail(`final-security input changed before scan: ${record.path}`);
  let stat;
  try { stat = fs.lstatSync(absolute); }
  catch { fail(`final-security input changed before scan: ${record.path}`); }
  if (lstatKind(stat) !== 'regular' || (stat.mode & 0o7777) !== record.mode) fail(`final-security input changed before scan: ${record.path}`);
  const opened = readRegularFileNoFollow(absolute);
  if (opened === null || (opened.stat.mode & 0o7777) !== record.mode || sha256(opened.content) !== record.content_sha256) fail(`final-security input changed before scan: ${record.path}`);
  return opened.content;
}

function finalSecuritySummary(projectRoot, state, report, artifactSha256) {
  const artifact = finalSecurityArtifact(projectRoot, state);
  return {
    verdict: report.verdict,
    artifact: path.relative(projectRoot, artifact),
    blocking_findings: report.findings.filter((finding) => finding.severity === 'HIGH').length,
    input_sha256: report.input_sha256,
    artifact_sha256: artifactSha256,
  };
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function validFinalSecurityReport(projectRoot, report, state) {
  if (!isRecord(report) || report.schema_version !== 1 || report.run !== state.run || report.timing !== 'after_product_phases' || !SECURITY_VERDICTS.has(report.verdict) || !isSha256(report.input_sha256) || typeof report.final_security_nonce !== 'string' || !report.final_security_nonce) return false;
  if (!Array.isArray(report.changed_paths) || !report.changed_paths.every((entry) => typeof entry === 'string')) return false;
  if (!Array.isArray(report.findings) || !report.findings.every((finding) => isRecord(finding)
    && ['severity', 'source', 'path', 'message'].every((field) => typeof finding[field] === 'string')
    && ['HIGH', 'NOTE'].includes(finding.severity)
    && report.changed_paths.includes(finding.path))) return false;
  if (!sameStrings(report.changed_paths, authoritativeChangedPaths(projectRoot, state))) return false;
  const expectedVerdict = report.findings.some((finding) => finding.severity === 'HIGH') ? 'FAIL' : report.findings.length ? 'PASS_WITH_NOTES' : 'PASS';
  if (report.verdict !== expectedVerdict) return false;
  return typeof report.completed_at === 'string' && report.completed_at.length > 0;
}

function validFinalSecurityAttempt(attempt) {
  return isRecord(attempt)
    && ['running', 'completed'].includes(attempt.status)
    && typeof attempt.started_at === 'string' && attempt.started_at.length > 0
    && isSha256(attempt.input_sha256)
    && typeof attempt.nonce === 'string' && attempt.nonce.length > 0;
}

function finalSecurityArtifactExists(projectRoot, state) {
  try {
    fs.lstatSync(finalSecurityArtifact(projectRoot, state));
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    fail(`cannot inspect RIFF final security artifact: ${error.message}`);
  }
}

function existingFinalSecurity(projectRoot, state) {
  const artifact = finalSecurityArtifact(projectRoot, state);
  const attempt = state.final_security_attempt;
  let stat;
  try { stat = fs.lstatSync(artifact); }
  catch (error) {
    if (error.code === 'ENOENT') return attempt === undefined && state.final_security === undefined ? { status: 'missing' } : { status: 'invalid' };
    return { status: 'invalid' };
  }
  if (!stat.isFile() || stat.isSymbolicLink()) return { status: 'invalid' };
  let artifactBytes;
  let report;
  try {
    artifactBytes = fs.readFileSync(artifact);
    report = JSON.parse(artifactBytes.toString('utf8'));
  }
  catch { return { status: 'invalid' }; }
  if (!validFinalSecurityAttempt(attempt)) return { status: 'invalid' };
  const input = finalSecurityInput(projectRoot, state);
  if (attempt.input_sha256 !== input.input_sha256) return { status: 'invalid' };
  if (!validFinalSecurityReport(projectRoot, report, state)) return { status: 'invalid' };
  if (report.input_sha256 !== attempt.input_sha256 || report.final_security_nonce !== attempt.nonce) return { status: 'invalid' };
  const artifactSha256 = sha256(artifactBytes);
  if (attempt.status === 'completed' && attempt.artifact_sha256 !== artifactSha256) return { status: 'invalid' };
  if (attempt.status === 'running' && attempt.artifact_sha256 !== undefined && attempt.artifact_sha256 !== artifactSha256) return { status: 'invalid' };
  const summary = finalSecuritySummary(projectRoot, state, report, artifactSha256);
  if (state.final_security !== undefined && (!isRecord(state.final_security)
    || state.final_security.verdict !== summary.verdict
    || state.final_security.artifact !== summary.artifact
    || state.final_security.blocking_findings !== summary.blocking_findings
    || state.final_security.input_sha256 !== summary.input_sha256
    || state.final_security.artifact_sha256 !== summary.artifact_sha256)) return { status: 'invalid' };
  return { status: 'present', report, summary, artifactSha256 };
}

function runFinalSecurityGate(projectRoot, frameworkRoot, state, input) {
  const changedPaths = input.changedPaths;
  const findings = [];
  const secretPatterns = [
    ['AWS access key', /AKIA[0-9A-Z]{16}/],
    ['live Stripe secret', /sk_live_[A-Za-z0-9]+/],
    ['GitHub personal token', /ghp_[A-Za-z0-9]{36}/],
    ['Slack bot token', /xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+/],
    ['hardcoded credential', /\b(?:password|secret|api[_-]?key)\s*[:=]\s*["'][^"']{10,}/i],
  ];
  const hookNames = ['idor-detector.sh', 'route-auth-guard.sh', 'input-validation-guard.sh', 'boundary-check.sh'];
  const hookEnv = { ...process.env };
  delete hookEnv.RIFF_SCRATCH_MODE;
  delete hookEnv.RIFF_WAVE_ID;
  for (const record of input.records) {
    if (record.kind !== 'regular') continue;
    const relative = record.path;
    const absolute = path.join(projectRoot, relative);
    const content = currentRecordedRegularFile(projectRoot, record).toString('utf8');
    if (!/(?:test|spec|fixture|mock|__tests__)|\.(?:png|jpe?g|gif|ico|woff2?|ttf|eot|lock)$/i.test(relative)) {
      for (const [label, pattern] of secretPatterns) {
        if (pattern.test(content)) findings.push({ severity: 'HIGH', source: 'secret-scan', path: relative, message: label });
      }
    }
    const payload = JSON.stringify({
      cwd: projectRoot,
      hook_event_name: 'PostToolUse',
      tool_name: 'Write',
      tool_input: { file_path: absolute, content },
    });
    for (const hook of hookNames) {
      const result = spawnSync('bash', [path.join(frameworkRoot, 'hooks', hook)], {
        cwd: projectRoot, env: hookEnv, input: payload, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
      });
      const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
      if (result.status !== 0 || /RIFF (?:IDOR|Auth|Validation|WARNING)/.test(output)) {
        findings.push({
          severity: /BLOCKED|RIFF (?:IDOR|Auth)/.test(output) ? 'HIGH' : 'NOTE',
          source: hook.replace(/\.sh$/, ''),
          path: relative,
          message: output.split('\n').find(Boolean)?.slice(0, 500) || `hook exited ${result.status}`,
        });
      }
    }
  }
  if (finalSecurityInput(projectRoot, state).input_sha256 !== input.input_sha256) fail('final-security input changed during scan');
  const blocking = findings.filter((finding) => finding.severity === 'HIGH');
  const report = {
    schema_version: 1,
    run: state.run,
    timing: 'after_product_phases',
    changed_paths: changedPaths,
    input_sha256: input.input_sha256,
    final_security_nonce: input.nonce,
    verdict: blocking.length ? 'FAIL' : findings.length ? 'PASS_WITH_NOTES' : 'PASS',
    findings,
    completed_at: new Date().toISOString(),
  };
  const artifact = finalSecurityArtifact(projectRoot, state);
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  atomicWrite(artifact, bytes);
  return { report, artifact_sha256: sha256(bytes) };
}

function completeAfterSecurity(projectRoot, frameworkRoot, state, stopReason, beforeFinalSecurityScan) {
  const existing = existingFinalSecurity(projectRoot, state);
  if (existing.status === 'invalid') {
    state.state = 'blocked';
    state.stop_reason = 'final_security_artifact_invalid';
    writeState(projectRoot, state);
    return state;
  }
  let security;
  if (existing.status === 'present') {
    security = existing.report;
    state.final_security = existing.summary;
    if (state.final_security_attempt.status === 'running') {
      state.final_security_attempt = { ...state.final_security_attempt, status: 'completed', completed_at: new Date().toISOString(), artifact_sha256: existing.artifactSha256 };
    }
  } else {
    const input = finalSecurityInput(projectRoot, state);
    const attempt = { status: 'running', started_at: new Date().toISOString(), input_sha256: input.input_sha256, nonce: randomBytes(16).toString('hex') };
    state.final_security_attempt = attempt;
    writeState(projectRoot, state);
    beforeFinalSecurityScan?.({ projectRoot, state, input });
    const generated = runFinalSecurityGate(projectRoot, frameworkRoot, state, { ...input, nonce: attempt.nonce });
    security = generated.report;
    state.final_security_attempt = { ...attempt, status: 'completed', completed_at: new Date().toISOString(), artifact_sha256: generated.artifact_sha256 };
    state.final_security = finalSecuritySummary(projectRoot, state, generated.report, generated.artifact_sha256);
  }
  if (security.verdict === 'FAIL') {
    state.state = 'blocked';
    state.stop_reason = 'final_security_findings';
  } else {
    state.state = 'completed';
    state.stop_reason = stopReason;
    state.current = null;
  }
  writeState(projectRoot, state);
  return state;
}

function stopWithoutSecurity(projectRoot, state, stopReason, stateWhenClear = 'blocked') {
  state.state = stateWhenClear;
  state.stop_reason = stopReason;
  writeState(projectRoot, state);
  return state;
}

function latestRecoveryCycle(record) {
  return record.attempts.reduce((latest, attempt, index) => {
    const cycle = Number.isSafeInteger(attempt.recovery_cycle) && attempt.recovery_cycle >= 0 ? attempt.recovery_cycle : index;
    return Math.max(latest, cycle);
  }, -1);
}

function attemptPhase({ projectRoot, frameworkRoot, roadmap, state, phase, invokeNext, isResume, recoveryCycle, recoveryStrategy }) {
  const record = phaseRecord(state, phase);
  const previous = record.attempts.at(-1);
  if (previous && previous.status !== 'completed') {
    const native = nativeState(projectRoot, previous.native_phase);
    if (native?.state === 'completed') {
      previous.status = 'completed';
      previous.completed_at = native.updated_at || new Date().toISOString();
      record.status = 'completed';
      updatePhaseStatus(roadmap, phase.id, 'done');
      state.current = null;
      writeState(projectRoot, state);
      return { completed: true, reconciled: true };
    }
    if (isResume && previous.status === 'running') {
      previous.status = 'interrupted';
      previous.interrupted_at = new Date().toISOString();
      record.status = 'blocked';
      state.current = { phase_id: phase.id, native_phase: previous.native_phase, attempt: previous.attempt };
      writeState(projectRoot, state);
      return { completed: false, reason: 'interrupted_requires_human', safeToResume: false };
    }
    if (previous.status === 'interrupted') return { completed: false, reason: 'interrupted_requires_human', safeToResume: false };
    if (!isResume) return { completed: false, reason: 'phase_failed', safeToResume: safeToRetry(native) };
    if (!safeToRetry(native)) return { completed: false, reason: 'post_promotion_interruption_requires_human', safeToResume: false };
  }

  const attemptNumber = record.attempts.length + 1;
  const nativePhase = `${phaseKey(phase)}--${state.run.toLowerCase()}-a${attemptNumber}`;
  const cycle = recoveryCycle === undefined ? latestRecoveryCycle(record) + 1 : recoveryCycle;
  const attempt = {
    attempt: attemptNumber,
    native_phase: nativePhase,
    recovery_cycle: cycle,
    ...(cycle > 0 && recoveryStrategy ? { recovery_strategy: recoveryStrategy } : {}),
    status: 'running',
    started_at: new Date().toISOString(),
  };
  record.status = 'running';
  record.attempts.push(attempt);
  state.current = { phase_id: phase.id, native_phase: nativePhase, attempt: attemptNumber };
  updatePhaseStatus(roadmap, phase.id, 'in-progress');
  writeState(projectRoot, state);
  const result = invokeNext({ frameworkRoot, projectRoot, phase: nativePhase, task: phaseTask(phase), provider: state.selected_provider });
  const native = nativeState(projectRoot, nativePhase);
  if (result?.status === 0 && native?.state === 'completed') {
    attempt.status = 'completed';
    attempt.completed_at = new Date().toISOString();
    record.status = 'completed';
    updatePhaseStatus(roadmap, phase.id, 'done');
    state.current = null;
    writeState(projectRoot, state);
    return { completed: true };
  }
  attempt.status = result?.signal ? 'interrupted' : 'failed';
  attempt.exit_code = Number.isInteger(result?.status) ? result.status : null;
  attempt.signal = result?.signal || null;
  attempt.native_state = native?.state || null;
  record.status = 'blocked';
  const retryable = !result?.signal && safeToRetry(native);
  if (!retryable) updatePhaseStatus(roadmap, phase.id, 'blocked');
  state.current = { phase_id: phase.id, native_phase: nativePhase, attempt: attemptNumber };
  writeState(projectRoot, state);
  return {
    completed: false,
    reason: retryable ? 'phase_failed_safe_to_resume' : result?.signal ? 'interrupted_requires_human' : 'post_promotion_failure_requires_human',
    safeToResume: retryable,
  };
}

function recoverFailedPhase({ projectRoot, frameworkRoot, roadmap, state, phase, invokeNext, result, cap }) {
  while (!result.completed && result.safeToResume && state.mode === 'loop') {
    const record = phaseRecord(state, phase);
    const cycle = latestRecoveryCycle(record);
    if (cycle >= cap) return { ...result, reason: 'recovery_cycle_cap_reached' };
    result = attemptPhase({
      projectRoot,
      frameworkRoot,
      roadmap,
      state,
      phase,
      invokeNext,
      isResume: true,
      recoveryCycle: cycle + 1,
      recoveryStrategy: 'fresh_replan_and_reverify',
    });
  }
  return result;
}

function printStatus(state) {
  const completed = state.phases.filter((phase) => phase.status === 'completed').length;
  process.stdout.write(`RIFF wave ${state.run}\nState: ${state.state}\nMode: ${state.mode}\nCompleted phases: ${completed}/${state.phases.length}\n`);
  if (state.current) process.stdout.write(`Current: phase ${state.current.phase_id} (${state.current.native_phase})\n`);
  if (state.stop_reason) process.stdout.write(`Stop reason: ${state.stop_reason}\n`);
  if (state.state !== 'completed') process.stdout.write(`Resume: riff wave --resume --run ${state.run}\n`);
}

export function runAutonomousWave(options = {}, dependencies = {}) {
  const projectRoot = resolveProjectRoot(options.projectRoot);
  const frameworkRoot = resolveFrameworkRoot(projectRoot);
  const invokeNext = dependencies.invokeNext || invokeNativeNext;
  const beforeFinalSecurityScan = dependencies.beforeFinalSecurityScan;
  let state = options.resume ? latestState(projectRoot, options.runId) : makeState(projectRoot, options);
  if (options.resume && state.state === 'completed') fail(`RIFF wave ${state.run} is already completed`);
  const release = acquireLease(projectRoot, state.run);
  try {
    if (!options.resume && finalSecurityArtifactExists(projectRoot, state)) fail(`RIFF wave run already has a final security artifact: ${state.run}`);
    const roadmap = loadRoadmap(projectRoot);
    validateRoadmap(projectRoot, frameworkRoot);
    const cap = resolveWaveProfile(projectRoot, frameworkRoot, state);
    if (options.resume && options.provider && options.provider !== state.selected_provider) fail('selected provider cannot change while resuming a wave');
    for (const id of state.requested_phase_ids) if (!roadmap.phases.some((phase) => phase.id === id)) fail(`requested phase is missing from ROADMAP.yaml: ${id}`);
    state.state = 'running';
    state.stop_reason = null;
    writeState(projectRoot, state);
    const completedThisRun = new Set(state.phases.filter((phase) => phase.status === 'completed').map((phase) => phase.id));
    let resumeCurrent = options.resume && state.current ? String(state.current.phase_id) : null;
    let phasesCompletedThisInvocation = 0;
    let waveCountThisInvocation = 0;

    if (resumeCurrent) {
      for (const wave of state.waves.filter((entry) => entry.status === 'running')) {
        wave.status = 'interrupted';
        wave.interrupted_at = new Date().toISOString();
      }
      const phase = roadmap.phases.find((entry) => entry.id === resumeCurrent);
      const record = state.phases.find((entry) => entry.id === resumeCurrent);
      const native = record?.attempts?.length ? nativeState(projectRoot, record.attempts.at(-1).native_phase) : null;
      if (phase && native?.state === 'completed') {
        const reconciled = attemptPhase({ projectRoot, frameworkRoot, roadmap, state, phase, invokeNext, isResume: true });
        if (!reconciled.completed) return stopWithoutSecurity(projectRoot, state, reconciled.reason);
        completedThisRun.add(phase.id);
        phasesCompletedThisInvocation += 1;
        resumeCurrent = null;
      } else if (phase && ['running', 'interrupted'].includes(record?.attempts?.at(-1)?.status)) {
        const interrupted = attemptPhase({ projectRoot, frameworkRoot, roadmap, state, phase, invokeNext, isResume: true });
        return stopWithoutSecurity(projectRoot, state, interrupted.reason);
      } else {
        writeState(projectRoot, state);
      }
    }

    while (true) {
      const remaining = remainingPhases(roadmap, state.requested_phase_ids);
      if (!remaining.length) {
        return completeAfterSecurity(projectRoot, frameworkRoot, state, state.mode === 'loop' ? 'roadmap_dry' : 'requested_wave_complete', beforeFinalSecurityScan);
      }
      if (state.max_phases && phasesCompletedThisInvocation >= state.max_phases) {
        return stopWithoutSecurity(projectRoot, state, 'max_phases_reached', 'paused');
      }
      if (state.max_runs && waveCountThisInvocation >= state.max_runs) {
        return stopWithoutSecurity(projectRoot, state, 'max_runs_reached', 'paused');
      }

      let ready = selectReadyPhases(roadmap, { requestedIds: state.requested_phase_ids, completedThisRun });
      if (resumeCurrent) {
        const resumed = roadmap.phases.find((phase) => phase.id === resumeCurrent);
        ready = resumed ? [resumed, ...ready.filter((phase) => phase.id !== resumeCurrent)] : ready;
      }
      if (!ready.length) {
        const confirmation = remaining.filter(requiresConfirmation);
        const reason = confirmation.length ? `confirmation_required:${confirmation.map((phase) => phase.id).join(',')}` : 'no_work_ready';
        return stopWithoutSecurity(projectRoot, state, reason);
      }

      const waveNumber = state.waves.length + 1;
      const frontier = state.mode === 'loop' || state.requested_phase_ids.length ? ready : ready;
      const wave = { number: waveNumber, phase_ids: [], status: 'running', started_at: new Date().toISOString() };
      state.waves.push(wave);
      writeState(projectRoot, state);
      waveCountThisInvocation += 1;
      for (const phase of frontier) {
        if (state.max_phases && phasesCompletedThisInvocation >= state.max_phases) break;
        wave.phase_ids.push(phase.id);
        writeState(projectRoot, state);
        const isResume = Boolean(resumeCurrent && phase.id === resumeCurrent);
        const record = phaseRecord(state, phase);
        const previous = record.attempts.at(-1);
        const previousNative = previous ? nativeState(projectRoot, previous.native_phase) : null;
        let result;
        if (isResume && state.mode === 'loop' && previous?.status === 'failed' && safeToRetry(previousNative) && latestRecoveryCycle(record) >= cap) {
          result = { completed: false, reason: 'recovery_cycle_cap_reached', safeToResume: true };
        } else {
          result = attemptPhase({
            projectRoot,
            frameworkRoot,
            roadmap,
            state,
            phase,
            invokeNext,
            isResume,
            ...(isResume && state.mode === 'loop' ? {
              recoveryCycle: latestRecoveryCycle(record) + 1,
              recoveryStrategy: 'fresh_replan_and_reverify',
            } : {}),
          });
          result = recoverFailedPhase({ projectRoot, frameworkRoot, roadmap, state, phase, invokeNext, result, cap });
        }
        resumeCurrent = null;
        if (!result.completed) {
          wave.status = 'blocked';
          wave.completed_at = new Date().toISOString();
          return stopWithoutSecurity(projectRoot, state, result.reason);
        }
        completedThisRun.add(phase.id);
        phasesCompletedThisInvocation += 1;
      }
      wave.status = 'completed';
      wave.completed_at = new Date().toISOString();
      writeState(projectRoot, state);
      if (state.mode !== 'loop' && state.requested_phase_ids.length === 0) {
        return completeAfterSecurity(projectRoot, frameworkRoot, state, 'requested_wave_complete', beforeFinalSecurityScan);
      }
    }
  } finally {
    release();
  }
}

function usage() {
  return `Usage:\n  riff wave --autonomous [--phases 1,2] [--provider codex|claude]\n  riff wave --autonomous --loop [--max-runs N] [--max-phases N]\n  riff wave --resume [--run W-...]\n  riff wave --status [--run W-...]\n`;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(usage()); return; }
  const projectRoot = resolveProjectRoot(options.projectRoot);
  if (options.status) { printStatus(latestState(projectRoot, options.runId)); return; }
  if (!options.autonomous && !options.resume) fail('riff wave requires --autonomous, --loop, or --resume');
  const state = runAutonomousWave(options);
  printStatus(state);
  if (state.state === 'blocked') process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}

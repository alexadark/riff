#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadRoadmap, phaseIsReady, phaseVerificationMetadataSha256, requiresConfirmation, resolveProjectRoot } from './lib/roadmap-workflow.mjs';
import { readActiveWaveRun, readRegularJson, readWaveState } from './lib/wave-state.mjs';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function countFiles(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile()).length; } catch { return 0; }
}

function activeWave(projectRoot) {
  try {
    const run = readActiveWaveRun(projectRoot);
    return run ? { wave: readWaveState(projectRoot, run), invalid: null } : { wave: null, invalid: null };
  } catch (error) {
    return { wave: null, invalid: error.message };
  }
}

function artifactPath(projectRoot, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) return null;
  return path.join(projectRoot, relative);
}

function invalidVerification(phase, reason) {
  return { status: 'invalid', phase_id: phase?.id || null, phase_title: phase?.title || null, reason, approval_command: null };
}

function activeVerification(projectRoot, roadmap, wave, invalidWave) {
  if (invalidWave) return invalidVerification(null, invalidWave);
  if (!wave || !Array.isArray(wave.phases)) return null;
  const phase = wave.phases.find((entry) => entry?.verification?.status === 'pending')
    || wave.phases.find((entry) => entry?.verification?.status === 'approved');
  if (!phase) return null;
  const verification = phase.verification;
  const roadmapPhase = roadmap.phases.find((entry) => entry.id === phase.id);
  if (!roadmapPhase || verification.phase_metadata_sha256 !== phaseVerificationMetadataSha256(roadmapPhase)) return invalidVerification(phase, 'request metadata is stale');
  const requestFile = artifactPath(projectRoot, verification.request_path);
  if (!requestFile || !/^[a-f0-9]{64}$/.test(verification.request_sha256 || '')) return invalidVerification(phase, 'request state is invalid');
  let request;
  try { request = readRegularJson(requestFile, `human verification request for phase ${phase.id}`); }
  catch (error) { return invalidVerification(phase, error.message); }
  if (!request || createHash('sha256').update(request.bytes).digest('hex') !== verification.request_sha256) return invalidVerification(phase, 'request is missing or tampered');
  const body = request.value;
  if (!body || body.schema_version !== 1 || body.run !== wave.run || body.provider !== wave.selected_provider
    || body.phase_id !== phase.id || body.phase_metadata_sha256 !== verification.phase_metadata_sha256
    || body.reason !== verification.reason || JSON.stringify(body.checks) !== JSON.stringify(verification.checks)
    || typeof body.nonce !== 'string' || !body.nonce || typeof body.requested_at !== 'string' || !body.requested_at) {
    return invalidVerification(phase, 'request does not match wave state');
  }
  if (verification.status === 'approved') {
    const receiptFile = artifactPath(projectRoot, verification.receipt_path);
    if (!receiptFile || !/^[a-f0-9]{64}$/.test(verification.receipt_sha256 || '')) return invalidVerification(phase, 'approval state is invalid');
    let receipt;
    try { receipt = readRegularJson(receiptFile, `human verification approval for phase ${phase.id}`); }
    catch (error) { return invalidVerification(phase, error.message); }
    if (!receipt || createHash('sha256').update(receipt.bytes).digest('hex') !== verification.receipt_sha256) return invalidVerification(phase, 'approval is missing or tampered');
    const approval = receipt.value;
    if (!approval || approval.schema_version !== 1 || approval.run !== wave.run || approval.provider !== wave.selected_provider
      || approval.phase_id !== phase.id || approval.phase_metadata_sha256 !== verification.phase_metadata_sha256
      || approval.request_sha256 !== verification.request_sha256 || typeof approval.evidence_note !== 'string'
      || approval.evidence_sha256 !== createHash('sha256').update(approval.evidence_note).digest('hex')
      || typeof approval.approved_at !== 'string' || !approval.approved_at) {
      return invalidVerification(phase, 'approval does not match wave state');
    }
  }
  return {
    status: verification.status,
    phase_id: phase.id,
    phase_title: phase.title,
    reason: verification.reason,
    request_path: verification.request_path,
    request_sha256: verification.request_sha256,
    receipt_path: verification.receipt_path || null,
    approval_command: verification.status === 'pending'
      ? `riff wave --approve --run ${wave.run} --phase ${phase.id} --evidence "Checked: <scope>; Observed: <result>; Expected: <expected result>"`
      : null,
  };
}

function latestNativeStage(projectRoot) {
  const root = path.join(projectRoot, '.planning', 'riff-next');
  let candidates;
  try {
    candidates = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => ({ file: path.join(root, entry.name), name: entry.name }))
      .map((entry) => ({ ...entry, mtime: fs.statSync(entry.file).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime);
  } catch { return null; }
  for (const candidate of candidates) {
    const value = readJson(candidate.file);
    if (value?.state) return { phase: candidate.name.slice(0, -5), state: value.state, stop_reason: value.stop_reason || null };
  }
  return null;
}

export function projectStatus(projectRoot = process.cwd()) {
  const root = resolveProjectRoot(projectRoot);
  const roadmap = loadRoadmap(root);
  const done = roadmap.phases.filter((phase) => ['done', 'skipped'].includes(phase.status)).length;
  const ready = roadmap.phases.filter((phase) => phaseIsReady(phase, roadmap.phases) && !requiresConfirmation(phase));
  const awaitingHuman = roadmap.phases.filter((phase) => phaseIsReady(phase, roadmap.phases) && requiresConfirmation(phase));
  const blocked = roadmap.phases.filter((phase) => phase.status === 'blocked');
  const current = roadmap.phases.filter((phase) => phase.status === 'in-progress');
  const active = activeWave(root);
  const wave = active.wave;
  return {
    project_root: root,
    progress: { done, total: roadmap.phases.length, percent: roadmap.phases.length ? Math.round((done / roadmap.phases.length) * 100) : 0 },
    phases: roadmap.phases.map(({ id, title, status, priority, mode, dependsOn }) => ({ id, title, status, priority, mode, depends_on: dependsOn })),
    current: current.map((phase) => phase.id),
    ready: ready.map((phase) => phase.id),
    awaiting_human: awaitingHuman.map((phase) => phase.id),
    blocked: blocked.map((phase) => phase.id),
    active_wave: wave,
    active_verification: activeVerification(root, roadmap, wave, active.invalid),
    latest_native_stage: latestNativeStage(root),
    pending: {
      expertise: countFiles(path.join(root, '.planning', 'expertise', '.pending')),
      seeds: countFiles(path.join(root, '.planning', 'seeds')),
    },
  };
}

function render(status) {
  const lines = [
    `RIFF status: ${path.basename(status.project_root)}`,
    `Progress: ${status.progress.done}/${status.progress.total} phases (${status.progress.percent}%)`,
  ];
  for (const phase of status.phases) lines.push(`${phase.id}\t${phase.status}\t${phase.priority}\t${phase.mode.join(',')}\t${phase.title}`);
  if (status.current.length) lines.push(`Current: ${status.current.join(', ')}`);
  if (status.ready.length) lines.push(`Ready: ${status.ready.join(', ')}`);
  if (status.awaiting_human.length) lines.push(`Awaiting human verification: ${status.awaiting_human.join(', ')}`);
  if (status.blocked.length) lines.push(`Blocked: ${status.blocked.join(', ')}`);
  if (status.active_wave) lines.push(`Active wave: ${status.active_wave.run} (${status.active_wave.state}; ${status.active_wave.stop_reason || 'running'})`);
  if (status.active_verification) {
    lines.push(`Verification: phase ${status.active_verification.phase_id} (${status.active_verification.status}; ${status.active_verification.reason})`);
    if (status.active_verification.approval_command) lines.push(`Approve: ${status.active_verification.approval_command}`);
  }
  if (status.latest_native_stage) lines.push(`Latest native stage: ${status.latest_native_stage.phase} (${status.latest_native_stage.state})`);
  lines.push(`Pending: ${status.pending.expertise} expertise, ${status.pending.seeds} seeds`);
  if (status.active_verification?.approval_command) lines.push(`Next: ${status.active_verification.approval_command}`);
  else if (status.blocked.length) lines.push('Next: inspect the blocked phase and its native artifacts.');
  else if (status.awaiting_human.length) lines.push(`Next: complete human verification for phase ${status.awaiting_human[0]}.`);
  else if (status.ready.length) lines.push(`Next: riff wave --autonomous --loop`);
  else lines.push('Next: roadmap complete. Review, then promote only with explicit confirmation.');
  return `${lines.join('\n')}\n`;
}

export function main(argv = process.argv.slice(2)) {
  let projectRoot = process.cwd();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--project-root') projectRoot = argv[++index];
    else if (token === '--json') json = true;
    else if (token === '--help' || token === '-h') {
      process.stdout.write('Usage: riff status [--json] [--project-root <path>]\n');
      return;
    } else throw new Error(`unknown riff status option: ${token}`);
  }
  const status = projectStatus(projectRoot);
  process.stdout.write(json ? `${JSON.stringify(status, null, 2)}\n` : render(status));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  try { main(); } catch (error) { process.stderr.write(`riff status: ${error.message}\n`); process.exitCode = 1; }
}

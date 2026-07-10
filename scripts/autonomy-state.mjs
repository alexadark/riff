#!/usr/bin/env node
// Shared state machinery for autonomous sessions (protocols/AUTONOMY.md).
// One place for: atomic writes, parkPhase ordering, the launch lock, the
// STATE.md active-run pointer, and the safe|hold classification vocabulary.
//
// CLI (agents call these instead of hand-editing state files):
//   node .riff/scripts/autonomy-state.mjs classify --tags "a,b" --paths "x,y" --text "<title + description>"
//   node .riff/scripts/autonomy-state.mjs park --run <run-id> --phase <id> --type <t> --branch <b> --waiting "<msg>" --artifact <path>
//   node .riff/scripts/autonomy-state.mjs phase-status --run <run-id> --phase <id> --status <s>   (exit 5 = lock lost: stop, park, never merge)
//   node .riff/scripts/autonomy-state.mjs lock acquire --run <run-id> [--loop] | lock release | lock touch [--run <run-id>] | lock status
//   node .riff/scripts/autonomy-state.mjs loop start-run --run <run-id> | loop complete-run --run <run-id>
//   node .riff/scripts/autonomy-state.mjs pointer set --run <run-id> [--loop] | pointer clear | pointer read
//   node .riff/scripts/autonomy-state.mjs resolve-launch
// All subcommands accept --project-root <dir> (default: cwd).
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseFinishers, serializeFinishers } from './lib/finishers.mjs';

// ---------------------------------------------------------------------------
// Atomic writes
// ---------------------------------------------------------------------------

/**
 * Write a file via temp + fsync + atomic rename in the same directory.
 * After this returns, the file is either the old content or the new content —
 * never a torn write.
 */
export function atomicWrite(file, content) {
  const dir = path.dirname(file);
  mkdirSync(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(file)}.tmp-${process.pid}`);
  const fd = openSync(temp, 'w');
  try {
    writeFileSync(fd, content);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temp, file);
  fsyncDir(dir);
}

/**
 * Fsync a directory so the rename above survives power loss — without it,
 * some filesystems can drop the new directory entry. Best-effort: platforms
 * or filesystems that refuse directory fsync are tolerated.
 */
function fsyncDir(dir) {
  let fd;
  try {
    fd = openSync(dir, 'r');
  } catch {
    return;
  }
  try {
    fsyncSync(fd);
  } catch {
    // EINVAL/EBADF on filesystems that reject directory fsync
  } finally {
    closeSync(fd);
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null; // missing OR corrupt — callers treat both as "no parseable state"
  }
}

export function readRunJson(runDir) {
  return readJson(path.join(runDir, 'run.json'));
}

export function writeRunJson(runDir, data) {
  atomicWrite(path.join(runDir, 'run.json'), `${JSON.stringify(data, null, 2)}\n`);
  // Every phase status transition goes through here — heartbeat the launch
  // lock automatically so staleness never depends on an agent remembering
  // `lock touch`. Best-effort: no lock (tests, manual runs) is fine.
  // runDir = <projectRoot>/.planning/autonomy/<run-id>
  touchLock(path.resolve(runDir, '..', '..', '..'), { runId: data?.run });
}

export function readLoopJson(projectRoot) {
  return readJson(path.join(projectRoot, '.planning/autonomy/loop.json'));
}

export function writeLoopJson(projectRoot, data) {
  atomicWrite(path.join(projectRoot, '.planning/autonomy/loop.json'), `${JSON.stringify(data, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// parkPhase — order is load-bearing
// ---------------------------------------------------------------------------

/**
 * Stable finisher id, derived — no shared counter, no read-modify-write.
 * Same phase+type always maps to the same id (and the same file), so
 * re-parking overwrites its own marker and never anyone else's.
 */
export function finisherId(phaseId, type) {
  const slug = (value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `F-${slug(phaseId)}-${slug(type)}`;
}

/**
 * Park a phase: write the no-merge marker FIRST, then flip run.json. A crash
 * between the two writes leaves a pending finisher with no parked status —
 * safe (the guard still blocks the branch). The reverse order would leave a
 * parked branch with no marker — forbidden.
 *
 * One finisher per file (`<run-dir>/finishers/<id>.yaml`), written atomically:
 * concurrent parks (wave mode) write different files and cannot lose each
 * other's marker by construction. Same phase+type re-park rewrites the same
 * file with an identical id — equivalent, not a loss. Legacy single-ledger
 * `finishers.yaml` files are still READ everywhere but never written.
 *
 * `finisher`: { id?, type, phase, branch, waiting_on, artifact, created? }.
 */
export function parkPhase({ projectRoot, runId, phaseId, finisher }) {
  const runDir = path.join(projectRoot, '.planning/autonomy', runId);
  const id = finisher.id || finisherId(finisher.phase || phaseId, finisher.type);
  const markerFile = path.join(runDir, 'finishers', `${id}.yaml`);

  // preserve the original created date on re-park
  let created = finisher.created;
  if (!created && existsSync(markerFile)) {
    const prior = parseFinishers(readFileSync(markerFile, 'utf8'));
    created = prior.entries[0]?.created || prior.malformed[0]?.entry?.created;
  }

  const written = {
    ...finisher,
    id,
    status: 'pending',
    created: created || new Date().toISOString().slice(0, 10),
  };

  // 1. No-merge marker first.
  atomicWrite(markerFile, serializeFinishers({ run: runId, entries: [written] }));

  // 2. Status flip second. run.json is read-modify-write, so concurrent parks
  // can clobber each other's status flip — retry until our flip is visible.
  // Bookkeeping only: the marker above is the safety invariant; resume and the
  // guard derive truth from markers + git state, never from this status alone.
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const run = readRunJson(runDir);
    if (!run || !Array.isArray(run.phases)) break;
    const phase = run.phases.find((entry) => entry.id === phaseId);
    if (!phase || phase.status === 'parked') break;
    phase.status = 'parked';
    writeRunJson(runDir, run);
  }

  return written;
}

/**
 * THE phase status transition path (documented in AUTONOMY.md § Resume):
 * writes run.json atomically and heartbeats the launch lock in one call.
 * `lockLost: true` means this session no longer owns the lock (stolen after a
 * false-stale reclaim, or a parallel launch won) — the caller must stop the
 * run and park, never merge. The status write still lands: state on disk must
 * reflect reality even when the lock is gone.
 */
export function setPhaseStatus({ projectRoot, runId, phaseId, status }) {
  const runDir = path.join(projectRoot, '.planning/autonomy', runId);
  const run = readRunJson(runDir);
  if (!run || !Array.isArray(run.phases)) {
    return { ok: false, reason: `no parseable run.json under ${runDir}` };
  }
  const phase = run.phases.find((entry) => entry.id === phaseId);
  if (!phase) return { ok: false, reason: `phase ${phaseId} not in run ${runId}` };
  phase.status = status;
  writeRunJson(runDir, run);
  const heartbeat = touchLock(projectRoot, { runId });
  // 'no-lock' is fine (manual/test runs); a mismatch or lost dir is fencing
  const lockLost = !heartbeat.ok && heartbeat.reason !== 'no-lock';
  return { ok: true, lockLost, heartbeat };
}

// ---------------------------------------------------------------------------
// Launch lock (anti-double-launch, shared by run and loop)
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 45 * 60 * 1000; // no heartbeat for 45 min = presumed dead

// The lock is a DIRECTORY: mkdir is atomic + exclusive on every platform, so
// creation has exactly one winner by construction. Ownership identity is the
// run TOKEN in owner.json — never the pid of the short-lived CLI helper that
// created it. The pid is recorded as a secondary liveness signal only.
function lockDir(projectRoot) {
  return path.join(projectRoot, '.planning/autonomy/lock');
}

function lockOwnerFile(projectRoot) {
  return path.join(lockDir(projectRoot), 'owner.json');
}

function legacyLockFile(projectRoot) {
  return path.join(projectRoot, '.planning/autonomy/lock.json');
}

function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM'; // alive, owned by someone else
  }
}

export function lockStatus(projectRoot) {
  const dir = lockDir(projectRoot);
  // pre-redesign single-file lock: still honored so an upgrade mid-run can
  // never double-launch
  if (!existsSync(dir)) {
    const legacy = legacyLockFile(projectRoot);
    if (!existsSync(legacy)) return { held: false };
    const data = readJson(legacy);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(legacy).mtimeMs;
    } catch {
      return { held: false };
    }
    const stale = !pidAlive(data?.pid) && Date.now() - mtimeMs > LOCK_STALE_MS;
    return { held: true, stale, owner: data || { corrupt: true }, mtimeMs, legacy: true };
  }

  const ownerFile = lockOwnerFile(projectRoot);
  const data = readJson(ownerFile);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(ownerFile).mtimeMs;
  } catch {
    // dir exists but owner.json unreadable: an acquirer mid-write, or debris.
    // Judge staleness from the dir mtime — fail toward "held" while fresh.
    try {
      mtimeMs = statSync(dir).mtimeMs;
    } catch {
      return { held: false };
    }
  }
  // Staleness = no mtime heartbeat for the window. pid is secondary evidence:
  // a live recorded pid always means held, but a dead pid alone proves nothing
  // (the CLI helper that wrote the lock exits immediately by design).
  const stale = !pidAlive(data?.pid) && Date.now() - mtimeMs > LOCK_STALE_MS;
  return { held: true, stale, owner: data || { corrupt: true }, mtimeMs };
}

/**
 * Check-and-set: mkdir the lock directory (atomic + exclusive). If a live
 * lock exists, returns { acquired: false, holder } — the caller must RESUME
 * the existing run/loop, never start a parallel one.
 *
 * Stale reclaim is a compare-and-swap: rename the stale dir aside (atomic —
 * exactly one reclaimer can win; losers get ENOENT and fall back to mkdir),
 * re-check the moved owner against what was read, then acquire fresh via
 * mkdir. A lock belonging to someone else is NEVER unlinked in place, so two
 * relaunches can never both think they own it.
 */
export function acquireLock(projectRoot, { runId, loop = false } = {}) {
  mkdirSync(path.join(projectRoot, '.planning/autonomy'), { recursive: true });
  const dir = lockDir(projectRoot);

  const tryMkdir = () => {
    try {
      mkdirSync(dir);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      return false;
    }
    atomicWrite(lockOwnerFile(projectRoot), `${JSON.stringify({
      token: runId || null,
      loop,
      pid: process.pid,
      started: new Date().toISOString(),
    }, null, 2)}\n`);
    return true;
  };

  // one-time migration: a legacy lock.json is honored while live, removed
  // when provably dead (safe: acquisition still funnels through mkdir)
  if (!existsSync(dir) && existsSync(legacyLockFile(projectRoot))) {
    const legacyStatus = lockStatus(projectRoot);
    if (legacyStatus.held && !legacyStatus.stale) {
      return { acquired: false, holder: legacyStatus.owner };
    }
    try {
      unlinkSync(legacyLockFile(projectRoot));
    } catch {
      // someone else migrated first
    }
  }

  if (tryMkdir()) return { acquired: true };

  const status = lockStatus(projectRoot);
  if (status.held && !status.stale) {
    return { acquired: false, holder: status.owner };
  }
  if (!status.held) {
    // lock vanished between mkdir failure and the status read — retry once
    if (tryMkdir()) return { acquired: true };
    return { acquired: false, holder: readJson(lockOwnerFile(projectRoot)) };
  }

  // Stale — reclaim via CAS. The rename is the atomic commit point.
  const graveyard = `${dir}.reclaimed-${process.pid}-${Date.now()}`;
  try {
    renameSync(dir, graveyard);
  } catch {
    // lost the reclaim race; the winner (or a fresh acquirer) owns the name
    if (tryMkdir()) return { acquired: true, reclaimed: true, previous: status.owner };
    return { acquired: false, holder: readJson(lockOwnerFile(projectRoot)) };
  }

  // Post-rename check: the owner we moved aside must still be the one we
  // judged stale (same token, no heartbeat since we read it). If not, the
  // lock changed hands or woke up in the window — put it back untouched.
  const moved = readJson(path.join(graveyard, 'owner.json'));
  let movedFresh = false;
  try {
    movedFresh = Date.now() - statSync(path.join(graveyard, 'owner.json')).mtimeMs <= LOCK_STALE_MS;
  } catch {
    movedFresh = false;
  }
  const sameOwner = (moved?.token ?? null) === (status.owner?.token ?? null);
  if (!sameOwner || movedFresh) {
    try {
      renameSync(graveyard, dir);
    } catch {
      // a fresh lock claimed the name meanwhile; keep the graveyard as evidence
    }
    return { acquired: false, holder: readJson(lockOwnerFile(projectRoot)) ?? moved };
  }

  rmSync(graveyard, { recursive: true, force: true });
  if (tryMkdir()) return { acquired: true, reclaimed: true, previous: status.owner };
  return { acquired: false, holder: readJson(lockOwnerFile(projectRoot)) };
}

/**
 * Heartbeat: bump the owner.json mtime. Called automatically by writeRunJson
 * on every phase status transition — agents never need to remember it.
 *
 * With `runId`, also verifies ownership (fencing): if the lock's token is a
 * different run, THIS session lost the lock — the caller must stop building
 * and park, never merge. Uses utimes (in-place mtime bump), never a rewrite:
 * a heartbeat can't overwrite an owner file that changed hands.
 */
export function touchLock(projectRoot, { runId } = {}) {
  const ownerFile = lockOwnerFile(projectRoot);
  const data = readJson(ownerFile);
  if (!data) return { ok: false, reason: 'no-lock' };
  if (runId && data.token && data.token !== runId) {
    return { ok: false, reason: 'token-mismatch', holder: data };
  }
  try {
    const now = new Date();
    utimesSync(ownerFile, now, now);
  } catch {
    return { ok: false, reason: 'lock-lost' };
  }
  return { ok: true };
}

export function releaseLock(projectRoot) {
  rmSync(lockDir(projectRoot), { recursive: true, force: true });
  try {
    unlinkSync(legacyLockFile(projectRoot));
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------------------
// STATE.md active-run pointer
// ---------------------------------------------------------------------------

const POINTER_HEADER = '## Active Autonomous Run';

function pointerBlock(runId, loop) {
  return [
    POINTER_HEADER,
    '',
    `- **Run**: ${runId || '-'}`,
    `- **Loop**: ${runId ? (loop ? 'yes' : 'no') : '-'}`,
  ].join('\n');
}

function replacePointerSection(stateText, runId, loop) {
  const block = pointerBlock(runId, loop);
  const sectionPattern = /## Active Autonomous Run\n(?:[^\n]*\n)*?(?=## |$)/;
  if (sectionPattern.test(stateText)) {
    return stateText.replace(sectionPattern, `${block}\n\n`);
  }
  // insert after ## Active Phase when present, else append
  const anchor = /(## Active Phase\n(?:[^\n]*\n)*?)(?=## )/;
  if (anchor.test(stateText)) {
    return stateText.replace(anchor, `$1${block}\n\n`);
  }
  return `${stateText.replace(/\n*$/, '\n\n')}${block}\n`;
}

export function writeStatePointer(projectRoot, { runId, loop = false }) {
  const file = path.join(projectRoot, 'STATE.md');
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '# State\n\n';
  atomicWrite(file, replacePointerSection(text, runId, loop));
}

export function clearStatePointer(projectRoot) {
  const file = path.join(projectRoot, 'STATE.md');
  if (!existsSync(file)) return;
  atomicWrite(file, replacePointerSection(readFileSync(file, 'utf8'), null, false));
}

export function readStatePointer(projectRoot) {
  const file = path.join(projectRoot, 'STATE.md');
  if (!existsSync(file)) return { runId: null, loop: false };
  const text = readFileSync(file, 'utf8');
  const section = text.match(/## Active Autonomous Run\n(?:[^\n]*\n)*?(?=## |$)/)?.[0];
  if (!section) return { runId: null, loop: false };
  const runId = section.match(/\*\*Run\*\*:\s*(.+?)\s*$/m)?.[1];
  const loop = /\*\*Loop\*\*:\s*yes\s*$/m.test(section);
  if (!runId || runId === '-') return { runId: null, loop: false };
  return { runId, loop };
}

// ---------------------------------------------------------------------------
// Launch resolution (resume safety)
// ---------------------------------------------------------------------------

/** Non-terminal run directories on disk (defensive fallback for resume). */
function scanRunDirs(projectRoot) {
  const root = path.join(projectRoot, '.planning/autonomy');
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!/^\d{4}-\d{2}-\d{2}-\d{4}$/.test(entry.name)) continue;
    const run = readRunJson(path.join(root, entry.name));
    if (run && run.stage && run.stage !== 'done') found.push({ runId: entry.name, run });
  }
  return found;
}

/**
 * Record the start of a loop run: loop.json `current_run` is the loop's
 * authoritative in-flight run id. Written BEFORE the STATE.md pointer so a
 * crash between the two leaves the authoritative record, not the hint.
 */
export function startLoopRun(projectRoot, runId) {
  const loopState = readLoopJson(projectRoot);
  if (!loopState) return { ok: false, reason: 'no-loop' };
  loopState.current_run = runId;
  writeLoopJson(projectRoot, loopState);
  return { ok: true };
}

/**
 * Count a completed run exactly once: `last_completed_run` is the idempotency
 * marker, written atomically WITH the increment. Calling this twice for the
 * same run (crash between REPORT.md and the next run, then resume) counts once.
 */
export function recordRunCompleted(projectRoot, runId) {
  const loopState = readLoopJson(projectRoot);
  if (!loopState) return { counted: false, reason: 'no-loop' };
  if (loopState.last_completed_run === runId) {
    return { counted: false, reason: 'already-counted', runs_completed: loopState.runs_completed };
  }
  loopState.runs_completed = (loopState.runs_completed || 0) + 1;
  loopState.last_completed_run = runId;
  if (loopState.current_run === runId) loopState.current_run = null;
  writeLoopJson(projectRoot, loopState);
  return { counted: true, runs_completed: loopState.runs_completed };
}

/**
 * What a `--autonomous` launch must do for this project:
 *   { action: 'resume', runId, loop, run }    — in-flight run, front-load stays locked
 *   { action: 'restart-run', runId, loop }    — run dir exists but run.json missing/corrupt
 *                                               while the loop is running: restart the SAME
 *                                               run-id fresh, no questions, never
 *                                               double-count runs_completed
 *   { action: 'continue-loop', loop: true }   — loop running, no in-flight run (crash
 *                                               between runs): start the NEXT run under the
 *                                               locked front-load. `completedRun` is set when
 *                                               the current run finished but may not be
 *                                               counted yet — call recordRunCompleted first.
 *   { action: 'new' }                         — nothing in flight
 *
 * Authority order when the loop is running: loop.json `current_run` first,
 * the STATE.md pointer as a hint only, a run-dir scan as a defensive
 * fallback. Never restart a run id that cannot be verified on disk.
 */
export function resolveLaunch(projectRoot) {
  const pointer = readStatePointer(projectRoot);
  const loopState = readLoopJson(projectRoot);
  const loopRunning = loopState?.status === 'running';

  if (loopRunning) {
    const candidates = [];
    if (loopState.current_run) candidates.push(loopState.current_run);
    if (pointer.runId && !candidates.includes(pointer.runId)) candidates.push(pointer.runId);

    for (const runId of candidates) {
      const runDir = path.join(projectRoot, '.planning/autonomy', runId);
      const run = readRunJson(runDir);
      if (run && run.stage && run.stage !== 'done') {
        return { action: 'resume', runId, loop: true, run };
      }
      if (run && run.stage === 'done') {
        // crashed between REPORT.md and the next run start
        return { action: 'continue-loop', loop: true, completedRun: runId };
      }
      if (existsSync(runDir)) {
        // dir exists, run.json missing or corrupt: same-id fresh restart
        return { action: 'restart-run', runId, loop: true };
      }
      // no run dir at all: a stale/mismatched id — never restart it blind
    }

    const scanned = scanRunDirs(projectRoot);
    if (scanned.length === 1) {
      return { action: 'resume', runId: scanned[0].runId, loop: true, run: scanned[0].run };
    }
    // zero (between runs) or ambiguous (>1, never guess): next run decides
    return { action: 'continue-loop', loop: true };
  }

  if (pointer.runId) {
    const run = readRunJson(path.join(projectRoot, '.planning/autonomy', pointer.runId));
    if (run && run.stage && run.stage !== 'done') {
      return { action: 'resume', runId: pointer.runId, loop: pointer.loop, run };
    }
    // stale pointer (run done or unparseable, no loop backing it):
    // treat as new launch, caller clears the pointer.
  }
  return { action: 'new' };
}

// ---------------------------------------------------------------------------
// Autonomy boundary classification (safe | hold)
// ---------------------------------------------------------------------------

// Tag vocabulary — exact tag match, case-insensitive, `-`/`_` interchangeable.
export const HOLD_TAGS = new Set([
  // original set
  'security_critical', 'auth', 'payment', 'payments', 'billing', 'compliance', 'regulated', 'migration',
  // money surfaces
  'finance', 'invoice', 'invoices', 'refund', 'refunds', 'credits',
  'subscription', 'subscriptions', 'entitlement', 'entitlements',
  // privacy / legal surfaces
  'privacy', 'pii', 'gdpr', 'data_deletion', 'consent', 'retention', 'legal', 'audit', 'kyc', 'aml',
]);

// Path/text heuristics — matched against phase tags, file paths, AND
// title/description. Any match = hold. Referenced by AUTO-TRIGGERS.md
// § Autonomy boundary heuristic (this file is the source of truth).
export const SENSITIVE_PATTERNS = [
  // auth surface
  /\bauth\b|authenticat|authoriz|oauth|\bsso\b|\bsaml\b|\bsession(s)?\b|password|passkey|\bmfa\b|\b2fa\b|magic[-_ ]?link|api[-_ ]?key|\bsecret(s)?\b|\btoken(s)?\b/i,
  // money surface
  /payment|payout|billing|checkout|invoic|refund|chargeback|subscription|entitlement|\bcredits?\b|\bwallet\b|pricing[-_ ]?plan|\btax\b|\bvat\b/i,
  // payment providers
  /stripe|paddle|lemon[-_ ]?squeezy|braintree|paypal|chargebee|recurly|adyen|mollie|razorpay|square(?:up)?\b/i,
  // privacy / regulated surface
  /\bgdpr\b|\bccpa\b|\bpii\b|privacy|consent|\bretention\b|erasure|right[-_ ]to[-_ ]be[-_ ]forgotten|anonymi[sz]|data[-_ ]?(deletion|export|subject)|delete[-_ ]?(account|user|data)|export[-_ ]?(data|user)|\bkyc\b|\baml\b|complian|regulat|\blegal\b|audit[-_ ]?(log|trail)|\bdsar\b|\bdpa\b|data[-_ ]?processing[-_ ]?agreement|\bcookies?\b|analytics[-_ ]?opt[-_ ]?out|personal[-_ ]?data/i,
  // irreversible data surface
  /\bmigration(s)?\b|\bmigrate\b|drop[-_ ]?(table|column)/i,
];

function normalizeTag(tag) {
  return String(tag).toLowerCase().replaceAll('-', '_').trim();
}

/**
 * Classify a phase against the autonomy boundary. ANY hold-tag match or ANY
 * sensitive-pattern match in tags, paths, or title/description → hold.
 * Objective by construction: no planner judgment required to fire.
 */
export function classifyPhase({ tags = [], paths = [], text = '' } = {}) {
  const matches = [];
  for (const tag of tags) {
    if (HOLD_TAGS.has(normalizeTag(tag))) matches.push({ source: 'tag', value: String(tag) });
  }
  const haystacks = [
    ...paths.map((value) => ({ source: 'path', value: String(value) })),
    ...(text ? [{ source: 'text', value: String(text) }] : []),
  ];
  for (const { source, value } of haystacks) {
    for (const pattern of SENSITIVE_PATTERNS) {
      const hit = value.match(pattern);
      if (hit) {
        matches.push({ source, value: hit[0] });
        break;
      }
    }
  }
  return { autonomy: matches.length > 0 ? 'hold' : 'safe', matches };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseFlags(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--loop') {
      flags.loop = true;
    } else if (arg.startsWith('--')) {
      flags[arg.slice(2).replaceAll('-', '_')] = argv[index + 1];
      index += 1;
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function cli() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const projectRoot = flags.project_root || process.cwd();

  switch (command) {
    case 'classify': {
      const split = (value) => (value ? String(value).split(',').map((entry) => entry.trim()).filter(Boolean) : []);
      const result = classifyPhase({ tags: split(flags.tags), paths: split(flags.paths), text: flags.text || '' });
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exit(result.autonomy === 'hold' ? 3 : 0); // distinct code so shells can branch
    }
    case 'park': {
      if (!flags.run || !flags.phase || !flags.type) fail('park requires --run --phase --type (+ --branch --waiting --artifact)');
      const entry = parkPhase({
        projectRoot,
        runId: flags.run,
        phaseId: flags.phase,
        finisher: {
          type: flags.type,
          phase: flags.phase,
          branch: flags.branch || null,
          waiting_on: flags.waiting || 'human sign-off',
          artifact: flags.artifact || null,
        },
      });
      process.stdout.write(`parked ${flags.phase} — finisher ${entry.id} pending\n`);
      return;
    }
    case 'phase-status': {
      if (!flags.run || !flags.phase || !flags.status) fail('phase-status requires --run --phase --status');
      const result = setPhaseStatus({
        projectRoot,
        runId: flags.run,
        phaseId: flags.phase,
        status: flags.status,
      });
      if (!result.ok) fail(result.reason);
      if (result.lockLost) {
        process.stderr.write(`lock lost (${result.heartbeat.reason}${result.heartbeat.holder ? `, held by ${JSON.stringify(result.heartbeat.holder)}` : ''}) — stop this run, park, never merge\n`);
        process.exit(5); // 5 = this session no longer owns the launch lock
      }
      process.stdout.write(`${flags.phase} -> ${flags.status}\n`);
      return;
    }
    case 'lock': {
      const action = flags._[0];
      if (action === 'acquire') {
        const result = acquireLock(projectRoot, { runId: flags.run, loop: Boolean(flags.loop) });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exit(result.acquired ? 0 : 4); // 4 = held by a live owner: RESUME, do not relaunch
      }
      if (action === 'release') {
        releaseLock(projectRoot);
        return;
      }
      if (action === 'touch') {
        const result = touchLock(projectRoot, { runId: flags.run });
        process.stdout.write(`${JSON.stringify(result)}\n`);
        // token-mismatch/lock-lost = fencing violation: exit 5, caller must stop
        process.exit(result.ok || result.reason === 'no-lock' ? 0 : 5);
      }
      if (action === 'status') {
        process.stdout.write(`${JSON.stringify(lockStatus(projectRoot))}\n`);
        return;
      }
      fail('lock requires acquire | release | touch | status');
      return;
    }
    case 'loop': {
      const action = flags._[0];
      if (action === 'start-run') {
        if (!flags.run) fail('loop start-run requires --run');
        const result = startLoopRun(projectRoot, flags.run);
        if (!result.ok) fail(`loop start-run: ${result.reason}`);
        process.stdout.write(`loop current_run -> ${flags.run}\n`);
        return;
      }
      if (action === 'complete-run') {
        if (!flags.run) fail('loop complete-run requires --run');
        const result = recordRunCompleted(projectRoot, flags.run);
        process.stdout.write(`${JSON.stringify(result)}\n`);
        return;
      }
      fail('loop requires start-run | complete-run');
      return;
    }
    case 'pointer': {
      const action = flags._[0];
      if (action === 'set') {
        if (!flags.run) fail('pointer set requires --run');
        writeStatePointer(projectRoot, { runId: flags.run, loop: Boolean(flags.loop) });
        return;
      }
      if (action === 'clear') {
        clearStatePointer(projectRoot);
        return;
      }
      if (action === 'read') {
        process.stdout.write(`${JSON.stringify(readStatePointer(projectRoot))}\n`);
        return;
      }
      fail('pointer requires set | clear | read');
      return;
    }
    case 'resolve-launch': {
      const { run, ...result } = resolveLaunch(projectRoot);
      process.stdout.write(`${JSON.stringify(result)}\n`);
      return;
    }
    default:
      fail('usage: autonomy-state <classify | park | phase-status | lock | loop | pointer | resolve-launch> [flags]');
  }
}

let invokedDirectly = false;
try {
  invokedDirectly = Boolean(process.argv[1])
    && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) cli();

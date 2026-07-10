#!/usr/bin/env node
// Shared state machinery for autonomous sessions (protocols/AUTONOMY.md).
// One place for: atomic writes, parkPhase ordering, the launch lock, the
// STATE.md active-run pointer, and the safe|hold classification vocabulary.
//
// CLI (agents call these instead of hand-editing state files):
//   node .riff/scripts/autonomy-state.mjs classify --tags "a,b" --paths "x,y" --text "<title + description>"
//   node .riff/scripts/autonomy-state.mjs park --run <run-id> --phase <id> --type <t> --branch <b> --waiting "<msg>" --artifact <path>
//   node .riff/scripts/autonomy-state.mjs lock acquire --run <run-id> [--loop] | lock release | lock status
//   node .riff/scripts/autonomy-state.mjs pointer set --run <run-id> [--loop] | pointer clear | pointer read
//   node .riff/scripts/autonomy-state.mjs resolve-launch
// All subcommands accept --project-root <dir> (default: cwd).
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
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
 * Park a phase: write the no-merge marker (finishers.yaml) FIRST, then flip
 * run.json. A crash between the two writes leaves a pending finisher with no
 * parked status — safe (the guard still blocks the branch). The reverse order
 * would leave a parked branch with no marker — forbidden.
 *
 * `finisher`: { id?, type, phase, branch, waiting_on, artifact, created? }.
 * Missing id → next free F<N>. Re-parking the same phase+type updates the
 * existing pending entry instead of duplicating it.
 */
export function parkPhase({ projectRoot, runId, phaseId, finisher }) {
  const runDir = path.join(projectRoot, '.planning/autonomy', runId);
  const ledgerFile = path.join(runDir, 'finishers.yaml');

  // 1. No-merge marker first.
  let ledger = { run: runId, entries: [] };
  if (existsSync(ledgerFile)) {
    const parsed = parseFinishers(readFileSync(ledgerFile, 'utf8'));
    ledger = { run: parsed.run || runId, entries: [...parsed.entries] };
    for (const bad of parsed.malformed) {
      // malformed entries are rewritten as pending with a MALFORMED-* id:
      // fail closed (they keep blocking merges) and no evidence is destroyed
      ledger.entries.push({ ...bad.entry, id: bad.entry.id || `MALFORMED-L${bad.line}`, status: bad.entry.status || 'pending' });
    }
  }

  const existing = ledger.entries.find(
    (entry) => entry.status === 'pending' && entry.phase === finisher.phase && entry.type === finisher.type,
  );
  const created = finisher.created || new Date().toISOString().slice(0, 10);
  let written;
  if (existing) {
    Object.assign(existing, finisher, { id: existing.id, status: 'pending', created: existing.created || created });
    written = existing;
  } else {
    const nextId = finisher.id
      || `F${ledger.entries.reduce((max, entry) => {
        const match = /^F(\d+)$/.exec(entry.id || '');
        return match ? Math.max(max, Number(match[1])) : max;
      }, 0) + 1}`;
    written = { ...finisher, id: nextId, status: 'pending', created };
    ledger.entries.push(written);
  }
  atomicWrite(ledgerFile, serializeFinishers(ledger));

  // 2. Status flip second.
  const run = readRunJson(runDir);
  if (run && Array.isArray(run.phases)) {
    const phase = run.phases.find((entry) => entry.id === phaseId);
    if (phase) phase.status = 'parked';
    writeRunJson(runDir, run);
  }

  return written;
}

// ---------------------------------------------------------------------------
// Launch lock (anti-double-launch, shared by run and loop)
// ---------------------------------------------------------------------------

const LOCK_STALE_MS = 45 * 60 * 1000; // no heartbeat for 45 min = presumed dead

function lockFile(projectRoot) {
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
  const file = lockFile(projectRoot);
  if (!existsSync(file)) return { held: false };
  const data = readJson(file);
  let mtimeMs = 0;
  try {
    mtimeMs = statSync(file).mtimeMs;
  } catch {
    return { held: false };
  }
  const stale = !pidAlive(data?.pid) && Date.now() - mtimeMs > LOCK_STALE_MS;
  return { held: true, stale, owner: data || { corrupt: true }, mtimeMs };
}

/**
 * Check-and-set: creates the lock atomically (O_EXCL). If a live lock exists,
 * returns { acquired: false, holder } — the caller must RESUME the existing
 * run/loop, never start a parallel one. A lock whose owner is provably dead
 * (pid gone AND no mtime heartbeat for 45 min) is reclaimed.
 */
export function acquireLock(projectRoot, { runId, loop = false } = {}) {
  mkdirSync(path.join(projectRoot, '.planning/autonomy'), { recursive: true });
  const file = lockFile(projectRoot);
  const payload = `${JSON.stringify({ pid: process.pid, run: runId, loop, started: new Date().toISOString() }, null, 2)}\n`;

  const tryExclusive = () => {
    const fd = openSync(file, 'wx');
    try {
      writeFileSync(fd, payload);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };

  try {
    tryExclusive();
    return { acquired: true };
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }

  const status = lockStatus(projectRoot);
  if (status.held && !status.stale) {
    return { acquired: false, holder: status.owner };
  }
  // provably dead — reclaim
  try {
    unlinkSync(file);
  } catch {
    // someone else reclaimed first; fall through and retry once
  }
  try {
    tryExclusive();
    return { acquired: true, reclaimed: true, previous: status.owner };
  } catch {
    return { acquired: false, holder: readJson(file) };
  }
}

/** Heartbeat: bump the lock mtime at every phase status transition. */
export function touchLock(projectRoot) {
  const file = lockFile(projectRoot);
  const data = readJson(file);
  if (data) atomicWrite(file, `${JSON.stringify(data, null, 2)}\n`);
}

export function releaseLock(projectRoot) {
  try {
    unlinkSync(lockFile(projectRoot));
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

/**
 * What a `--autonomous` launch must do for this project:
 *   { action: 'resume', runId, loop, run }    — in-flight run, front-load stays locked
 *   { action: 'restart-run', runId, loop }    — loop in flight but run.json missing/corrupt:
 *                                               restart the SAME run-id fresh, no questions,
 *                                               never double-count runs_completed
 *   { action: 'new' }                         — nothing in flight
 */
export function resolveLaunch(projectRoot) {
  const pointer = readStatePointer(projectRoot);
  const loopState = readLoopJson(projectRoot);
  const loopRunning = loopState?.status === 'running';

  const candidates = [];
  if (pointer.runId) candidates.push(pointer.runId);

  for (const runId of candidates) {
    const run = readRunJson(path.join(projectRoot, '.planning/autonomy', runId));
    if (run && run.stage && run.stage !== 'done') {
      return { action: 'resume', runId, loop: pointer.loop || loopRunning, run };
    }
    if (loopRunning) {
      return { action: 'restart-run', runId, loop: true };
    }
    // pointer exists but the run is done or unparseable and no loop backs it:
    // stale pointer — treat as new launch, caller clears the pointer.
  }

  if (loopRunning) {
    // loop running but pointer lost (e.g. STATE.md rewritten): resume the loop
    return { action: 'restart-run', runId: null, loop: true };
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
  /\bgdpr\b|\bccpa\b|\bpii\b|privacy|consent|\bretention\b|erasure|right[-_ ]to[-_ ]be[-_ ]forgotten|anonymi[sz]|data[-_ ]?(deletion|export|subject)|delete[-_ ]?(account|user|data)|export[-_ ]?(data|user)|\bkyc\b|\baml\b|complian|regulat|\blegal\b|audit[-_ ]?(log|trail)/i,
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
        touchLock(projectRoot);
        return;
      }
      if (action === 'status') {
        process.stdout.write(`${JSON.stringify(lockStatus(projectRoot))}\n`);
        return;
      }
      fail('lock requires acquire | release | touch | status');
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
      fail('usage: autonomy-state <classify | park | lock | pointer | resolve-launch> [flags]');
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

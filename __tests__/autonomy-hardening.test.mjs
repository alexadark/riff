import { execFile, execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkBranch } from '../scripts/finisher-guard.mjs';
import {
  acquireLock,
  classifyPhase,
  clearStatePointer,
  lockStatus,
  parkPhase,
  readLoopJson,
  readRunJson,
  readStatePointer,
  releaseLock,
  resolveLaunch,
  touchLock,
  writeLoopJson,
  writeRunJson,
  writeStatePointer,
} from '../scripts/autonomy-state.mjs';
import { collectPendingFinishers, parseFinishers } from '../scripts/lib/finishers.mjs';

const execFileAsync = promisify(execFile);
const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const guardCli = path.join(scriptsDir, 'finisher-guard.mjs');
const stateCli = path.join(scriptsDir, 'autonomy-state.mjs');

/** Run the autonomy-state CLI as a real child process (for race tests). */
function stateCliAsync(args) {
  return execFileAsync('node', [stateCli, ...args, '--project-root', projectRoot])
    .then((result) => ({ code: 0, stdout: result.stdout }))
    .catch((error) => ({ code: error.code ?? error.status ?? 1, stdout: error.stdout || '' }));
}

let projectRoot;

beforeEach(() => {
  projectRoot = mkdtempSync(path.join(tmpdir(), 'riff-autonomy-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function writeLedger(runId, yaml) {
  const dir = path.join(projectRoot, '.planning/autonomy', runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'finishers.yaml'), yaml);
  return path.join(dir, 'finishers.yaml');
}

describe('finisher-guard', () => {
  it('refuses a branch referenced by a pending finisher', () => {
    writeLedger('2026-07-10-1200', [
      'run: 2026-07-10-1200',
      'finishers:',
      '  - id: F1',
      '    type: security',
      '    phase: 12-checkout-flow',
      '    branch: riff/phase-12-checkout-flow',
      '    waiting_on: "sign-off on Stripe webhook validation"',
      '    artifact: .planning/phases/12-checkout-flow/SECURITY.md',
      '    status: pending',
      '',
    ].join('\n'));

    const verdict = checkBranch(projectRoot, 'riff/phase-12-checkout-flow');
    expect(verdict.allowed).toBe(false);
    expect(verdict.blockers[0].id).toBe('F1');

    // CLI contract: non-zero exit + names the blocking finisher
    let exitCode = 0;
    let stdout = '';
    try {
      stdout = execFileSync('node', [guardCli, 'riff/phase-12-checkout-flow', '--project-root', projectRoot], { encoding: 'utf8' });
    } catch (error) {
      exitCode = error.status;
      stdout = error.stdout;
    }
    expect(exitCode).toBe(2);
    expect(stdout).toContain('MERGE REFUSED');
    expect(stdout).toContain('F1');
    expect(stdout).toContain('SECURITY.md');
  });

  it('allows the branch once the finisher is resolved', () => {
    writeLedger('2026-07-10-1200', [
      'run: 2026-07-10-1200',
      'finishers:',
      '  - id: F1',
      '    type: review',
      '    branch: riff/phase-9-emails',
      '    status: resolved',
      '',
    ].join('\n'));
    expect(checkBranch(projectRoot, 'riff/phase-9-emails').allowed).toBe(true);
  });

  it('fails closed on an unreadable finishers DIRECTORY too', () => {
    const dir = path.join(projectRoot, '.planning/autonomy/2026-07-10-1200/finishers');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, 'F-1-x-security.yaml'), 'run: r\nfinishers:\n  - id: F-1-x-security\n    status: resolved\n');
    chmodSync(dir, 0o000);
    try {
      const verdict = checkBranch(projectRoot, 'riff/phase-whatever');
      expect(verdict.allowed).toBe(false);
      expect(verdict.unreadable.length).toBeGreaterThan(0);
    } finally {
      chmodSync(dir, 0o755);
    }
  });

  it('a pending security/payment marker that LOST its branch blocks every branch', () => {
    writeLedger('2026-07-10-1200', [
      'run: 2026-07-10-1200',
      'finishers:',
      '  - id: F-9-pay-payment',
      '    type: payment',
      '    phase: 9-pay',
      '    status: pending',
      '',
    ].join('\n'));
    const verdict = checkBranch(projectRoot, 'riff/phase-anything');
    expect(verdict.allowed).toBe(false);
    expect(verdict.branchless).toHaveLength(1);
    // a branchless decision finisher is legitimately non-blocking
    writeLedger('2026-07-10-1201', [
      'run: 2026-07-10-1201',
      'finishers:',
      '  - id: F-0-none-decision',
      '    type: decision',
      '    status: pending',
      '',
    ].join('\n'));
    rmSync(path.join(projectRoot, '.planning/autonomy/2026-07-10-1200'), { recursive: true, force: true });
    expect(checkBranch(projectRoot, 'riff/phase-anything').allowed).toBe(true);
  });

  it('a BROKEN symlink at the autonomy root blocks merges instead of reading as absent', () => {
    mkdirSync(path.join(projectRoot, '.planning'), { recursive: true });
    symlinkSync(
      path.join(projectRoot, 'vanished-marker-store'), // target does not exist
      path.join(projectRoot, '.planning/autonomy'),
    );
    const verdict = checkBranch(projectRoot, 'riff/phase-sensitive');
    expect(verdict.allowed).toBe(false);
    expect(verdict.unreadable).toHaveLength(1);
  });

  it('a symlinked finishers directory is followed, not silently skipped', () => {
    const real = path.join(projectRoot, 'elsewhere-finishers');
    mkdirSync(real, { recursive: true });
    writeFileSync(path.join(real, 'F-2-auth-security.yaml'), [
      'run: 2026-07-10-1200',
      'finishers:',
      '  - id: F-2-auth-security',
      '    type: security',
      '    phase: 2-auth',
      '    branch: riff/phase-2-auth',
      '    status: pending',
      '',
    ].join('\n'));
    const runDir = path.join(projectRoot, '.planning/autonomy/2026-07-10-1200');
    mkdirSync(runDir, { recursive: true });
    symlinkSync(real, path.join(runDir, 'finishers'));
    expect(checkBranch(projectRoot, 'riff/phase-2-auth').allowed).toBe(false);
  });

  it('a malformed entry with NO branch blocks every branch (unattributable evidence)', () => {
    writeLedger('2026-07-10-1200', [
      'run: 2026-07-10-1200',
      'finishers:',
      '  - type: security', // no id, no status, no branch: damaged marker
      '    phase: 5-payments',
      '',
    ].join('\n'));
    const verdict = checkBranch(projectRoot, 'riff/phase-unrelated');
    expect(verdict.allowed).toBe(false);
    expect(verdict.suspectMalformed).toHaveLength(1);
  });

  it('fails closed on an UNREADABLE marker file: every branch is blocked', () => {
    const dir = path.join(projectRoot, '.planning/autonomy/2026-07-10-1200/finishers');
    mkdirSync(dir, { recursive: true });
    const marker = path.join(dir, 'F-7-payments-security.yaml');
    writeFileSync(marker, 'run: 2026-07-10-1200\nfinishers:\n  - id: F-7-payments-security\n    status: pending\n');
    chmodSync(marker, 0o000);
    try {
      const verdict = checkBranch(projectRoot, 'riff/phase-anything-else');
      expect(verdict.allowed).toBe(false);
      expect(verdict.unreadable).toHaveLength(1);
    } finally {
      chmodSync(marker, 0o644);
    }
  });

  it('fails closed on a malformed entry that mentions the branch', () => {
    writeLedger('2026-07-10-1200', [
      'run: 2026-07-10-1200',
      'finishers:',
      '  - type: security',
      '    branch: riff/phase-3-auth',
      '',
    ].join('\n'));
    const verdict = checkBranch(projectRoot, 'riff/phase-3-auth');
    expect(verdict.allowed).toBe(false);
    expect(verdict.suspectMalformed).toHaveLength(1);
  });
});

describe('parkPhase ordering', () => {
  const runId = '2026-07-10-1400';

  function seedRun() {
    const runDir = path.join(projectRoot, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    writeRunJson(runDir, {
      run: runId,
      stage: 'build',
      phases: [{ id: '12-checkout-flow', autonomy: 'hold', status: 'building', branch: 'riff/phase-12-checkout-flow' }],
    });
    return runDir;
  }

  it('writes the no-merge marker (its own file) before flipping run.json', () => {
    const runDir = seedRun();
    const written = parkPhase({
      projectRoot,
      runId,
      phaseId: '12-checkout-flow',
      finisher: {
        type: 'review',
        phase: '12-checkout-flow',
        branch: 'riff/phase-12-checkout-flow',
        waiting_on: 'human review',
        artifact: '.planning/phases/12-checkout-flow/DEBUG.md',
      },
    });
    expect(written.id).toBe('F-12-checkout-flow-review');
    const marker = parseFinishers(readFileSync(path.join(runDir, 'finishers', 'F-12-checkout-flow-review.yaml'), 'utf8'));
    expect(marker.run).toBe(runId);
    expect(marker.entries[0].status).toBe('pending');
    expect(readRunJson(runDir).phases[0].status).toBe('parked');
    expect(checkBranch(projectRoot, 'riff/phase-12-checkout-flow').allowed).toBe(false);
  });

  it('a crash between the two writes still leaves a valid no-merge marker', async () => {
    const runDir = seedRun();
    // simulate the crash: run.json write throws after the marker file landed
    const state = await import('../scripts/autonomy-state.mjs');
    const spy = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('simulated crash between marker write and status flip');
    });
    // the marker write serializes YAML (no JSON.stringify for these values),
    // so the FIRST JSON.stringify in parkPhase is the run.json write — the
    // mock throws exactly in the crash window between the two writes.
    expect(() => state.parkPhase({
      projectRoot,
      runId,
      phaseId: '12-checkout-flow',
      finisher: { type: 'review', phase: '12-checkout-flow', branch: 'riff/phase-12-checkout-flow' },
    })).toThrow('simulated crash');
    spy.mockRestore();

    // marker exists → the guard blocks even though run.json still says building
    const { pending } = collectPendingFinishers(projectRoot);
    expect(pending).toHaveLength(1);
    expect(readRunJson(runDir).phases[0].status).toBe('building');
    expect(checkBranch(projectRoot, 'riff/phase-12-checkout-flow').allowed).toBe(false);
  });

  it('re-parking the same phase+type rewrites the same file instead of duplicating', () => {
    const runDir = seedRun();
    const finisher = { type: 'review', phase: '12-checkout-flow', branch: 'riff/phase-12-checkout-flow' };
    parkPhase({ projectRoot, runId, phaseId: '12-checkout-flow', finisher });
    parkPhase({ projectRoot, runId, phaseId: '12-checkout-flow', finisher: { ...finisher, waiting_on: 'second attempt' } });
    const files = readdirSync(path.join(runDir, 'finishers')).filter((name) => name.endsWith('.yaml'));
    expect(files).toHaveLength(1);
    const { pending } = collectPendingFinishers(projectRoot);
    expect(pending).toHaveLength(1);
    expect(pending[0].waiting_on).toBe('second attempt');
  });

  it('CONCURRENCY: parallel parks from separate processes all keep their marker', async () => {
    const runDir = path.join(projectRoot, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    const phases = Array.from({ length: 6 }, (_, index) => `p${index}-slug`);
    writeRunJson(runDir, {
      run: runId,
      stage: 'build',
      phases: phases.map((id) => ({ id, autonomy: 'hold', status: 'building', branch: `riff/phase-${id}` })),
    });

    const results = await Promise.all(phases.map((id) => stateCliAsync([
      'park', '--run', runId, '--phase', id, '--type', 'security',
      '--branch', `riff/phase-${id}`, '--waiting', 'sign-off', '--artifact', 'x.md',
    ])));
    expect(results.every((result) => result.code === 0)).toBe(true);

    // the old single-ledger design lost markers here (last rename wins);
    // one file per finisher makes every marker survive by construction
    const { pending } = collectPendingFinishers(projectRoot);
    expect(pending).toHaveLength(6);
    for (const id of phases) {
      expect(checkBranch(projectRoot, `riff/phase-${id}`).allowed, id).toBe(false);
    }
    // and the run.json mutex means no status flip is clobbered either —
    // resume reads these, so losing them is not acceptable bookkeeping loss
    const statuses = readRunJson(runDir).phases.map((phase) => phase.status);
    expect(statuses).toEqual(['parked', 'parked', 'parked', 'parked', 'parked', 'parked']);
  }, 20000);

  it('legacy finishers.yaml ledgers are still read (never written)', () => {
    const runDir = seedRun();
    writeFileSync(path.join(runDir, 'finishers.yaml'), [
      `run: ${runId}`,
      'finishers:',
      '  - id: F1',
      '    type: security',
      '    phase: 3-auth',
      '    branch: riff/phase-3-auth',
      '    status: pending',
      '',
    ].join('\n'));
    parkPhase({
      projectRoot,
      runId,
      phaseId: '12-checkout-flow',
      finisher: { type: 'review', phase: '12-checkout-flow', branch: 'riff/phase-12-checkout-flow' },
    });
    const { pending } = collectPendingFinishers(projectRoot);
    expect(pending).toHaveLength(2); // legacy F1 + new per-file marker
    expect(checkBranch(projectRoot, 'riff/phase-3-auth').allowed).toBe(false);
    // the legacy ledger was not rewritten
    expect(readFileSync(path.join(runDir, 'finishers.yaml'), 'utf8')).toContain('id: F1');
  });
});

describe('launch lock + resume', () => {
  it('second launch resumes instead of starting a parallel run', () => {
    const runId = '2026-07-10-1500';
    const runDir = path.join(projectRoot, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    writeRunJson(runDir, { run: runId, stage: 'build', phases: [] });
    writeStatePointer(projectRoot, { runId, loop: false });

    const first = acquireLock(projectRoot, { runId });
    expect(first.acquired).toBe(true);

    // relaunch: lock held by a live pid (ours) → not acquired
    const second = acquireLock(projectRoot, { runId });
    expect(second.acquired).toBe(false);

    // and launch resolution says resume with locked front-load, no new questions
    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('resume');
    expect(launch.runId).toBe(runId);
  });

  it('loop resume with corrupt run.json restarts the same run-id fresh', () => {
    const runId = '2026-07-10-1600';
    const runDir = path.join(projectRoot, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, 'run.json'), '{ torn write');
    writeStatePointer(projectRoot, { runId, loop: true });
    writeLoopJson(projectRoot, { started: '2026-07-10', status: 'running', runs_completed: 3 });

    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('restart-run');
    expect(launch.runId).toBe(runId);
    expect(launch.loop).toBe(true);
  });

  it('pointer set/clear round-trips through STATE.md', () => {
    writeFileSync(path.join(projectRoot, 'STATE.md'), '# State - x\n\n## Active Phase\n\n- **Id**: -\n\n## Next Action\n\nnone\n');
    writeStatePointer(projectRoot, { runId: '2026-07-10-1700', loop: true });
    expect(readStatePointer(projectRoot)).toEqual({ runId: '2026-07-10-1700', loop: true });
    clearStatePointer(projectRoot);
    expect(readStatePointer(projectRoot)).toEqual({ runId: null, loop: false });
    // untouched sections survive
    const text = readFileSync(path.join(projectRoot, 'STATE.md'), 'utf8');
    expect(text).toContain('## Next Action');
    expect(text).toContain('## Active Phase');
  });
});

describe('lock concurrency', () => {
  const lockDir = () => path.join(projectRoot, '.planning/autonomy/lock');
  const ownerFile = () => path.join(lockDir(), 'owner.json');

  function seedStaleLock(token) {
    mkdirSync(lockDir(), { recursive: true });
    writeFileSync(ownerFile(), `${JSON.stringify({ token, pid: 9999999, started: '2026-07-09' })}\n`);
    const past = new Date(Date.now() - 4 * 60 * 60 * 1000); // beyond the 180-min window
    utimesSync(ownerFile(), past, past);
  }

  it('CONCURRENCY: parallel acquires on a free lock — exactly one winner', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => stateCliAsync([
      'lock', 'acquire', '--run', `2026-07-10-160${index}`,
    ])));
    const winners = results.filter((result) => result.code === 0);
    const losers = results.filter((result) => result.code === 4);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(5);
  }, 20000);

  it('CONCURRENCY: parallel reclaims of a stale lock — exactly one winner, never two', async () => {
    seedStaleLock('dead-run');
    const results = await Promise.all(Array.from({ length: 6 }, (_, index) => stateCliAsync([
      'lock', 'acquire', '--run', `2026-07-10-170${index}`,
    ])));
    // the old design unlinked unconditionally: two relaunches could both
    // recreate and both believe they own the lock
    expect(results.filter((result) => result.code === 0)).toHaveLength(1);
    expect(results.filter((result) => result.code === 4)).toHaveLength(5);
    // and the surviving lock belongs to the single winner
    const owner = JSON.parse(readFileSync(ownerFile(), 'utf8'));
    expect(owner.token).not.toBe('dead-run');
  }, 20000);

  it('staleness follows the heartbeat, not the (dead) CLI helper pid', () => {
    seedStaleLock('run-A');
    expect(lockStatus(projectRoot).stale).toBe(true);
    // a phase status transition heartbeats automatically through writeRunJson
    const runDir = path.join(projectRoot, '.planning/autonomy', 'run-A');
    mkdirSync(runDir, { recursive: true });
    writeRunJson(runDir, { run: 'run-A', stage: 'build', phases: [] });
    expect(lockStatus(projectRoot).stale).toBe(false);
  });

  it('fencing: heartbeat against someone else\'s token reports the loss', () => {
    seedStaleLock('run-B');
    expect(touchLock(projectRoot, { runId: 'run-B' }).ok).toBe(true);
    const stolen = touchLock(projectRoot, { runId: 'run-INTRUDER' });
    expect(stolen.ok).toBe(false);
    expect(stolen.reason).toBe('token-mismatch');
    // CLI contract: exit 5 tells the agent to stop, park, never merge
    let exitCode = 0;
    try {
      execFileSync('node', [stateCli, 'lock', 'touch', '--run', 'run-INTRUDER', '--project-root', projectRoot], { encoding: 'utf8' });
    } catch (error) {
      exitCode = error.status;
    }
    expect(exitCode).toBe(5);
  });

  it('acquire without a run token is refused (an anonymous lock cannot be fenced)', async () => {
    expect(acquireLock(projectRoot, {}).acquired).toBe(false);
    expect(acquireLock(projectRoot, {}).reason).toBe('run-id-required');
    expect(existsSync(lockDir())).toBe(false);
    // CLI: missing --run fails; `--run --loop` must not swallow --loop as the id
    const bare = await stateCliAsync(['lock', 'acquire']);
    expect(bare.code).not.toBe(0);
    const swallowed = await stateCliAsync(['lock', 'acquire', '--run', '--loop']);
    expect(swallowed.code).not.toBe(0);
    expect(existsSync(lockDir())).toBe(false);
  });

  it('release refuses an ownerless/corrupt lock without an explicit force', async () => {
    const { releaseLock } = await import('../scripts/autonomy-state.mjs');
    mkdirSync(lockDir(), { recursive: true });
    writeFileSync(ownerFile(), '{ not json');
    const refused = releaseLock(projectRoot, { runId: 'run-X' });
    expect(refused.released).toBe(false);
    expect(refused.reason).toBe('owner-unreadable');
    expect(existsSync(lockDir())).toBe(true);
    expect(releaseLock(projectRoot, { force: true }).released).toBe(true);
    expect(existsSync(lockDir())).toBe(false);
  });

  it('release fences the legacy lock.json by its recorded run id', async () => {
    const { releaseLock } = await import('../scripts/autonomy-state.mjs');
    const legacy = path.join(projectRoot, '.planning/autonomy/lock.json');
    mkdirSync(path.dirname(legacy), { recursive: true });
    writeFileSync(legacy, `${JSON.stringify({ pid: process.pid, run: 'legacy-run' })}\n`);
    const refused = releaseLock(projectRoot, { runId: 'someone-else' });
    expect(refused.released).toBe(false);
    expect(refused.reason).toBe('legacy-held');
    expect(existsSync(legacy)).toBe(true);
    expect(releaseLock(projectRoot, { runId: 'legacy-run' }).released).toBe(true);
    expect(existsSync(legacy)).toBe(false);
  });

  it('day-old reclaim/release graveyards are swept at acquire', () => {
    const debris = path.join(projectRoot, '.planning/autonomy/lock.reclaimed-123-456');
    mkdirSync(debris, { recursive: true });
    const past = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    utimesSync(debris, past, past);
    expect(acquireLock(projectRoot, { runId: 'run-D' }).acquired).toBe(true);
    expect(existsSync(debris)).toBe(false);
  });

  it('release is fenced: another run cannot delete the lock on its way out', async () => {
    const { releaseLock } = await import('../scripts/autonomy-state.mjs');
    expect(acquireLock(projectRoot, { runId: 'run-CURRENT' }).acquired).toBe(true);
    // an old session finishing late tries to release with its own (stale) run id
    const refused = releaseLock(projectRoot, { runId: 'run-OLD' });
    expect(refused.released).toBe(false);
    expect(refused.reason).toBe('token-mismatch');
    expect(existsSync(lockDir())).toBe(true);
    // owned lock without a run id is refused too (fail closed)
    expect(releaseLock(projectRoot).released).toBe(false);
    // the rightful owner releases fine
    expect(releaseLock(projectRoot, { runId: 'run-CURRENT' }).released).toBe(true);
    expect(existsSync(lockDir())).toBe(false);
    // CLI contract: exit 6 on a refused release
    acquireLock(projectRoot, { runId: 'run-CURRENT' });
    const result = await stateCliAsync(['lock', 'release', '--run', 'run-OLD']);
    expect(result.code).toBe(6);
    expect(existsSync(lockDir())).toBe(true);
  });

  it('a VANISHED lock while claiming ownership is a fencing failure, not a pass', async () => {
    // no lock at all + --run = the caller thinks it holds one: exit 5
    const touch = await stateCliAsync(['lock', 'touch', '--run', 'run-GONE']);
    expect(touch.code).toBe(5);
    // bare probe without --run stays exit 0 (nothing claimed, nothing lost)
    const probe = await stateCliAsync(['lock', 'touch']);
    expect(probe.code).toBe(0);
    // phase-status with a vanished lock: state still written, but exit 5
    const runId = '2026-07-10-1050';
    const runDir = path.join(projectRoot, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    writeRunJson(runDir, { run: runId, stage: 'build', phases: [{ id: '3-ui', status: 'building' }] });
    releaseLock(projectRoot, { force: true }); // ensure nothing is held
    const result = await stateCliAsync(['phase-status', '--run', runId, '--phase', '3-ui', '--status', 'done']);
    expect(result.code).toBe(5);
    expect(readRunJson(runDir).phases[0].status).toBe('done');
  });

  it('mutex timeout refuses the write instead of writing unlocked', async () => {
    const runId = '2026-07-10-1060';
    const runDir = path.join(projectRoot, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    writeRunJson(runDir, { run: runId, stage: 'build', phases: [{ id: '4-api', status: 'building' }] });
    mkdirSync(path.join(runDir, '.run.json.lock')); // a live (fresh-mtime) holder
    const result = await execFileAsync('node', [
      stateCli, 'phase-status', '--run', runId, '--phase', '4-api', '--status', 'done',
      '--project-root', projectRoot,
    ], { env: { ...process.env, RIFF_MUTEX_DEADLINE_MS: '400', RIFF_MUTEX_STALE_MS: '60000' } })
      .then(() => ({ code: 0 }))
      .catch((error) => ({ code: error.code ?? 1 }));
    expect(result.code).not.toBe(0);
    // fail closed: the transition did NOT land unlocked
    expect(readRunJson(runDir).phases[0].status).toBe('building');
  }, 15000);

  it('a live legacy lock.json is honored; a dead one is migrated', () => {
    const legacy = path.join(projectRoot, '.planning/autonomy/lock.json');
    mkdirSync(path.dirname(legacy), { recursive: true });
    // live: our own pid
    writeFileSync(legacy, `${JSON.stringify({ pid: process.pid, run: 'legacy-live' })}\n`);
    expect(acquireLock(projectRoot, { runId: 'run-C' }).acquired).toBe(false);
    // dead: gone pid + old mtime
    writeFileSync(legacy, `${JSON.stringify({ pid: 9999999, run: 'legacy-dead' })}\n`);
    const past = new Date(Date.now() - 4 * 60 * 60 * 1000);
    utimesSync(legacy, past, past);
    expect(acquireLock(projectRoot, { runId: 'run-C' }).acquired).toBe(true);
    expect(existsSync(legacy)).toBe(false);
  });
});

describe('loop resume reconciliation', () => {
  function seedRunDir(runId, runJson) {
    const runDir = path.join(projectRoot, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    if (typeof runJson === 'string') {
      writeFileSync(path.join(runDir, 'run.json'), runJson);
    } else if (runJson) {
      writeRunJson(runDir, runJson);
    }
    return runDir;
  }

  it('pointer and loop.json disagree: loop.current_run wins', () => {
    seedRunDir('2026-07-10-0100', { run: '2026-07-10-0100', stage: 'done', phases: [] });
    seedRunDir('2026-07-10-0200', { run: '2026-07-10-0200', stage: 'build', phases: [] });
    writeStatePointer(projectRoot, { runId: '2026-07-10-0100', loop: true }); // stale hint
    writeLoopJson(projectRoot, { status: 'running', current_run: '2026-07-10-0200', runs_completed: 1 });
    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('resume');
    expect(launch.runId).toBe('2026-07-10-0200');
  });

  it('current_run with corrupt run.json restarts the SAME id, never a null one', () => {
    seedRunDir('2026-07-10-0300', '{ torn write');
    writeLoopJson(projectRoot, { status: 'running', current_run: '2026-07-10-0300', runs_completed: 0 });
    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('restart-run');
    expect(launch.runId).toBe('2026-07-10-0300');
  });

  it('current_run already done (crash before next run start) → continue-loop, never restart', () => {
    seedRunDir('2026-07-10-0400', { run: '2026-07-10-0400', stage: 'done', phases: [] });
    writeLoopJson(projectRoot, { status: 'running', current_run: '2026-07-10-0400', runs_completed: 2 });
    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('continue-loop');
    expect(launch.completedRun).toBe('2026-07-10-0400');
  });

  it('legacy loop.json without current_run: single non-terminal run dir is found by the scan', () => {
    seedRunDir('2026-07-10-0500', { run: '2026-07-10-0500', stage: 'build', phases: [] });
    writeLoopJson(projectRoot, { status: 'running', runs_completed: 0 });
    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('resume');
    expect(launch.runId).toBe('2026-07-10-0500');
  });

  it('nothing verifiable on disk: continue-loop, no restart of a null run', () => {
    writeLoopJson(projectRoot, { status: 'running', runs_completed: 0 });
    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('continue-loop');
    expect(launch.action).not.toBe('restart-run');
  });

  it('ambiguity (two non-terminal run dirs) halts the loop instead of piling on more work', () => {
    seedRunDir('2026-07-10-0600', { run: '2026-07-10-0600', stage: 'build', phases: [] });
    seedRunDir('2026-07-10-0700', { run: '2026-07-10-0700', stage: 'build', phases: [] });
    writeLoopJson(projectRoot, { status: 'running', runs_completed: 0 });
    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('halt-ambiguous');
    expect(launch.candidates).toEqual(['2026-07-10-0600', '2026-07-10-0700']);
  });

  it('a corrupt current_run beside a LIVE run halts instead of restarting alongside it', () => {
    seedRunDir('2026-07-10-0430', '{ torn write');
    seedRunDir('2026-07-10-0440', { run: '2026-07-10-0440', stage: 'build', phases: [] });
    writeLoopJson(projectRoot, { status: 'running', current_run: '2026-07-10-0430', runs_completed: 0 });
    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('halt-ambiguous');
    expect(launch.candidates).toContain('2026-07-10-0430');
    expect(launch.candidates).toContain('2026-07-10-0440');
  });

  it('a completed current_run never hides a live run: the live one is resumed', () => {
    seedRunDir('2026-07-10-0410', { run: '2026-07-10-0410', stage: 'done', phases: [] });
    seedRunDir('2026-07-10-0420', { run: '2026-07-10-0420', stage: 'build', phases: [] });
    writeLoopJson(projectRoot, { status: 'running', current_run: '2026-07-10-0410', runs_completed: 1 });
    const launch = resolveLaunch(projectRoot);
    expect(launch.action).toBe('resume');
    expect(launch.runId).toBe('2026-07-10-0420');
    expect(launch.completedRun).toBe('2026-07-10-0410'); // still reported for counting
  });

  it('CONCURRENCY: parallel complete-runs all count (loop.json mutex)', async () => {
    writeLoopJson(projectRoot, { status: 'running', runs_completed: 0 });
    const runs = Array.from({ length: 10 }, (_, index) => `run-${index}`);
    const results = await Promise.all(runs.map((id) => stateCliAsync(['loop', 'complete-run', '--run', id])));
    expect(results.every((result) => result.code === 0)).toBe(true);
    const loopState = readLoopJson(projectRoot);
    expect(loopState.runs_completed).toBe(10);
    expect([...loopState.completed_runs].sort()).toEqual([...runs].sort());
  }, 30000);

  it('runs_completed stays exact when an OLD completion is replayed out of order', async () => {
    const { recordRunCompleted } = await import('../scripts/autonomy-state.mjs');
    writeLoopJson(projectRoot, { status: 'running', runs_completed: 0 });
    expect(recordRunCompleted(projectRoot, 'run-A').counted).toBe(true);
    expect(recordRunCompleted(projectRoot, 'run-B').counted).toBe(true);
    // crash-resume replays run-A's completion AFTER run-B already counted
    const replay = recordRunCompleted(projectRoot, 'run-A');
    expect(replay).toMatchObject({ counted: false, reason: 'already-counted' });
    expect(readLoopJson(projectRoot).runs_completed).toBe(2);
  });

  it('runs_completed counts exactly once per completed run', async () => {
    const { recordRunCompleted } = await import('../scripts/autonomy-state.mjs');
    writeLoopJson(projectRoot, { status: 'running', current_run: '2026-07-10-0800', runs_completed: 3 });
    const first = recordRunCompleted(projectRoot, '2026-07-10-0800');
    expect(first).toMatchObject({ counted: true, runs_completed: 4 });
    // crash-then-resume around REPORT.md delivery re-calls it: idempotent
    const second = recordRunCompleted(projectRoot, '2026-07-10-0800');
    expect(second).toMatchObject({ counted: false, reason: 'already-counted' });
    const loopState = readLoopJson(projectRoot);
    expect(loopState.runs_completed).toBe(4);
    expect(loopState.current_run).toBe(null);
    expect(loopState.last_completed_run).toBe('2026-07-10-0800');
  });

  it('phase-status CLI writes the transition and heartbeats in one call', async () => {
    const runId = '2026-07-10-0900';
    const runDir = path.join(projectRoot, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    writeRunJson(runDir, { run: runId, stage: 'build', phases: [{ id: '5-emails', status: 'building' }] });
    acquireLock(projectRoot, { runId });
    const result = await stateCliAsync(['phase-status', '--run', runId, '--phase', '5-emails', '--status', 'merged']);
    expect(result.code).toBe(0);
    expect(readRunJson(runDir).phases[0].status).toBe('merged');
    expect(lockStatus(projectRoot).stale).toBe(false);
  });

  it('phase-status CLI exits 5 when the lock belongs to another run', async () => {
    const runId = '2026-07-10-1000';
    const runDir = path.join(projectRoot, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    writeRunJson(runDir, { run: runId, stage: 'build', phases: [{ id: '6-ui', status: 'building' }] });
    acquireLock(projectRoot, { runId: 'ANOTHER-RUN' });
    const result = await stateCliAsync(['phase-status', '--run', runId, '--phase', '6-ui', '--status', 'done']);
    expect(result.code).toBe(5);
    // the state write itself still lands — disk must reflect reality
    expect(readRunJson(runDir).phases[0].status).toBe('done');
  });
});

describe('autonomy boundary classification', () => {
  it('privacy phase classifies as hold', () => {
    const verdict = classifyPhase({
      tags: [],
      paths: ['app/routes/settings.privacy.tsx'],
      text: 'Let users export their data and delete their account (GDPR)',
    });
    expect(verdict.autonomy).toBe('hold');
  });

  it('refund phase classifies as hold via title alone', () => {
    expect(classifyPhase({ text: 'Self-serve refunds for annual plans' }).autonomy).toBe('hold');
  });

  it('provider name in a path classifies as hold', () => {
    expect(classifyPhase({ paths: ['app/server/lemonsqueezy-webhook.ts'] }).autonomy).toBe('hold');
  });

  it('expanded tags classify as hold', () => {
    for (const tag of ['pii', 'gdpr', 'data-deletion', 'consent', 'retention', 'legal', 'audit', 'kyc', 'aml', 'finance', 'invoices', 'refunds', 'credits', 'subscriptions', 'entitlements']) {
      expect(classifyPhase({ tags: [tag] }).autonomy, tag).toBe('hold');
    }
  });

  it('a plain UI phase stays safe', () => {
    const verdict = classifyPhase({
      tags: ['frontend'],
      paths: ['app/components/EmptyState.tsx'],
      text: 'Polish the dashboard empty state illustration',
    });
    expect(verdict.autonomy).toBe('safe');
  });

  it('DSAR / DPA / cookie / personal-data phrasing classifies as hold', () => {
    for (const text of [
      'Build DSAR request portal',
      'Cookie consent banner',
      'Sign the DPA with the vendor',
      'Data processing agreement page',
      'Personal data inventory screen',
      'Analytics opt-out toggle',
      'Right to be forgotten flow',
    ]) {
      expect(classifyPhase({ text }).autonomy, text).toBe('hold');
    }
  });

  it('privacy surface in a path alone classifies as hold', () => {
    expect(classifyPhase({ paths: ['app/routes/dsar.tsx'] }).autonomy).toBe('hold');
    expect(classifyPhase({ paths: ['app/lib/cookies.server.ts'] }).autonomy).toBe('hold');
  });

  it('tags run through the sensitive patterns, not just the exact hold set', () => {
    for (const tag of ['cookies', 'analytics-opt-out', 'dsar', 'personal-data', 'session-handling', 'stripe-webhooks']) {
      expect(classifyPhase({ tags: [tag] }).autonomy, tag).toBe('hold');
    }
    expect(classifyPhase({ tags: ['frontend', 'polish'] }).autonomy).toBe('safe');
  });

  it('access-control and compliance-framework phrasing classifies as hold', () => {
    for (const text of [
      'RBAC roles and permissions screen',
      'SOC 2 evidence collection page',
      'HIPAA-compliant document storage',
      'Encrypt exported reports at rest',
      'Data portability request flow',
      'Pricing page revamp',
      'ISO 27001 asset register',
    ]) {
      expect(classifyPhase({ text }).autonomy, text).toBe('hold');
    }
  });
});

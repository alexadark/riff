import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkBranch } from '../scripts/finisher-guard.mjs';
import {
  acquireLock,
  classifyPhase,
  clearStatePointer,
  parkPhase,
  readRunJson,
  readStatePointer,
  resolveLaunch,
  writeLoopJson,
  writeRunJson,
  writeStatePointer,
} from '../scripts/autonomy-state.mjs';
import { parseFinishers } from '../scripts/lib/finishers.mjs';

const scriptsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../scripts');
const guardCli = path.join(scriptsDir, 'finisher-guard.mjs');

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

  it('writes the no-merge marker before flipping run.json', () => {
    const runDir = seedRun();
    parkPhase({
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
    const ledger = parseFinishers(readFileSync(path.join(runDir, 'finishers.yaml'), 'utf8'));
    expect(ledger.entries[0].status).toBe('pending');
    expect(readRunJson(runDir).phases[0].status).toBe('parked');
    expect(checkBranch(projectRoot, 'riff/phase-12-checkout-flow').allowed).toBe(false);
  });

  it('a crash between the two writes still leaves a valid no-merge marker', async () => {
    const runDir = seedRun();
    // simulate the crash: run.json write throws after finishers.yaml landed
    const state = await import('../scripts/autonomy-state.mjs');
    const spy = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw new Error('simulated crash between marker write and status flip');
    });
    // first stringify call inside parkPhase happens in writeRunJson? No —
    // marker write serializes YAML, not JSON. The FIRST JSON.stringify in
    // parkPhase is the run.json write, so this throws exactly in the window.
    expect(() => state.parkPhase({
      projectRoot,
      runId,
      phaseId: '12-checkout-flow',
      finisher: { type: 'review', phase: '12-checkout-flow', branch: 'riff/phase-12-checkout-flow' },
    })).toThrow('simulated crash');
    spy.mockRestore();

    // marker exists → the guard blocks even though run.json still says building
    const ledger = parseFinishers(readFileSync(path.join(runDir, 'finishers.yaml'), 'utf8'));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].status).toBe('pending');
    expect(readRunJson(runDir).phases[0].status).toBe('building');
    expect(checkBranch(projectRoot, 'riff/phase-12-checkout-flow').allowed).toBe(false);
  });

  it('re-parking the same phase+type updates instead of duplicating', () => {
    const runDir = seedRun();
    const finisher = { type: 'review', phase: '12-checkout-flow', branch: 'riff/phase-12-checkout-flow' };
    parkPhase({ projectRoot, runId, phaseId: '12-checkout-flow', finisher });
    parkPhase({ projectRoot, runId, phaseId: '12-checkout-flow', finisher: { ...finisher, waiting_on: 'second attempt' } });
    const ledger = parseFinishers(readFileSync(path.join(runDir, 'finishers.yaml'), 'utf8'));
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0].waiting_on).toBe('second attempt');
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
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { runAutonomousWave as runNativeAutonomousWave } from '../scripts/riff-wave.mjs';
import { confirmationTiming, requiresConfirmation } from '../scripts/lib/roadmap-workflow.mjs';

const frameworkRoot = path.resolve(import.meta.dirname, '..');
const fixtures = [];
function semanticPass({ phase, provider }) { return { route: { provider, adapter: provider === 'claude' ? 'agents/claude.yaml#native_roles.security-reviewer.variants.fixed' : 'agents/codex/security-reviewer.toml', model: provider === 'claude' ? 'opus' : 'gpt-5.6-sol', effort: 'xhigh', semanticRole: 'security-reviewer', routeClass: 'fixed' }, stdout: `---\nphase: ${phase}\ngenerated_at: 2026-01-01T00:00:00Z\nverdict: PASS\n---\n## Verdict\nPASS\n## Resolved Findings\nNone.\n## Notes\nReview completed.` }; }
function runAutonomousWave(options, dependencies = {}) { return runNativeAutonomousWave(options, { semanticDispatch: semanticPass, ...dependencies }); }
function evidence(scope = 'browser confirmation screen') { return `Checked: ${scope}; Observed: visible success result with order details; Expected: visible success result with the expected details`; }
function debuggerReport({ phase, run, status = 'DIAGNOSED', allowedPaths = ['src/fixed.mjs'] }) {
  return `## Status\n${status}\n## Identity\n${JSON.stringify({ intensity: 'high', phase, run })}\n## Failure Classification\nRetryable pre-promotion failure.\n## Hypotheses\nThe focused check is failing.\n## Evidence\nSupplied artifacts were inspected.\n## Root Cause\n${status === 'DIAGNOSED' ? 'Bounded implementation defect.' : 'Unresolved'}\n## Fix Assignment\n${JSON.stringify({ allowed_paths: allowedPaths, acceptance_criteria: ['The focused behavior succeeds.'], checks: ['npm test -- --runInBand'] })}\n## Validation\nRun the focused check.\n## Unresolved Risk\nNone.\n`;
}
function debuggerResponse({ phase, run, provider = 'codex', status = 'DIAGNOSED', allowedPaths } = {}) {
  return { route: { provider, adapter: provider === 'claude' ? 'agents/claude.yaml#native_roles.debugger.variants.fixed' : 'agents/codex/debugger.toml', model: provider === 'claude' ? 'opus' : 'gpt-5.6-sol', effort: 'xhigh', semanticRole: 'debugger', routeClass: 'fixed' }, stdout: debuggerReport({ phase, run, status, allowedPaths }) };
}

function phase(id, title, { dependsOn = [], mode = 'AFK', tags = [], execution = '' } = {}) {
  return `  - id: ${id}\n    slug: ${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\n    title: ${title}\n    status: todo\n    priority: P1\n    mode: ${mode}\n    tags: [${tags.join(', ')}]\n    depends_on: [${dependsOn.join(', ')}]\n    goal: Deliver ${title}.\n    tasks:\n      - Implement ${title}.\n${execution}`;
}

function fixture(roadmapText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-wave-test-'));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, '.planning', 'phases'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ROADMAP.yaml'), `name: Test\nphases:\n${roadmapText}`);
  fs.symlinkSync(frameworkRoot, path.join(root, '.riff'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'RIFF Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'riff-test@example.invalid'], { cwd: root });
  execFileSync('git', ['add', 'ROADMAP.yaml'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

function setRecoveryCap(projectRoot, cap, provider = 'codex') {
  fs.writeFileSync(path.join(projectRoot, '.planning', 'profile.yaml'), `runtime:\n  provider: ${provider}\nautonomy:\n  debug_cycle_cap: ${cap}\n`);
}

function seedCompletedWaveForResume(projectRoot, run, changedPaths = []) {
  const roadmap = path.join(projectRoot, 'ROADMAP.yaml');
  const waveRoot = path.join(projectRoot, '.planning', 'riff-wave');
  const nextRoot = path.join(projectRoot, '.planning', 'riff-next');
  fs.writeFileSync(roadmap, fs.readFileSync(roadmap, 'utf8').replace('status: todo', 'status: done'));
  fs.mkdirSync(waveRoot, { recursive: true });
  fs.mkdirSync(nextRoot, { recursive: true });
  const attempts = changedPaths.length ? [{ attempt: 1, native_phase: `1-security-resume--${run.toLowerCase()}-a1`, recovery_cycle: 0, status: 'completed' }] : [];
  if (attempts.length) fs.writeFileSync(path.join(nextRoot, `${attempts[0].native_phase}.worker-delta.json`), `${JSON.stringify({ changed: changedPaths })}\n`);
  const state = {
    schema_version: 1, run, state: 'running', mode: 'loop', provider_override: null, selected_provider: 'codex',
    requested_phase_ids: [], max_phases: null, max_runs: null, waves: [],
    phases: attempts.length ? [{ id: '1', slug: 'security-resume', title: 'Security Resume', status: 'completed', attempts }] : [],
    current: null, stop_reason: null, started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(waveRoot, `${run}.json`), `${JSON.stringify(state)}\n`);
  fs.writeFileSync(path.join(waveRoot, 'active.json'), `${JSON.stringify({ run })}\n`);
  return waveRoot;
}

function completeNext(projectRoot, calls) {
  return ({ phase: nativePhase, task }) => {
    calls.push({ nativePhase, task });
    const file = path.join(projectRoot, '.planning', 'riff-next', `${nativePhase}.json`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ state: 'completed', previous_state: 'post_review_mechanics_passed', updated_at: new Date().toISOString() })}\n`);
    return { status: 0, signal: null };
  };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('RIFF autonomous single-project waves', () => {
  test('forwards a roadmap direct execution contract and binds it to wave state', () => {
    const execution = `    execution:\n      mode: direct\n      tasks:\n        - title: Update widget behavior\n          owned_paths: [src/widget.mjs]\n          outcome: Update src/widget.mjs so the widget returns the requested normalized value.\n        - title: Cover widget behavior\n          owned_paths: [src/widget.test.mjs]\n          outcome: Add focused coverage in src/widget.test.mjs for the requested widget behavior.\n      waves:\n        - [1]\n        - [2]\n      smoke:\n        - argv: [node, --test, src/widget.test.mjs]\n          expect: { exit_code: 0 }\n        - argv: [npm, test]\n          expect: { exit_code: 0 }\n`;
    const root = fixture(phase(1, 'Direct Widget', { execution }));
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: 'W-direct-widget' }, {
      invokeNext: ({ phase: nativePhase, directExecution }) => {
        calls.push(directExecution);
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'completed', previous_state: 'post_review_mechanics_passed', updated_at: new Date().toISOString() })}\n`);
        return { status: 0, signal: null };
      },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ mode: 'direct', waves: [[1], [2]] });
    expect(state.phases[0]).toMatchObject({ execution_mode: 'direct', status: 'completed' });
    expect(state.phases[0].execution_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  test('keeps security-only implementation autonomous but honors real HITL boundaries', () => {
    const base = { confirmationRequired: false, providerMode: 'production', hitlReason: '', tasks: [], goal: '', mode: ['HITL'] };
    expect(requiresConfirmation({ ...base, title: 'Security hardening', tags: ['security'] })).toBe(false);
    expect(requiresConfirmation({ ...base, title: 'Harden implementation', tags: ['security_critical'] })).toBe(false);
    expect(requiresConfirmation({ ...base, title: 'Real payment checkout', tags: [] })).toBe(true);
    expect(requiresConfirmation({ ...base, title: 'Irreversible database migration', tags: [] })).toBe(true);
    expect(requiresConfirmation({ ...base, title: 'Production DNS cutover', tags: [] })).toBe(true);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Delete all production customer records', tags: [] })).toBe(true);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Deploy application to staging', tags: [] })).toBe(true);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Publish the release', tags: [] })).toBe(true);
    expect(requiresConfirmation({ ...base, title: 'Visual acceptance', tags: ['visual-verification'] })).toBe(true);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Implement OAuth callback security', tags: ['auth'] })).toBe(false);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Harden SSO token validation', tags: ['security_critical'] })).toBe(false);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Add MFA recovery unit tests', tags: ['auth'] })).toBe(false);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Publish release notes fixture for unit tests', tags: ['security'] })).toBe(false);
    expect(confirmationTiming({ ...base, title: 'Visual acceptance', tags: ['visual-verification'] })).toBe('after');
    expect(confirmationTiming({ ...base, title: 'Production DNS cutover', tags: [] })).toBe('before');
    expect(confirmationTiming({ ...base, title: 'Security hardening', tags: ['security'] })).toBe('none');
    expect(confirmationTiming({ ...base, confirmationRequired: true, title: 'Visual acceptance', tags: ['visual-verification'] })).toBe('before');
    expect(confirmationTiming({ ...base, title: 'Implement auth backend validation', tags: ['auth', 'backend'] })).toBe('none');
    expect(confirmationTiming({ ...base, title: 'Verify auth screen', tags: ['auth', 'visual-verification'] })).toBe('after');
    expect(confirmationTiming({ ...base, title: 'Promote auth service', tags: ['auth', 'promotion'] })).toBe('before');
  });

  test('runs visual verification work before pausing for its human check', () => {
    const root = fixture([
      phase(1, 'Foundation'),
      phase(2, 'Security Hardening', { dependsOn: [1], mode: 'HITL', tags: ['security'] }),
      phase(3, 'Visual Acceptance', { dependsOn: [2], mode: 'HITL', tags: ['visual-verification'] }),
    ].join(''));
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-loop-test' }, { invokeNext: completeNext(root, calls) });
    expect(calls.map((call) => call.task)).toEqual(expect.arrayContaining(['Deliver Foundation. Complete these phase tasks: Implement Foundation.', 'Deliver Security Hardening. Complete these phase tasks: Implement Security Hardening.', 'Deliver Visual Acceptance. Complete these phase tasks: Implement Visual Acceptance.']));
    expect(state.state).toBe('awaiting_human');
    expect(state.stop_reason).toBe('confirmation_required:3');
    expect(state.final_security).toBeUndefined();
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/W-loop-test.security.json'))).toBe(false);
    expect(state.waves.map((wave) => wave.phase_ids)).toEqual([['1'], ['2'], ['3']]);
    const roadmap = fs.readFileSync(path.join(root, 'ROADMAP.yaml'), 'utf8');
    expect(roadmap.match(/status: done/g)).toHaveLength(2);
    expect(roadmap).toContain('status: in-progress');
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/active.json'))).toBe(true);
  });

  test('resumes a pre-promotion failed phase with a new native attempt', () => {
    const root = fixture(phase(1, 'Retryable Work'));
    const first = runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: 'W-resume-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'failed', previous_state: 'controller_passed' })}\n`);
        return { status: 1, signal: null };
      },
    });
    expect(first.state).toBe('blocked');
    expect(first.stop_reason).toBe('phase_failed_safe_to_resume');
    const calls = [];
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-resume-test', requestedIds: [] }, { invokeNext: completeNext(root, calls) });
    expect(resumed.state).toBe('completed');
    expect(resumed.phases[0].attempts).toHaveLength(2);
    expect(resumed.phases[0].attempts[0].native_phase).not.toBe(resumed.phases[0].attempts[1].native_phase);
    expect(calls).toHaveLength(1);
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/active.json'))).toBe(false);
  });

  test('reconciles a completed native attempt before treating a resumed roadmap as dry', () => {
    const root = fixture(phase(1, 'Split Brain Completion'));
    const roadmapPath = path.join(root, 'ROADMAP.yaml');
    fs.writeFileSync(roadmapPath, fs.readFileSync(roadmapPath, 'utf8').replace('status: todo', 'status: done'));
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src/value.mjs'), 'export const value = 2;\n');
    const nativePhase = '1-split-brain-completion--w-split-test-a1';
    const nextRoot = path.join(root, '.planning', 'riff-next');
    fs.mkdirSync(nextRoot, { recursive: true });
    fs.writeFileSync(path.join(nextRoot, `${nativePhase}.json`), `${JSON.stringify({ state: 'completed', previous_state: 'post_review_mechanics_passed' })}\n`);
    fs.writeFileSync(path.join(nextRoot, `${nativePhase}.worker-delta.json`), `${JSON.stringify({ changed: ['src/value.mjs'] })}\n`);
    const waveRoot = path.join(root, '.planning', 'riff-wave');
    fs.mkdirSync(waveRoot, { recursive: true });
    const persisted = {
      schema_version: 1, run: 'W-split-test', state: 'running', mode: 'wave', provider_override: null, selected_provider: 'codex',
      requested_phase_ids: [], max_phases: null, max_runs: null,
      waves: [{ number: 1, phase_ids: ['1'], status: 'running' }],
      phases: [{ id: '1', slug: 'split-brain-completion', title: 'Split Brain Completion', status: 'running', attempts: [{ attempt: 1, native_phase: nativePhase, status: 'running' }] }],
      current: { phase_id: '1', native_phase: nativePhase, attempt: 1 }, stop_reason: null,
      started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(waveRoot, 'W-split-test.json'), `${JSON.stringify(persisted)}\n`);
    fs.writeFileSync(path.join(waveRoot, 'active.json'), `${JSON.stringify({ run: 'W-split-test' })}\n`);
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-split-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('completed native attempt must not be rerun'); },
    });
    expect(resumed.state).toBe('completed');
    expect(resumed.phases[0].status).toBe('completed');
    expect(resumed.phases[0].attempts[0].status).toBe('completed');
    expect(resumed.final_security).toMatchObject({ verdict: 'PASS' });
    const security = JSON.parse(fs.readFileSync(path.join(waveRoot, 'W-split-test.security.json'), 'utf8'));
    expect(security.changed_paths).toEqual(['src/value.mjs']);
  });

  test('runs one ready frontier without loop and leaves newly unlocked work for the next wave', () => {
    const root = fixture(`${phase(1, 'First Wave')}${phase(2, 'Second Wave', { dependsOn: [1] })}`);
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: 'W-frontier-test' }, { invokeNext: completeNext(root, calls) });
    expect(state.state).toBe('completed');
    expect(state.stop_reason).toBe('requested_wave_complete');
    expect(state.final_security).toMatchObject({ verdict: 'PASS', blocking_findings: 0 });
    expect(calls).toHaveLength(1);
    const roadmap = fs.readFileSync(path.join(root, 'ROADMAP.yaml'), 'utf8');
    expect(roadmap.match(/status: done/g)).toHaveLength(1);
    expect(roadmap.match(/status: todo/g)).toHaveLength(1);
  });

  test('records only phases actually attempted when max-phases cuts a ready frontier short', () => {
    const root = fixture(`${phase(1, 'First Ready')}${phase(2, 'Second Ready')}`);
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-capped-frontier-test', maxPhases: 1 }, { invokeNext: completeNext(root, calls) });
    expect(state.state).toBe('paused');
    expect(state.stop_reason).toBe('max_phases_reached');
    expect(calls).toHaveLength(1);
    expect(state.final_security).toBeUndefined();
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/W-capped-frontier-test.security.json'))).toBe(false);
    expect(state.waves).toEqual([
      expect.objectContaining({ phase_ids: ['1'], status: 'completed' }),
    ]);
  });

  test('automatically retries a pre-promotion loop failure with a fresh native attempt', () => {
    const root = fixture(phase(1, 'Recoverable Work'));
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-auto-recover-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        calls.push(nativePhase);
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const completed = calls.length === 2;
        fs.writeFileSync(file, `${JSON.stringify({ state: completed ? 'completed' : 'failed', previous_state: completed ? 'post_review_mechanics_passed' : 'controller_passed' })}\n`);
        return { status: completed ? 0 : 1, signal: null };
      },
    });
    expect(state.state).toBe('completed');
    expect(calls).toHaveLength(2);
    expect(calls[0]).not.toBe(calls[1]);
    expect(state.phases[0].attempts).toEqual([
      expect.objectContaining({ recovery_cycle: 0 }),
      expect.objectContaining({ recovery_cycle: 1, recovery_strategy: 'fresh_replan_and_reverify' }),
    ]);
  });

  test('does not retry an explicit native controller block', () => {
    const root = fixture(phase(1, 'Blocked Baseline'));
    let calls = 0;
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-controller-block-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        calls += 1;
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'failed', previous_state: 'initialized', failure_kind: 'blocked' })}\n`);
        return { status: 1, signal: null };
      },
    });
    expect(calls).toBe(1);
    expect(state).toMatchObject({ state: 'blocked', stop_reason: 'phase_blocked_requires_human' });
  });

  test('stops on an unresolved debugger diagnosis after the recovery cap without another native attempt', () => {
    const root = fixture(phase(1, 'Exhausted Work'));
    setRecoveryCap(root, 1);
    const calls = [];
    let debuggerCalls = 0;
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-recovery-cap-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        calls.push(nativePhase);
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'failed', previous_state: 'controller_passed' })}\n`);
        return { status: 1, signal: null };
      },
      debuggerDispatch: ({ phase: debuggerPhase, provider }) => { debuggerCalls += 1; return debuggerResponse({ phase: debuggerPhase, run: 'W-recovery-cap-test', provider, status: 'UNRESOLVED' }); },
    });
    expect(calls).toHaveLength(2);
    expect(state.state).toBe('blocked');
    expect(state.stop_reason).toBe('debugger_unresolved');
    expect(debuggerCalls).toBe(1);
    expect(state.phases[0].attempts.map((attempt) => attempt.recovery_cycle)).toEqual([0, 1]);
    expect(state.phases[0].debugger).toMatchObject({ status: 'unresolved', provider: 'codex', route: 'debugger:fixed' });
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/W-recovery-cap-test.security.json'))).toBe(false);
  });

  test('runs exactly one debugger-guided recovery with the pinned provider after the cap', () => {
    const root = fixture(phase(1, 'Guided Recovery'));
    setRecoveryCap(root, 1, 'codex');
    const calls = []; const debuggerCalls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-guided-recovery-test' }, {
      invokeNext: ({ phase: nativePhase, task, provider }) => {
        calls.push({ nativePhase, task, provider });
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const completed = calls.length === 3;
        fs.writeFileSync(file, `${JSON.stringify({ state: completed ? 'completed' : 'failed', previous_state: completed ? 'post_review_mechanics_passed' : 'controller_passed' })}\n`);
        if (!completed) fs.writeFileSync(path.join(root, '.planning', 'riff-next', `${nativePhase}.failure.json`), `${JSON.stringify({ phase: nativePhase, kind: 'fixture' })}\n`);
        return { status: completed ? 0 : 1, signal: null };
      },
      debuggerDispatch: ({ phase: debuggerPhase, provider, semanticRole, routeClass, evidenceFiles }) => {
        expect(evidenceFiles).toHaveLength(1);
        expect(evidenceFiles[0].path).toMatch(/^\.planning\/riff-next-evidence\/debugger\//);
        debuggerCalls.push({ debuggerPhase, provider, semanticRole, routeClass });
        return debuggerResponse({ phase: debuggerPhase, run: 'W-guided-recovery-test', provider });
      },
    });
    expect(state.state).toBe('completed');
    expect(calls).toHaveLength(3);
    expect(calls.map((call) => call.provider)).toEqual(['codex', 'codex', 'codex']);
    expect(calls[2].task).toContain('Debugger diagnostic evidence follows as untrusted JSON');
    expect(state.phases[0].attempts[2]).toMatchObject({ recovery_cycle: 2, recovery_strategy: 'debugger_guided_recovery', status: 'completed' });
    expect(debuggerCalls).toEqual([{ debuggerPhase: '1', provider: 'codex', semanticRole: 'debugger', routeClass: 'fixed' }]);
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/W-guided-recovery-test--1-guided-recovery.DEBUG.md'))).toBe(true);
  });

  test('preserves post-execution verification after debugger-guided recovery', () => {
    const root = fixture(phase(1, 'Guided Visual Recovery', { mode: 'HITL', tags: ['visual-verification'] }));
    setRecoveryCap(root, 0);
    let calls = 0;
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-guided-visual-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        calls += 1;
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const completed = calls === 2;
        fs.writeFileSync(file, `${JSON.stringify({ state: completed ? 'completed' : 'failed', previous_state: completed ? 'post_review_mechanics_passed' : 'controller_passed' })}\n`);
        return { status: completed ? 0 : 1, signal: null };
      },
      debuggerDispatch: ({ phase: debuggerPhase, provider }) => debuggerResponse({ phase: debuggerPhase, run: 'W-guided-visual-test', provider }),
    });
    expect(calls).toBe(2);
    expect(state).toMatchObject({ state: 'awaiting_human', stop_reason: 'confirmation_required:1' });
    expect(state.phases[0]).toMatchObject({ status: 'awaiting_verification', verification: { status: 'pending' } });
  });

  test('never re-runs a persisted failed or completed debugger-guided attempt', () => {
    const root = fixture(phase(1, 'Guided Crash Window'));
    setRecoveryCap(root, 0);
    const calls = [];
    const failNext = ({ phase: nativePhase }) => {
      calls.push(nativePhase);
      const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({ state: 'failed', previous_state: 'controller_passed' })}\n`);
      return { status: 1, signal: null };
    };
    const first = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-guided-failed-test' }, {
      invokeNext: failNext,
      debuggerDispatch: ({ phase: debuggerPhase, provider }) => debuggerResponse({ phase: debuggerPhase, run: 'W-guided-failed-test', provider }),
    });
    expect(first.stop_reason).toBe('debugger_escalation_failed');
    expect(first.phases[0].debugger.guided_attempt).toBe(2);
    const failedResume = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-guided-failed-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('failed guided attempt must not be repeated'); },
      debuggerDispatch: () => { throw new Error('failed guided attempt must not redispatch debugger'); },
    });
    expect(failedResume.stop_reason).toBe('debugger_escalation_failed');
    expect(calls).toHaveLength(2);

    const completedRoot = fixture(phase(1, 'Completed Guided Crash Window'));
    setRecoveryCap(completedRoot, 0);
    const completedCalls = [];
    const completed = runAutonomousWave({ projectRoot: completedRoot, autonomous: true, loop: true, requestedIds: [], runId: 'W-guided-completed-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        completedCalls.push(nativePhase);
        const file = path.join(completedRoot, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const done = completedCalls.length === 2;
        fs.writeFileSync(file, `${JSON.stringify({ state: done ? 'completed' : 'failed', previous_state: done ? 'post_review_mechanics_passed' : 'controller_passed' })}\n`);
        return { status: done ? 0 : 1, signal: null };
      },
      debuggerDispatch: ({ phase: debuggerPhase, provider }) => debuggerResponse({ phase: debuggerPhase, run: 'W-guided-completed-test', provider }),
    });
    expect(completed.state).toBe('completed');
    const stateFile = path.join(completedRoot, '.planning', 'riff-wave', 'W-guided-completed-test.json');
    const crash = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    crash.state = 'running'; crash.stop_reason = null; crash.current = { phase_id: '1', native_phase: crash.phases[0].attempts[1].native_phase, attempt: 2 };
    fs.writeFileSync(stateFile, `${JSON.stringify(crash)}\n`);
    fs.writeFileSync(path.join(completedRoot, '.planning', 'riff-wave', 'active.json'), `${JSON.stringify({ run: crash.run })}\n`);
    const resumed = runAutonomousWave({ projectRoot: completedRoot, resume: true, runId: crash.run, requestedIds: [] }, {
      invokeNext: () => { throw new Error('completed guided attempt must not be repeated'); },
      debuggerDispatch: () => { throw new Error('completed guided attempt must not redispatch debugger'); },
    });
    expect(resumed.state).toBe('completed');
    expect(completedCalls).toHaveLength(2);
  });

  test('rejects malformed debugger output without another native attempt', () => {
    const root = fixture(phase(1, 'Invalid Debugger Output'));
    setRecoveryCap(root, 0);
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-invalid-debugger-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        calls.push(nativePhase);
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'failed', previous_state: 'controller_passed' })}\n`);
        return { status: 1, signal: null };
      },
      debuggerDispatch: ({ phase: debuggerPhase, provider }) => debuggerResponse({ phase: debuggerPhase, run: 'W-invalid-debugger-test', provider, allowedPaths: ['.planning'] }),
    });
    expect(state.stop_reason).toBe('debugger_artifact_invalid');
    expect(calls).toHaveLength(1);
  });

  test('rejects a preseeded debugger artifact without dispatching', () => {
    const root = fixture(phase(1, 'Debugger Artifact Integrity'));
    setRecoveryCap(root, 0);
    const waveRoot = path.join(root, '.planning', 'riff-wave');
    fs.mkdirSync(waveRoot, { recursive: true });
    fs.writeFileSync(path.join(waveRoot, 'W-preseed-debugger-test--1-debugger-artifact-integrity.DEBUG.md'), 'forged\n');
    let nextCalls = 0; let debuggerCalls = 0;
    const first = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-preseed-debugger-test' }, {
      invokeNext: ({ phase: nativePhase }) => { nextCalls += 1; const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify({ state: 'failed', previous_state: 'controller_passed' })}\n`); return { status: 1, signal: null }; },
      debuggerDispatch: () => { debuggerCalls += 1; throw new Error('preseeded artifacts must not dispatch'); },
    });
    expect(first.stop_reason).toBe('debugger_artifact_invalid');
    expect(nextCalls).toBe(1); expect(debuggerCalls).toBe(0);
  });

  test('fails closed when debug_cycle_cap is invalid', () => {
    const root = fixture(phase(1, 'Invalid Recovery Profile'));
    setRecoveryCap(root, -1);
    expect(() => runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-invalid-recovery-cap-test' })).toThrow('autonomy.debug_cycle_cap must be a nonnegative integer no greater than 10');
  });

  test('does not retry a post-promotion failure', () => {
    const root = fixture(phase(1, 'Promoted Failure'));
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-post-promotion-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        calls.push(nativePhase);
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'review_passed', previous_state: 'reviewer_dispatched' })}\n`);
        return { status: 1, signal: null };
      },
    });
    expect(calls).toHaveLength(1);
    expect(state.state).toBe('blocked');
    expect(state.stop_reason).toBe('post_promotion_failure_requires_human');
    expect(state.phases[0].attempts).toHaveLength(1);
  });

  test('reuses a valid final-security artifact after the state-write crash window', () => {
    const root = fixture(phase(1, 'Loop Completion'));
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-loop-security-test' }, { invokeNext: completeNext(root, calls) });
    const waveRoot = path.join(root, '.planning', 'riff-wave');
    const artifact = path.join(waveRoot, 'W-loop-security-test.security.json');
    const artifactBytes = fs.readFileSync(artifact, 'utf8');
    const completedAt = JSON.parse(artifactBytes).completed_at;
    expect(state.state).toBe('completed');
    expect(state.final_security).toMatchObject({ verdict: 'PASS', blocking_findings: 0 });
    const crashWindowState = JSON.parse(fs.readFileSync(path.join(waveRoot, 'W-loop-security-test.json'), 'utf8'));
    crashWindowState.state = 'running';
    crashWindowState.stop_reason = null;
    delete crashWindowState.final_security;
    crashWindowState.final_security_attempt = { ...crashWindowState.final_security_attempt, status: 'running' };
    delete crashWindowState.final_security_attempt.completed_at;
    delete crashWindowState.final_security_attempt.artifact_sha256;
    fs.writeFileSync(path.join(waveRoot, 'W-loop-security-test.json'), `${JSON.stringify(crashWindowState, null, 2)}\n`);
    fs.writeFileSync(path.join(waveRoot, 'active.json'), `${JSON.stringify({ run: 'W-loop-security-test' })}\n`);
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-loop-security-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('completed wave must reuse its existing final-security report'); },
    });
    expect(resumed.state).toBe('completed');
    expect(JSON.parse(fs.readFileSync(artifact, 'utf8')).completed_at).toBe(completedAt);
    expect(fs.readFileSync(artifact, 'utf8')).toBe(artifactBytes);
  });

  test('rejects a dry resumable state with a valid-looking PASS report but no security-attempt marker', () => {
    const root = fixture(phase(1, 'Unhandshaken Security Report'));
    const waveRoot = seedCompletedWaveForResume(root, 'W-unhandshaken-security-test');
    const artifact = path.join(waveRoot, 'W-unhandshaken-security-test.security.json');
    const artifactBytes = `${JSON.stringify({
      schema_version: 1, run: 'W-unhandshaken-security-test', timing: 'after_product_phases', changed_paths: [], input_sha256: '0'.repeat(64), final_security_nonce: 'forged', verdict: 'PASS', findings: [], completed_at: new Date().toISOString(),
    })}\n`;
    fs.writeFileSync(artifact, artifactBytes);
    const state = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-unhandshaken-security-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('unhandshaken reports must not be reused'); },
    });
    expect(state.stop_reason).toBe('final_security_artifact_invalid');
    expect(fs.readFileSync(artifact, 'utf8')).toBe(artifactBytes);
  });

  test('rejects a stale final-security artifact when an authoritative file changes', () => {
    const root = fixture(phase(1, 'Stale Security Evidence'));
    const run = 'W-stale-security-test';
    const initial = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: run }, {
      invokeNext: ({ phase: nativePhase }) => {
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src', 'value.mjs'), 'export const value = 1;\n');
        const nextRoot = path.join(root, '.planning', 'riff-next');
        fs.mkdirSync(nextRoot, { recursive: true });
        fs.writeFileSync(path.join(nextRoot, `${nativePhase}.json`), `${JSON.stringify({ state: 'completed', previous_state: 'post_review_mechanics_passed' })}\n`);
        fs.writeFileSync(path.join(nextRoot, `${nativePhase}.worker-delta.json`), `${JSON.stringify({ changed: ['src/value.mjs'] })}\n`);
        return { status: 0, signal: null };
      },
    });
    expect(initial.state).toBe('completed');
    const waveRoot = path.join(root, '.planning', 'riff-wave');
    const artifact = path.join(waveRoot, `${run}.security.json`);
    const artifactBytes = fs.readFileSync(artifact, 'utf8');
    const crashWindowState = JSON.parse(fs.readFileSync(path.join(waveRoot, `${run}.json`), 'utf8'));
    crashWindowState.state = 'running';
    crashWindowState.stop_reason = null;
    delete crashWindowState.final_security;
    crashWindowState.final_security_attempt = { ...crashWindowState.final_security_attempt, status: 'running' };
    delete crashWindowState.final_security_attempt.completed_at;
    delete crashWindowState.final_security_attempt.artifact_sha256;
    fs.writeFileSync(path.join(waveRoot, `${run}.json`), `${JSON.stringify(crashWindowState)}\n`);
    fs.writeFileSync(path.join(waveRoot, 'active.json'), `${JSON.stringify({ run })}\n`);
    fs.writeFileSync(path.join(root, 'src', 'value.mjs'), 'export const value = 2;\n');
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: run, requestedIds: [] }, {
      invokeNext: () => { throw new Error('stale reports must not be replaced by a new security run'); },
    });
    expect(resumed.stop_reason).toBe('final_security_artifact_invalid');
    expect(fs.readFileSync(artifact, 'utf8')).toBe(artifactBytes);
  });

  test('hashes a changed symlink without reading its target', () => {
    const root = fixture(phase(1, 'Symlink Security Input'));
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-symlink-security-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        const sourceRoot = path.join(root, 'src');
        const nextRoot = path.join(root, '.planning', 'riff-next');
        fs.mkdirSync(sourceRoot, { recursive: true });
        fs.mkdirSync(nextRoot, { recursive: true });
        fs.writeFileSync(path.join(sourceRoot, 'secret-target.mjs'), 'export const secret = "a-very-long-hardcoded-secret";\n');
        fs.symlinkSync('secret-target.mjs', path.join(sourceRoot, 'link.mjs'));
        fs.writeFileSync(path.join(nextRoot, `${nativePhase}.json`), `${JSON.stringify({ state: 'completed', previous_state: 'post_review_mechanics_passed' })}\n`);
        fs.writeFileSync(path.join(nextRoot, `${nativePhase}.worker-delta.json`), `${JSON.stringify({ changed: ['src/link.mjs'] })}\n`);
        return { status: 0, signal: null };
      },
    });
    expect(state.state).toBe('completed');
    expect(state.final_security).toMatchObject({ verdict: 'PASS' });
    expect(state.final_security.input_sha256).toEqual(expect.stringMatching(/^[a-f0-9]{64}$/));
  });

  test('fails closed when a changed path escapes through an ancestor symlink without reading outside content', () => {
    const root = fixture(phase(1, 'Ancestor Symlink Security Input'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-wave-outside-'));
    fixtures.push(outside);
    fs.writeFileSync(path.join(outside, 'sentinel.mjs'), 'export const secret = "a-very-long-hardcoded-secret";\n');
    fs.symlinkSync(outside, path.join(root, 'src'));
    expect(() => runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-ancestor-symlink-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        const nextRoot = path.join(root, '.planning', 'riff-next');
        fs.mkdirSync(nextRoot, { recursive: true });
        fs.writeFileSync(path.join(nextRoot, `${nativePhase}.json`), `${JSON.stringify({ state: 'completed', previous_state: 'post_review_mechanics_passed' })}\n`);
        fs.writeFileSync(path.join(nextRoot, `${nativePhase}.worker-delta.json`), `${JSON.stringify({ changed: ['src/sentinel.mjs'] })}\n`);
        return { status: 0, signal: null };
      },
    })).toThrow('final-security ancestor is a symlink: src/sentinel.mjs');
    expect(fs.existsSync(path.join(root, '.planning', 'riff-wave', 'W-ancestor-symlink-test.security.json'))).toBe(false);
  });

  test('fails closed when a security input changes between the persisted snapshot and scan', () => {
    const root = fixture(phase(1, 'Security Snapshot Race'));
    expect(() => runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-security-race-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        const sourceRoot = path.join(root, 'src');
        const nextRoot = path.join(root, '.planning', 'riff-next');
        fs.mkdirSync(sourceRoot, { recursive: true });
        fs.mkdirSync(nextRoot, { recursive: true });
        fs.writeFileSync(path.join(sourceRoot, 'value.mjs'), 'export const value = 1;\n');
        fs.writeFileSync(path.join(nextRoot, `${nativePhase}.json`), `${JSON.stringify({ state: 'completed', previous_state: 'post_review_mechanics_passed' })}\n`);
        fs.writeFileSync(path.join(nextRoot, `${nativePhase}.worker-delta.json`), `${JSON.stringify({ changed: ['src/value.mjs'] })}\n`);
        return { status: 0, signal: null };
      },
      beforeFinalSecurityScan: () => fs.writeFileSync(path.join(root, 'src', 'value.mjs'), 'export const value = 2;\n'),
    })).toThrow('final-security input changed before scan: src/value.mjs');
    const persisted = JSON.parse(fs.readFileSync(path.join(root, '.planning', 'riff-wave', 'W-security-race-test.json'), 'utf8'));
    expect(persisted.final_security_attempt).toMatchObject({ status: 'running' });
    expect(fs.existsSync(path.join(root, '.planning', 'riff-wave', 'W-security-race-test.security.json'))).toBe(false);
  });

  test('rejects a preseeded final-security report before invoking a new wave', () => {
    const root = fixture(phase(1, 'Preseeded Security Artifact'));
    const waveRoot = path.join(root, '.planning', 'riff-wave');
    const artifact = path.join(waveRoot, 'W-preseeded-security-test.security.json');
    fs.mkdirSync(waveRoot, { recursive: true });
    fs.writeFileSync(artifact, `${JSON.stringify({ schema_version: 1, run: 'W-preseeded-security-test', timing: 'after_product_phases', changed_paths: [], verdict: 'PASS', findings: [], completed_at: new Date().toISOString() })}\n`);
    let calls = 0;
    expect(() => runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-preseeded-security-test' }, {
      invokeNext: () => { calls += 1; return { status: 0, signal: null }; },
    })).toThrow('RIFF wave run already has a final security artifact');
    expect(calls).toBe(0);
  });

  test('blocks on a malformed existing final-security artifact without replacing it', () => {
    const root = fixture(phase(1, 'Malformed Security Artifact'));
    const waveRoot = seedCompletedWaveForResume(root, 'W-malformed-security-test');
    const artifact = path.join(waveRoot, 'W-malformed-security-test.security.json');
    const artifactBytes = '{not valid json}\n';
    fs.writeFileSync(artifact, artifactBytes);
    const state = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-malformed-security-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('invalid reports must not be replaced by a new security run'); },
    });
    expect(state.state).toBe('blocked');
    expect(state.stop_reason).toBe('final_security_artifact_invalid');
    expect(state.final_security).toBeUndefined();
    expect(fs.readFileSync(artifact, 'utf8')).toBe(artifactBytes);
  });

  test('rejects a forged PASS final-security report containing a HIGH finding without overwriting it', () => {
    const root = fixture(phase(1, 'Forged Security Verdict'));
    const waveRoot = seedCompletedWaveForResume(root, 'W-forged-security-test', ['src/evidence.mjs']);
    const artifact = path.join(waveRoot, 'W-forged-security-test.security.json');
    const artifactBytes = `${JSON.stringify({
      schema_version: 1, run: 'W-forged-security-test', timing: 'after_product_phases', changed_paths: ['src/evidence.mjs'], verdict: 'PASS',
      findings: [{ severity: 'HIGH', source: 'test', path: 'src/evidence.mjs', message: 'forged verdict' }], completed_at: new Date().toISOString(),
    })}\n`;
    fs.writeFileSync(artifact, artifactBytes);
    const state = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-forged-security-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('forged reports must not be replaced by a new security run'); },
    });
    expect(state.stop_reason).toBe('final_security_artifact_invalid');
    expect(fs.readFileSync(artifact, 'utf8')).toBe(artifactBytes);
  });

  test('rejects a final-security report whose changed paths differ from authoritative evidence', () => {
    const root = fixture(phase(1, 'Mismatched Security Evidence'));
    const waveRoot = seedCompletedWaveForResume(root, 'W-mismatched-security-test', ['src/evidence.mjs']);
    const artifact = path.join(waveRoot, 'W-mismatched-security-test.security.json');
    const artifactBytes = `${JSON.stringify({
      schema_version: 1, run: 'W-mismatched-security-test', timing: 'after_product_phases', changed_paths: ['src/forged.mjs'], verdict: 'PASS', findings: [], completed_at: new Date().toISOString(),
    })}\n`;
    fs.writeFileSync(artifact, artifactBytes);
    const state = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-mismatched-security-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('mismatched evidence must not be replaced by a new security run'); },
    });
    expect(state.stop_reason).toBe('final_security_artifact_invalid');
    expect(fs.readFileSync(artifact, 'utf8')).toBe(artifactBytes);
  });

  test('does not reset a loop recovery cycle when the resumed profile permits another attempt', () => {
    const root = fixture(phase(1, 'Resume Recovery'));
    setRecoveryCap(root, 1);
    const initialCalls = [];
    const first = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-resume-recovery-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        initialCalls.push(nativePhase);
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'failed', previous_state: 'controller_passed' })}\n`);
        return { status: 1, signal: null };
      },
      debuggerDispatch: ({ phase: debuggerPhase, provider }) => debuggerResponse({ phase: debuggerPhase, run: 'W-resume-recovery-test', provider, status: 'UNRESOLVED' }),
    });
    expect(first.stop_reason).toBe('debugger_unresolved');
    expect(initialCalls).toHaveLength(2);
    setRecoveryCap(root, 2);
    const resumedCalls = [];
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-resume-recovery-test', requestedIds: [] }, {
      invokeNext: completeNext(root, resumedCalls),
    });
    expect(resumed.state).toBe('completed');
    expect(resumedCalls).toHaveLength(1);
    expect(resumed.phases[0].attempts.map((attempt) => attempt.recovery_cycle)).toEqual([0, 1, 2]);
    expect(resumed.phases[0].attempts[2]).toMatchObject({ recovery_strategy: 'fresh_replan_and_reverify' });
  });

  test('pins the selected provider across automatic recovery and resume after a profile change', () => {
    const root = fixture(phase(1, 'Pinned Provider Recovery'));
    setRecoveryCap(root, 1, 'codex');
    const automaticProviders = [];
    const first = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-pinned-provider-test' }, {
      invokeNext: ({ phase: nativePhase, provider }) => {
        automaticProviders.push(provider);
        if (automaticProviders.length === 1) setRecoveryCap(root, 1, 'claude');
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'failed', previous_state: 'controller_passed' })}\n`);
        return { status: 1, signal: null };
      },
      debuggerDispatch: ({ phase: debuggerPhase, provider }) => debuggerResponse({ phase: debuggerPhase, run: 'W-pinned-provider-test', provider, status: 'UNRESOLVED' }),
    });
    expect(first.stop_reason).toBe('debugger_unresolved');
    expect(first.provider_override).toBeNull();
    expect(first.selected_provider).toBe('codex');
    expect(automaticProviders).toEqual(['codex', 'codex']);
    setRecoveryCap(root, 2, 'claude');
    const resumedProviders = [];
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-pinned-provider-test', requestedIds: [] }, {
      invokeNext: ({ phase: nativePhase, provider }) => {
        resumedProviders.push(provider);
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'completed', previous_state: 'post_review_mechanics_passed' })}\n`);
        return { status: 0, signal: null };
      },
    });
    expect(resumed.state).toBe('completed');
    expect(resumed.selected_provider).toBe('codex');
    expect(resumed.provider_override).toBeNull();
    expect(resumedProviders).toEqual(['codex']);
  });

  test('marks a persisted running native attempt interrupted on resume without retrying it', () => {
    const root = fixture(phase(1, 'Persisted Running Attempt'));
    setRecoveryCap(root, 0);
    const nativePhase = '1-persisted-running-attempt--w-running-attempt-test-a1';
    const nextRoot = path.join(root, '.planning', 'riff-next');
    const waveRoot = path.join(root, '.planning', 'riff-wave');
    fs.mkdirSync(nextRoot, { recursive: true });
    fs.mkdirSync(waveRoot, { recursive: true });
    fs.writeFileSync(path.join(nextRoot, `${nativePhase}.json`), `${JSON.stringify({ state: 'controller_passed', previous_state: 'plan_validated' })}\n`);
    const persisted = {
      schema_version: 1, run: 'W-running-attempt-test', state: 'running', mode: 'loop', provider_override: null, selected_provider: 'codex',
      requested_phase_ids: [], max_phases: null, max_runs: null,
      waves: [{ number: 1, phase_ids: ['1'], status: 'running' }],
      phases: [{ id: '1', slug: 'persisted-running-attempt', title: 'Persisted Running Attempt', status: 'running', attempts: [{ attempt: 1, native_phase: nativePhase, recovery_cycle: 0, status: 'running' }] }],
      current: { phase_id: '1', native_phase: nativePhase, attempt: 1 }, stop_reason: null,
      started_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(waveRoot, 'W-running-attempt-test.json'), `${JSON.stringify(persisted)}\n`);
    fs.writeFileSync(path.join(waveRoot, 'active.json'), `${JSON.stringify({ run: 'W-running-attempt-test' })}\n`);
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-running-attempt-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('persisted running attempts must not be retried'); },
    });
    const attempt = resumed.phases[0].attempts[0];
    expect(resumed.state).toBe('blocked');
    expect(resumed.stop_reason).toBe('interrupted_requires_human');
    expect(resumed.phases[0].status).toBe('blocked');
    expect(attempt).toMatchObject({ status: 'interrupted', native_phase: nativePhase });
    expect(attempt.interrupted_at).toEqual(expect.any(String));
    expect(resumed.current).toEqual({ phase_id: '1', native_phase: nativePhase, attempt: 1 });
    const resumedAgain = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-running-attempt-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('interrupted attempts must stay non-retryable'); },
    });
    expect(resumedAgain.waves).toHaveLength(1);
  });

  test('does not retry a signaled interruption when resuming', () => {
    const root = fixture(phase(1, 'Signaled Interruption'));
    const first = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-signaled-interruption-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'controller_passed', previous_state: 'plan_validated' })}\n`);
        return { status: null, signal: 'SIGTERM' };
      },
    });
    expect(first.stop_reason).toBe('interrupted_requires_human');
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-signaled-interruption-test', requestedIds: [] }, {
      invokeNext: () => { throw new Error('signaled interruptions must not be retried'); },
    });
    expect(resumed.state).toBe('blocked');
    expect(resumed.stop_reason).toBe('interrupted_requires_human');
    expect(resumed.phases[0].attempts).toHaveLength(1);
    expect(resumed.phases[0].attempts[0].status).toBe('interrupted');
  });

  test('runs security once after product work and blocks only a reproducible high finding', () => {
    const root = fixture(phase(1, 'Credential Change'));
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: 'W-security-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        fs.mkdirSync(path.join(root, 'src'), { recursive: true });
        fs.writeFileSync(path.join(root, 'src/config.mjs'), 'export const secret = "a-very-long-hardcoded-secret";\n');
        const statePath = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(statePath), { recursive: true });
        fs.writeFileSync(statePath, `${JSON.stringify({ state: 'completed', previous_state: 'post_review_mechanics_passed' })}\n`);
        fs.writeFileSync(path.join(root, '.planning', 'riff-next', `${nativePhase}.worker-delta.json`), `${JSON.stringify({ changed: ['src/config.mjs'] })}\n`);
        return { status: 0, signal: null };
      },
    });
    expect(state.state).toBe('blocked');
    expect(state.stop_reason).toBe('final_security_findings');
    expect(state.final_security).toMatchObject({ verdict: 'FAIL', blocking_findings: 1 });
    const report = JSON.parse(fs.readFileSync(path.join(root, '.planning/riff-wave/W-security-test.security.json'), 'utf8'));
    expect(report.timing).toBe('after_product_phases');
    expect(report.findings).toEqual(expect.arrayContaining([expect.objectContaining({ severity: 'HIGH', source: 'secret-scan', path: 'src/config.mjs' })]));
  });

  test('persists one semantic security receipt and blocks a validated high finding', () => {
    const root = fixture(phase(1, 'Semantic Security'));
    let dispatches = 0;
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: 'W-semantic-security-test' }, {
      invokeNext: completeNext(root, []),
      semanticDispatch: ({ phase }) => {
        dispatches += 1;
        return { ...semanticPass({ phase, provider: 'codex' }), stdout: `---\nphase: ${phase}\ngenerated_at: 2026-01-01T00:00:00Z\nverdict: BLOCKED\n---\n## Verdict\nBLOCKED\n## Findings\n### [HIGH] Missing authorization\nLocation: ROADMAP.yaml:1\nOWASP category: A01 Broken Access Control\nDescription: Authorization is not enforced.\nProof: The route has no authorization check.\nFix: Enforce authorization before processing.\n## Resolved Findings\nNone.\n## Notes\nReview completed.` };
      },
    });
    expect(state).toMatchObject({ state: 'blocked', stop_reason: 'final_semantic_security_findings' });
    expect(dispatches).toBe(1);
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/W-semantic-security-test.security-review.md'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/W-semantic-security-test.security-review.routing.json'))).toBe(true);
  });

  test('reuses a valid semantic PASS artifact without a second dispatch after a state-write crash', () => {
    const root = fixture(phase(1, 'Semantic Reuse'));
    const run = 'W-semantic-reuse-test'; let calls = 0;
    const pass = semanticPass;
    runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: run }, { invokeNext: completeNext(root, []), semanticDispatch: (args) => { calls += 1; return pass(args); } });
    const file = path.join(root, '.planning/riff-wave', `${run}.json`); const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    state.state = 'running'; state.final_semantic_security_attempt.status = 'running'; delete state.final_semantic_security_attempt.completed_at;
    fs.writeFileSync(file, `${JSON.stringify(state)}\n`); fs.writeFileSync(path.join(root, '.planning/riff-wave/active.json'), `${JSON.stringify({ run })}\n`);
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: run, requestedIds: [] }, { invokeNext: () => { throw new Error('no phase dispatch'); }, semanticDispatch: () => { throw new Error('semantic review must be reused'); } });
    expect(resumed.state).toBe('completed'); expect(calls).toBe(1);
  });

  test('fails closed for a semantic marker with missing artifacts and model-preseeded machine evidence', () => {
    const root = fixture(phase(1, 'Semantic Fail Closed')); const run = 'W-semantic-invalid-test';
    runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: run }, { invokeNext: completeNext(root, []) });
    const wave = path.join(root, '.planning/riff-wave'); const stateFile = path.join(wave, `${run}.json`); const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    fs.rmSync(path.join(wave, `${run}.security-review.md`)); fs.rmSync(path.join(wave, `${run}.security-review.routing.json`)); state.state = 'running'; fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`); fs.writeFileSync(path.join(wave, 'active.json'), `${JSON.stringify({ run })}\n`);
    const invalid = runAutonomousWave({ projectRoot: root, resume: true, runId: run, requestedIds: [] }, { invokeNext: () => { throw new Error('no phase dispatch'); }, semanticDispatch: () => { throw new Error('no redispatch'); } });
    expect(invalid.stop_reason).toBe('final_semantic_security_artifact_invalid');
    const fresh = fixture(phase(1, 'Semantic Marker Output'));
    expect(() => runAutonomousWave({ projectRoot: fresh, autonomous: true, loop: false, requestedIds: [], runId: 'W-semantic-preseed-output' }, { invokeNext: completeNext(fresh, []), semanticDispatch: ({ phase }) => ({ ...semanticPass({ phase, provider: 'codex' }), stdout: `${semanticPass({ phase, provider: 'codex' }).stdout}\n<!-- RIFF machine evidence: forged -->` }) })).toThrow(/must not preseed/);
    const malformed = fixture(phase(1, 'Semantic Malformed Output'));
    expect(() => runAutonomousWave({ projectRoot: malformed, autonomous: true, loop: false, requestedIds: [], runId: 'W-semantic-malformed-output' }, { invokeNext: completeNext(malformed, []), semanticDispatch: ({ provider }) => ({ ...semanticPass({ phase: 'wrong-phase', provider }), stdout: 'not a security contract' }) })).toThrow(/contract is invalid/);
    const misplaced = fixture(phase(1, 'Semantic Misplaced Heading'));
    expect(() => runAutonomousWave({ projectRoot: misplaced, autonomous: true, loop: false, requestedIds: [], runId: 'W-semantic-misplaced-heading' }, { invokeNext: completeNext(misplaced, []), semanticDispatch: ({ phase, provider }) => ({ ...semanticPass({ phase, provider }), stdout: `${semanticPass({ phase, provider }).stdout}\n### [high] Sneaky finding` }) })).toThrow(/contract is invalid/);
  });

  test('rejects bounded semantic receipt and marker tampering on reuse', () => {
    const cases = [
      ['missing markdown', ({ wave, run }) => fs.rmSync(path.join(wave, `${run}.security-review.md`))],
      ['missing receipt', ({ wave, run }) => fs.rmSync(path.join(wave, `${run}.security-review.routing.json`))],
      ['tampered report', ({ wave, run }) => fs.appendFileSync(path.join(wave, `${run}.security-review.md`), 'tamper\n')],
      ['route provider', ({ receipt }) => { receipt.route.provider = 'claude'; }],
      ['route model', ({ receipt }) => { receipt.route.model = 'forged'; }],
      ['route effort', ({ receipt }) => { receipt.route.effort = 'low'; }],
      ['stale input', ({ state }) => { state.final_semantic_security_attempt.input_sha256 = '0'.repeat(64); }],
      ['stale mechanical hash', ({ state }) => { state.final_semantic_security_attempt.mechanical_artifact_sha256 = '1'.repeat(64); }],
    ];
    for (const [label, mutate] of cases) {
      const root = fixture(phase(1, `Tamper ${label}`)); const run = `W-tamper-${label.replace(/[^a-z]+/gi, '-').toLowerCase()}`;
      runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: run }, { invokeNext: completeNext(root, []) });
      const wave = path.join(root, '.planning/riff-wave'); const file = path.join(wave, `${run}.json`); const state = JSON.parse(fs.readFileSync(file, 'utf8')); const receiptFile = path.join(wave, `${run}.security-review.routing.json`); const receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
      mutate({ wave, run, state, receipt }); state.state = 'running'; fs.writeFileSync(file, `${JSON.stringify(state)}\n`); if (fs.existsSync(receiptFile)) fs.writeFileSync(receiptFile, `${JSON.stringify(receipt)}\n`); fs.writeFileSync(path.join(wave, 'active.json'), `${JSON.stringify({ run })}\n`);
      const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: run, requestedIds: [] }, { invokeNext: () => { throw new Error('no phase dispatch'); }, semanticDispatch: () => { throw new Error('no semantic redispatch'); } });
      expect(resumed.stop_reason, label).toBe('final_semantic_security_artifact_invalid');
    }
  });

  test('rejects fresh preseeded semantic artifact halves and records a Claude route identity', () => {
    for (const suffix of ['security-review.md', 'security-review.routing.json']) {
      const root = fixture(phase(1, 'Preseed')); const run = `W-preseed-${suffix.replace(/[^a-z]+/gi, '-')}`; const wave = path.join(root, '.planning/riff-wave'); fs.mkdirSync(wave, { recursive: true }); fs.writeFileSync(path.join(wave, `${run}.${suffix}`), 'forged\n');
      expect(() => runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: run }, { invokeNext: completeNext(root, []) })).toThrow(/already has a final security artifact/);
    }
    const root = fixture(phase(1, 'Claude Semantic')); const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: false, requestedIds: [], runId: 'W-claude-semantic', provider: 'claude' }, { invokeNext: completeNext(root, []) });
    expect(state.final_semantic_security).toMatchObject({ provider: 'claude', adapter: 'agents/claude.yaml#native_roles.security-reviewer.variants.fixed', model: 'opus', effort: 'xhigh' });
  });

  test('creates one durable request after the first dependency-ready verification implementation', () => {
    const root = fixture(`${phase(1, 'Visual Checkpoint', { mode: 'HITL', tags: ['visual-verification'] })}${phase(2, 'Future Checkpoint', { dependsOn: [1], mode: 'HITL', tags: ['visual-verification'] })}`);
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-verification-request' }, { invokeNext: completeNext(root, calls) });
    expect(state).toMatchObject({ state: 'awaiting_human', stop_reason: 'confirmation_required:1' });
    expect(calls).toHaveLength(1);
    expect(state.phases).toHaveLength(1);
    expect(state.phases[0]).toMatchObject({ status: 'awaiting_verification', attempts: [{ status: 'awaiting_verification' }] });
    const verification = state.phases[0].verification;
    expect(verification).toMatchObject({ status: 'pending', reason: 'confirmation_required:1' });
    const request = path.join(root, verification.request_path);
    expect(JSON.parse(fs.readFileSync(request, 'utf8'))).toMatchObject({ run: 'W-verification-request', provider: 'codex', phase_id: '1', phase_metadata_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    const statePath = path.join(root, '.planning/riff-wave/W-verification-request.json');
    const crashWindow = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    crashWindow.state = 'running'; crashWindow.stop_reason = null;
    crashWindow.phases[0].status = 'running'; crashWindow.phases[0].attempts[0].status = 'running';
    delete crashWindow.phases[0].verification;
    crashWindow.waves[0].status = 'running';
    fs.writeFileSync(statePath, `${JSON.stringify(crashWindow)}\n`);
    const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: 'W-verification-request', requestedIds: [] }, { invokeNext: () => { throw new Error('post-verification resume must not rerun native work'); } });
    expect(resumed).toMatchObject({ state: 'awaiting_human', stop_reason: 'confirmation_required:1' });
    expect(resumed.phases[0].verification.request_sha256).toBe(verification.request_sha256);
    expect(resumed.waves[0].status).toBe('awaiting_human');
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/W-verification-request--2-future-checkpoint.verification-request.json'))).toBe(false);
  });

  test('records approval atomically, resumes the same run once, and consumes it', () => {
    const root = fixture(phase(1, 'Manual Browser Check', { mode: 'HITL', tags: ['manual-verification'] }));
    const calls = [];
    const first = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-verification-approve' }, { invokeNext: completeNext(root, calls) });
    const complete = runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: 'W-verification-approve', approvalPhaseId: '1', approvalEvidence: 'Checked: browser checkout confirmation; Observed: success screen displayed an order ID; Expected: confirmed order with visible receipt', requestedIds: [] }, { invokeNext: completeNext(root, calls) });
    expect(complete.state).toBe('completed');
    expect(calls).toHaveLength(1);
    expect(complete.waves[0].status).toBe('completed');
    expect(complete.phases[0].verification.status).toBe('consumed');
    const receipt = path.join(root, complete.phases[0].verification.receipt_path);
    expect(fs.existsSync(receipt)).toBe(true);
    expect(fs.readdirSync(path.dirname(receipt)).some((file) => file.includes('.tmp-'))).toBe(false);
    const repeated = runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: 'W-verification-approve', approvalPhaseId: '1', approvalEvidence: 'Checked: browser checkout confirmation; Observed: success screen displayed an order ID; Expected: confirmed order with visible receipt', requestedIds: [] }, { invokeNext: () => { throw new Error('an idempotent approval must not dispatch'); } });
    expect(repeated.state).toBe('completed');
  });

  test('rejects missing, generic, tampered, and stale verification approvals', () => {
    const root = fixture(phase(1, 'Visual Evidence', { mode: 'HITL', tags: ['visual-verification'] }));
    runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-verification-reject' }, { invokeNext: completeNext(root, []) });
    expect(() => runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: 'W-verification-reject', approvalPhaseId: '2', approvalEvidence: 'Checked: browser confirmation page; Observed: success banner remained visible; Expected: confirmation remains visible to the operator', requestedIds: [] })).toThrow(/missing from ROADMAP/);
    expect(() => runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: 'W-verification-reject', approvalPhaseId: '1', approvalEvidence: 'looks good', requestedIds: [] })).toThrow(/Checked: <scope>/);
    const stateFile = path.join(root, '.planning/riff-wave/W-verification-reject.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    fs.appendFileSync(path.join(root, state.phases[0].verification.request_path), 'tamper\n');
    expect(() => runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: 'W-verification-reject', approvalPhaseId: '1', approvalEvidence: 'Checked: browser confirmation page; Observed: success banner remained visible; Expected: confirmation remains visible to the operator', requestedIds: [] })).toThrow(/malformed|tampered/);
    const stale = fixture(phase(1, 'Stale Visual Evidence', { mode: 'HITL', tags: ['visual-verification'] }));
    runAutonomousWave({ projectRoot: stale, autonomous: true, loop: true, requestedIds: [], runId: 'W-verification-stale' }, { invokeNext: completeNext(stale, []) });
    const roadmap = path.join(stale, 'ROADMAP.yaml');
    fs.writeFileSync(roadmap, fs.readFileSync(roadmap, 'utf8').replace('Stale Visual Evidence', 'Changed Visual Evidence'));
    expect(() => runAutonomousWave({ projectRoot: stale, approve: true, resume: true, runId: 'W-verification-stale', approvalPhaseId: '1', approvalEvidence: 'Checked: changed browser confirmation; Observed: revised screen showed the order status; Expected: revised confirmation shows the correct order status', requestedIds: [] })).toThrow(/request state is invalid/);
  });

  test('creates a distinct next request only after the first approval is consumed', () => {
    const root = fixture(`${phase(1, 'First Manual Check', { mode: 'HITL', tags: ['manual-verification'] })}${phase(2, 'Second Manual Check', { dependsOn: [1], mode: 'HITL', tags: ['manual-verification'] })}`);
    const calls = [];
    runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-verification-sequence' }, { invokeNext: completeNext(root, calls) });
    const paused = runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: 'W-verification-sequence', approvalPhaseId: '1', approvalEvidence: 'Checked: first manual browser behavior; Observed: rendered control accepted the selected value; Expected: selected value is accepted and displayed', requestedIds: [] }, { invokeNext: completeNext(root, calls) });
    expect(calls).toHaveLength(2);
    expect(paused).toMatchObject({ state: 'awaiting_human', stop_reason: 'confirmation_required:2' });
    expect(paused.phases.find((entry) => entry.id === '1').verification.status).toBe('consumed');
    const second = paused.phases.find((entry) => entry.id === '2').verification;
    expect(second).toMatchObject({ status: 'pending' });
    expect(second.request_path).not.toBe(paused.phases.find((entry) => entry.id === '1').verification.request_path);
  });

  test('consumes approved verification in the same completion write and reconciles legacy crash splits', () => {
    const root = fixture(phase(1, 'Crash Window Check', { mode: 'HITL', tags: ['manual-verification'] }));
    const run = 'W-verification-crash-window';
    runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: run }, { invokeNext: completeNext(root, []) });
    const completed = runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: run, approvalPhaseId: '1', approvalEvidence: evidence(), requestedIds: [] }, { invokeNext: completeNext(root, []) });
    expect(completed.phases[0].verification.status).toBe('consumed');
    const rootState = path.join(root, '.planning/riff-wave', `${run}.json`);
    const split = JSON.parse(fs.readFileSync(rootState, 'utf8'));
    split.state = 'running'; split.stop_reason = null; split.phases[0].verification.status = 'approved'; delete split.phases[0].verification.consumed_at;
    delete split.final_security; delete split.final_security_attempt; delete split.final_semantic_security; delete split.final_semantic_security_attempt;
    fs.rmSync(path.join(root, '.planning/riff-wave', `${run}.security.json`)); fs.rmSync(path.join(root, '.planning/riff-wave', `${run}.security-review.md`)); fs.rmSync(path.join(root, '.planning/riff-wave', `${run}.security-review.routing.json`));
    fs.writeFileSync(rootState, `${JSON.stringify(split)}\n`); fs.writeFileSync(path.join(root, '.planning/riff-wave/active.json'), `${JSON.stringify({ run })}\n`);
    const reconciled = runAutonomousWave({ projectRoot: root, resume: true, runId: run, requestedIds: [] }, { invokeNext: () => { throw new Error('legacy completed phase must not dispatch'); } });
    expect(reconciled.phases[0].verification.status).toBe('consumed');

    const nativeRoot = fixture(phase(1, 'Native Crash Check', { mode: 'HITL', tags: ['manual-verification'] }));
    const nativeRun = 'W-verification-native-crash';
    runAutonomousWave({ projectRoot: nativeRoot, autonomous: true, loop: true, requestedIds: [], runId: nativeRun }, { invokeNext: completeNext(nativeRoot, []) });
    const nativeComplete = runAutonomousWave({ projectRoot: nativeRoot, approve: true, resume: true, runId: nativeRun, approvalPhaseId: '1', approvalEvidence: evidence('native reconciliation browser check'), requestedIds: [] }, { invokeNext: completeNext(nativeRoot, []) });
    const nativeStatePath = path.join(nativeRoot, '.planning/riff-wave', `${nativeRun}.json`); const nativeSplit = JSON.parse(fs.readFileSync(nativeStatePath, 'utf8')); const attempt = nativeSplit.phases[0].attempts[0];
    nativeSplit.state = 'running'; nativeSplit.stop_reason = null; nativeSplit.phases[0].status = 'running'; nativeSplit.phases[0].verification.status = 'approved'; delete nativeSplit.phases[0].verification.consumed_at; attempt.status = 'running'; nativeSplit.current = { phase_id: '1', native_phase: attempt.native_phase, attempt: 1 };
    delete nativeSplit.final_security; delete nativeSplit.final_security_attempt; delete nativeSplit.final_semantic_security; delete nativeSplit.final_semantic_security_attempt;
    for (const suffix of ['security.json', 'security-review.md', 'security-review.routing.json']) fs.rmSync(path.join(nativeRoot, '.planning/riff-wave', `${nativeRun}.${suffix}`));
    fs.writeFileSync(nativeStatePath, `${JSON.stringify(nativeSplit)}\n`); fs.writeFileSync(path.join(nativeRoot, '.planning/riff-wave/active.json'), `${JSON.stringify({ run: nativeRun })}\n`);
    const nativeReconciled = runAutonomousWave({ projectRoot: nativeRoot, resume: true, runId: nativeRun, requestedIds: [] }, { invokeNext: () => { throw new Error('native-completed reconciliation must not dispatch'); } });
    expect(nativeReconciled.phases[0].verification.status).toBe('consumed');
  });

  test('rejects incomplete, symlinked, and mismatched verification artifacts', () => {
    const cases = [
      ['missing request', (root, state) => fs.rmSync(path.join(root, state.phases[0].verification.request_path))],
      ['partial request', (root, state) => fs.writeFileSync(path.join(root, state.phases[0].verification.request_path), '{}\n')],
      ['symlink request', (root, state) => { const file = path.join(root, state.phases[0].verification.request_path); fs.rmSync(file); fs.symlinkSync('/dev/null', file); }],
      ['provider mismatch', (root, state) => { const file = path.join(root, state.phases[0].verification.request_path); const body = JSON.parse(fs.readFileSync(file, 'utf8')); body.provider = 'claude'; const text = `${JSON.stringify(body)}\n`; fs.writeFileSync(file, text); state.phases[0].verification.request_sha256 = createHash('sha256').update(text).digest('hex'); }],
      ['run mismatch', (root, state) => { const file = path.join(root, state.phases[0].verification.request_path); const body = JSON.parse(fs.readFileSync(file, 'utf8')); body.run = 'W-other-run'; const text = `${JSON.stringify(body)}\n`; fs.writeFileSync(file, text); state.phases[0].verification.request_sha256 = createHash('sha256').update(text).digest('hex'); }],
      ['phase mismatch', (root, state) => { const file = path.join(root, state.phases[0].verification.request_path); const body = JSON.parse(fs.readFileSync(file, 'utf8')); body.phase_id = '99'; const text = `${JSON.stringify(body)}\n`; fs.writeFileSync(file, text); state.phases[0].verification.request_sha256 = createHash('sha256').update(text).digest('hex'); }],
    ];
    for (const [label, mutate] of cases) {
      const root = fixture(phase(1, `Artifact ${label}`, { mode: 'HITL', tags: ['manual-verification'] })); const run = `W-${label.replace(/\s+/g, '-')}`;
      runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: run }, { invokeNext: completeNext(root, []) });
      const statePath = path.join(root, '.planning/riff-wave', `${run}.json`); const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      mutate(root, state); fs.writeFileSync(statePath, `${JSON.stringify(state)}\n`);
      expect(() => runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: run, approvalPhaseId: '1', approvalEvidence: evidence(), requestedIds: [] }), label).toThrow(/request|regular file|malformed/);
    }
  });

  test('runs a visual gate, but leaves destructive and promotion gates uninvoked before approval', () => {
    const root = fixture(`${phase(1, 'Visual Gate', { mode: 'HITL', tags: ['visual-verification'] })}${phase(2, 'Production Promotion', { mode: 'HITL', tags: ['promotion'] })}${phase(3, 'Destructive Cutover', { mode: 'HITL', tags: ['destructive'] })}`);
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-parallel-gates' }, { invokeNext: completeNext(root, calls) });
    expect(state).toMatchObject({ state: 'awaiting_human', stop_reason: 'confirmation_required:1' });
    expect(state.phases.map((entry) => entry.id)).toEqual(['1']);
    expect(calls).toHaveLength(1);
  });

  test('rejects missing, partial, tampered, and symlinked approval receipts', () => {
    const cases = [
      ['missing receipt', (file) => fs.rmSync(file)],
      ['partial receipt', (file) => fs.writeFileSync(file, '{}\n')],
      ['tampered receipt', (file) => fs.appendFileSync(file, 'tamper\n')],
      ['symlink receipt', (file) => { fs.rmSync(file); fs.symlinkSync('/dev/null', file); }],
    ];
    for (const [label, mutate] of cases) {
      const root = fixture(phase(1, `Receipt ${label}`, { mode: 'HITL', tags: ['manual-verification'] })); const run = `W-receipt-${label.replace(/\s+/g, '-')}`;
      runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: run }, { invokeNext: completeNext(root, []) });
      const done = runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: run, approvalPhaseId: '1', approvalEvidence: evidence(), requestedIds: [] }, { invokeNext: completeNext(root, []) });
      mutate(path.join(root, done.phases[0].verification.receipt_path));
      expect(() => runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: run, approvalPhaseId: '1', approvalEvidence: evidence(), requestedIds: [] }), label).toThrow(/approval|regular file|malformed/);
    }
  });

  test('CLI help exposes approval syntax and rejects incomplete approval parsing', () => {
    const script = path.join(frameworkRoot, 'scripts/riff-wave.mjs');
    expect(execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8' })).toContain('--approve --run W-... --phase ID --evidence');
    expect(() => execFileSync(process.execPath, [script, '--approve', '--run', 'W-parse'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).toThrow(/--approve requires --run, --phase, and --evidence/);
  });

  test('keeps a destructive approval eligible across a safe retry and consumes it only after completion', () => {
    const root = fixture(phase(1, 'Production Promotion', { mode: 'HITL', tags: ['promotion'] })); const calls = [];
    runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-approved-retry' });
    const state = runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: 'W-approved-retry', approvalPhaseId: '1', approvalEvidence: evidence('retry browser evidence'), requestedIds: [] }, {
      invokeNext: ({ phase: nativePhase }) => {
        calls.push(nativePhase); const file = path.join(root, '.planning/riff-next', `${nativePhase}.json`); fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: calls.length === 1 ? 'failed' : 'completed', previous_state: calls.length === 1 ? 'controller_passed' : 'post_review_mechanics_passed' })}\n`);
        return { status: calls.length === 1 ? 1 : 0, signal: null };
      },
    });
    expect(calls).toHaveLength(2); expect(state.phases[0].verification.status).toBe('consumed');
  });

  test('blocks before final security when a consumed verification request or receipt disappears', () => {
    for (const target of ['request_path', 'receipt_path']) {
      const root = fixture(phase(1, `Final Gate ${target}`, { mode: 'HITL', tags: ['manual-verification'] })); const run = `W-final-gate-${target}`;
      runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: run }, { invokeNext: completeNext(root, []) });
      const blocked = runAutonomousWave({ projectRoot: root, approve: true, resume: true, runId: run, approvalPhaseId: '1', approvalEvidence: evidence(`final security ${target}`), requestedIds: [] }, {
        invokeNext: completeNext(root, []),
        beforeFinalSecurityScan: ({ projectRoot, state }) => fs.rmSync(path.join(projectRoot, state.phases[0].verification[target])),
      });
      expect(blocked).toMatchObject({ state: 'blocked', stop_reason: 'human_verification_artifact_invalid' });
      expect(fs.existsSync(path.join(root, '.planning/riff-wave', `${run}.security.json`))).toBe(false);
      const resumed = runAutonomousWave({ projectRoot: root, resume: true, runId: run, requestedIds: [] });
      expect(resumed).toMatchObject({ state: 'blocked', stop_reason: 'human_verification_artifact_invalid' });
    }
  });

  test('fails closed for traversal, alias-copy, symlinked state, and symlinked state ancestors', () => {
    const root = fixture(phase(1, 'State Guard'));
    expect(() => runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: '../escape' })).toThrow(/invalid wave run identifier/);
    const run = 'W-state-guard'; runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: run, maxPhases: 1 }, { invokeNext: completeNext(root, []) });
    const stateFile = path.join(root, '.planning/riff-wave', `${run}.json`); const copied = JSON.parse(fs.readFileSync(stateFile, 'utf8')); copied.run = 'W-alias-copy'; fs.writeFileSync(stateFile, `${JSON.stringify(copied)}\n`);
    expect(() => runAutonomousWave({ projectRoot: root, resume: true, runId: run, requestedIds: [] })).toThrow(/missing or malformed/);
    const fileRoot = fixture(phase(1, 'State File Guard')); runAutonomousWave({ projectRoot: fileRoot, autonomous: true, loop: true, requestedIds: [], runId: 'W-state-file-guard', maxPhases: 1 }, { invokeNext: completeNext(fileRoot, []) });
    const guarded = path.join(fileRoot, '.planning/riff-wave/W-state-file-guard.json'); const target = `${guarded}.target`; fs.renameSync(guarded, target); fs.symlinkSync(target, guarded);
    expect(() => runAutonomousWave({ projectRoot: fileRoot, resume: true, runId: 'W-state-file-guard', requestedIds: [] })).toThrow(/regular file/);
    const symlinkRoot = fixture(phase(1, 'Symlink Guard')); const waveRoot = path.join(symlinkRoot, '.planning/riff-wave'); fs.symlinkSync('/tmp', waveRoot);
    expect(() => runAutonomousWave({ projectRoot: symlinkRoot, autonomous: true, loop: true, requestedIds: [], runId: 'W-symlink-root' })).toThrow(/ancestor must be a real directory/);
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import { runAutonomousWave as runNativeAutonomousWave } from '../scripts/riff-wave.mjs';
import { requiresConfirmation } from '../scripts/lib/roadmap-workflow.mjs';

const frameworkRoot = path.resolve(import.meta.dirname, '..');
const fixtures = [];
function semanticPass({ phase, provider }) { return { route: { provider, adapter: provider === 'claude' ? 'agents/claude.yaml#native_roles.security-reviewer.variants.fixed' : 'agents/codex/security-reviewer.toml', model: provider === 'claude' ? 'opus' : 'gpt-5.6-sol', effort: 'xhigh', semanticRole: 'security-reviewer', routeClass: 'fixed' }, stdout: `---\nphase: ${phase}\ngenerated_at: 2026-01-01T00:00:00Z\nverdict: PASS\n---\n## Verdict\nPASS\n## Resolved Findings\nNone.\n## Notes\nReview completed.` }; }
function runAutonomousWave(options, dependencies = {}) { return runNativeAutonomousWave(options, { semanticDispatch: semanticPass, ...dependencies }); }

function phase(id, title, { dependsOn = [], mode = 'AFK', tags = [] } = {}) {
  return `  - id: ${id}\n    slug: ${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}\n    title: ${title}\n    status: todo\n    priority: P1\n    mode: ${mode}\n    tags: [${tags.join(', ')}]\n    depends_on: [${dependsOn.join(', ')}]\n    goal: Deliver ${title}.\n    tasks:\n      - Implement ${title}.\n`;
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
  test('keeps security-only implementation autonomous but honors real HITL boundaries', () => {
    const base = { confirmationRequired: false, providerMode: 'production', hitlReason: '', tasks: [], goal: '', mode: ['HITL'] };
    expect(requiresConfirmation({ ...base, title: 'Security hardening', tags: ['security'] })).toBe(false);
    expect(requiresConfirmation({ ...base, title: 'Harden implementation', tags: ['security_critical'] })).toBe(false);
    expect(requiresConfirmation({ ...base, title: 'Real payment checkout', tags: [] })).toBe(true);
    expect(requiresConfirmation({ ...base, title: 'Irreversible database migration', tags: [] })).toBe(true);
    expect(requiresConfirmation({ ...base, title: 'Production DNS cutover', tags: [] })).toBe(true);
    expect(requiresConfirmation({ ...base, title: 'Visual acceptance', tags: ['visual-verification'] })).toBe(true);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Implement OAuth callback security', tags: ['auth'] })).toBe(false);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Harden SSO token validation', tags: ['security_critical'] })).toBe(false);
    expect(requiresConfirmation({ ...base, mode: ['AFK'], title: 'Add MFA recovery unit tests', tags: ['auth'] })).toBe(false);
  });

  test('loops across dependency frontiers and stops at confirmation-required work', () => {
    const root = fixture([
      phase(1, 'Foundation'),
      phase(2, 'Security Hardening', { dependsOn: [1], mode: 'HITL', tags: ['security'] }),
      phase(3, 'Visual Acceptance', { dependsOn: [2], mode: 'HITL', tags: ['visual-verification'] }),
    ].join(''));
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-loop-test' }, { invokeNext: completeNext(root, calls) });
    expect(calls.map((call) => call.task)).toEqual(expect.arrayContaining(['Deliver Foundation. Complete these phase tasks: Implement Foundation.', 'Deliver Security Hardening. Complete these phase tasks: Implement Security Hardening.']));
    expect(state.state).toBe('blocked');
    expect(state.stop_reason).toBe('confirmation_required:3');
    expect(state.final_security).toBeUndefined();
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/W-loop-test.security.json'))).toBe(false);
    expect(state.waves.map((wave) => wave.phase_ids)).toEqual([['1'], ['2']]);
    const roadmap = fs.readFileSync(path.join(root, 'ROADMAP.yaml'), 'utf8');
    expect(roadmap.match(/status: done/g)).toHaveLength(2);
    expect(roadmap).toContain('status: todo');
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
      schema_version: 1, run: 'W-split-test', state: 'running', mode: 'wave', provider_override: null,
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

  test('stops at the recovery cap without dispatching another native attempt', () => {
    const root = fixture(phase(1, 'Exhausted Work'));
    setRecoveryCap(root, 1);
    const calls = [];
    const state = runAutonomousWave({ projectRoot: root, autonomous: true, loop: true, requestedIds: [], runId: 'W-recovery-cap-test' }, {
      invokeNext: ({ phase: nativePhase }) => {
        calls.push(nativePhase);
        const file = path.join(root, '.planning', 'riff-next', `${nativePhase}.json`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${JSON.stringify({ state: 'failed', previous_state: 'controller_passed' })}\n`);
        return { status: 1, signal: null };
      },
    });
    expect(calls).toHaveLength(2);
    expect(state.state).toBe('blocked');
    expect(state.stop_reason).toBe('recovery_cycle_cap_reached');
    expect(state.phases[0].attempts.map((attempt) => attempt.recovery_cycle)).toEqual([0, 1]);
    expect(fs.existsSync(path.join(root, '.planning/riff-wave/W-recovery-cap-test.security.json'))).toBe(false);
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
    });
    expect(first.stop_reason).toBe('recovery_cycle_cap_reached');
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
    });
    expect(first.stop_reason).toBe('recovery_cycle_cap_reached');
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
      schema_version: 1, run: 'W-running-attempt-test', state: 'running', mode: 'loop', provider_override: null,
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
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import { runAutonomousWave } from '../scripts/riff-wave.mjs';
import { requiresConfirmation } from '../scripts/lib/roadmap-workflow.mjs';

const frameworkRoot = path.resolve(import.meta.dirname, '..');
const fixtures = [];

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
    expect(state.final_security).toMatchObject({ verdict: 'PASS', blocking_findings: 0 });
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
    expect(state.waves).toEqual([
      expect.objectContaining({ phase_ids: ['1'], status: 'completed' }),
    ]);
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
});

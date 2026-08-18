import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { runDebug } from '../scripts/riff-debug.mjs';
import { runOrchestration } from '../scripts/riff-next.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const roots = [];

function report({ phase, run, intensity = 'normal', status = 'DIAGNOSED', paths = ['src/fixed.mjs'] } = {}) {
  return `## Status\n${status}\n\n## Identity\n${JSON.stringify({ intensity, phase, run })}\n\n## Failure Classification\nFocused failure.\n\n## Hypotheses\nOne falsifiable hypothesis.\n\n## Evidence\nObserved.\n\n## Root Cause\nBounded cause.\n\n## Fix Assignment\n${JSON.stringify({ allowed_paths: paths, acceptance_criteria: ['Behavior is fixed.'], checks: ['node --test src/fixed.test.mjs'] })}\n\n## Validation\nFocused.\n\n## Unresolved Risk\nNone.\n`;
}

function fixture(provider = 'codex') {
  const root = mkdtempSync(path.join(tmpdir(), 'riff-debug-'));
  roots.push(root);
  mkdirSync(path.join(root, '.planning'), { recursive: true });
  writeFileSync(path.join(root, '.planning', 'profile.yaml'), `runtime:\n  provider: ${provider}\n`);
  writeFileSync(path.join(root, 'README.md'), 'fixture\n');
  symlinkSync(repositoryRoot, path.join(root, '.riff'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'RIFF Test'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'riff-test@example.invalid'], { cwd: root });
  execFileSync('git', ['add', 'README.md'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'fixture'], { cwd: root });
  return root;
}

function directExecution(paths) {
  return {
    mode: 'direct',
    tasks: [{ title: 'Fix widget', owned_paths: paths, outcome: 'Fix the bounded widget behavior.' }],
    waves: [[1]],
    smoke: [
      { argv: ['node', '--test', 'src/widget.test.mjs'], expect: { exit_code: 0 } },
      { argv: ['node', '--test', 'src/widget.integration.test.mjs'], expect: { exit_code: 0 } },
    ],
  };
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('riff debug', () => {
  test('uses the selected provider, persists bound evidence, then calls next exactly once with allowed paths', () => {
    const root = fixture('claude');
    const calls = [];
    const result = runDebug({
      projectRoot: root, issue: 'Widget throws after save', intensity: 'max', run: 'D-contract', phase: 'debug-contract',
      debuggerDispatch: ({ provider }) => ({ route: { provider, semanticRole: 'debugger', routeClass: 'fixed' }, stdout: report({ phase: 'debug-contract', run: 'D-contract', intensity: 'max' }) }),
      invokeNext: (args) => { calls.push(args); return { status: 0 }; },
    });
    expect(result.status).toBe('DIAGNOSED');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ provider: 'claude', phase: 'debug-contract', allowedPaths: ['src/fixed.mjs'] });
    expect(calls[0].task).toContain('Widget throws after save');
    const reportPath = path.join(root, result.report);
    const receipt = JSON.parse(readFileSync(path.join(root, result.routing_receipt), 'utf8'));
    expect(existsSync(reportPath)).toBe(true);
    expect(receipt).toMatchObject({ provider: 'claude', intensity: 'max', issue_sha256: expect.any(String), report_sha256: expect.any(String) });
  });

  test('writes unresolved evidence but never invokes next', () => {
    const root = fixture();
    let nextCalls = 0;
    const result = runDebug({
      projectRoot: root, issue: 'Intermittent failure', run: 'D-unresolved', phase: 'debug-unresolved',
      debuggerDispatch: () => ({ stdout: report({ phase: 'debug-unresolved', run: 'D-unresolved', status: 'UNRESOLVED' }) }),
      invokeNext: () => { nextCalls += 1; },
    });
    expect(result.status).toBe('UNRESOLVED');
    expect(nextCalls).toBe(0);
    expect(existsSync(path.join(root, result.report))).toBe(true);
  });

  test('rejects malformed output before writing a report or invoking next', () => {
    const root = fixture();
    let nextCalls = 0;
    expect(() => runDebug({
      projectRoot: root, issue: 'Bad output', run: 'D-bad', phase: 'debug-bad',
      debuggerDispatch: () => ({ stdout: 'not a DEBUG report' }), invokeNext: () => { nextCalls += 1; },
    })).toThrow(/strict DEBUG contract/);
    expect(nextCalls).toBe(0);
    expect(existsSync(path.join(root, '.planning/debug/D-bad.DEBUG.md'))).toBe(false);
  });

  test('rejects an evidence-free diagnosed report before invoking next', () => {
    const root = fixture();
    let nextCalls = 0;
    const emptyDiagnosis = report({ phase: 'debug-empty', run: 'D-empty' })
      .replace('Focused failure.', '')
      .replace('One falsifiable hypothesis.', '')
      .replace('Observed.', '')
      .replace('Bounded cause.', '')
      .replace('Focused.', '')
      .replace('None.', '');
    expect(() => runDebug({
      projectRoot: root, issue: 'Evidence-free output', run: 'D-empty', phase: 'debug-empty',
      debuggerDispatch: () => ({ stdout: emptyDiagnosis }), invokeNext: () => { nextCalls += 1; },
    })).toThrow(/strict DEBUG contract/);
    expect(nextCalls).toBe(0);
  });

  test('fails closed on pre-existing owned artifacts before dispatch', () => {
    const root = fixture();
    mkdirSync(path.join(root, '.planning/debug'), { recursive: true });
    writeFileSync(path.join(root, '.planning/debug/D-preseed.DEBUG.md'), 'forged\n');
    let dispatches = 0;
    expect(() => runDebug({
      projectRoot: root, issue: 'Preseed', run: 'D-preseed', phase: 'debug-preseed',
      debuggerDispatch: () => { dispatches += 1; return { stdout: report({ phase: 'debug-preseed', run: 'D-preseed' }) }; },
    })).toThrow(/already exists/);
    expect(dispatches).toBe(0);
  });

  test('rejects an out-of-bound direct PLAN before any model dispatch', () => {
    const root = fixture();
    mkdirSync(path.join(root, '.planning/phases/debug-boundary'), { recursive: true });
    const fakeCodex = path.join(repositoryRoot, '__tests__/fixtures/riff-native-next/fake-codex');
    expect(() => runOrchestration({
      projectRoot: root, phase: 'debug-boundary', task: 'Fix widget', codexBin: fakeCodex,
      directExecution: directExecution(['src/outside.mjs']), allowedPaths: ['src/inside.mjs'],
      internalTestAllowNonDarwinWorkerSandbox: true,
    })).toThrow(/outside --allowed-path constraints/);
    expect(existsSync(path.join(root, '.planning/riff-next/debug-boundary.json'))).toBe(false);
  });

  test('allows an in-bound direct PLAN to reach the existing native execution seam', () => {
    const root = fixture();
    mkdirSync(path.join(root, '.planning/phases/debug-in-bound'), { recursive: true });
    const fakeCodex = path.join(repositoryRoot, '__tests__/fixtures/riff-native-next/fake-codex');
    expect(() => runOrchestration({
      projectRoot: root, phase: 'debug-in-bound', task: 'Fix widget', codexBin: fakeCodex,
      directExecution: directExecution(['src/inside.mjs']), allowedPaths: ['src'],
      internalTestAllowNonDarwinWorkerSandbox: true,
    })).not.toThrow(/outside --allowed-path constraints/);
    expect(existsSync(path.join(root, '.planning/riff-next/debug-in-bound.json'))).toBe(true);
  }, 20_000);
});

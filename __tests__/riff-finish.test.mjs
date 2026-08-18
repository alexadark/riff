import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, test } from 'vitest';
import { buildFinishPlan } from '../scripts/riff-finish.mjs';
import { runAutonomousWave } from '../scripts/riff-wave.mjs';

const frameworkRoot = path.resolve(import.meta.dirname, '..');
const roots = [];
const semanticPass = ({ phase, provider }) => ({
  route: { provider, adapter: 'agents/codex/security-reviewer.toml', model: 'gpt-5.6-sol', effort: 'xhigh', semanticRole: 'security-reviewer', routeClass: 'fixed' },
  stdout: `---\nphase: ${phase}\ngenerated_at: 2026-01-01T00:00:00Z\nverdict: PASS\n---\n## Verdict\nPASS\n## Resolved Findings\nNone.\n## Notes\nReview completed.`,
});

function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }
function fixture(strategy = 'local_no_ff', mode = 'AFK') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-finish-test-'));
  roots.push(root);
  const bare = path.join(root, 'origin.git');
  const project = path.join(root, 'project');
  execFileSync('git', ['init', '--bare', '-q', bare]);
  fs.mkdirSync(project);
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'config', 'user.name', 'RIFF Test');
  git(project, 'config', 'user.email', 'riff-test@example.invalid');
  git(project, 'remote', 'add', 'origin', bare);
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(path.join(project, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'value.mjs'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(project, '.gitignore'), '.planning/riff-next/\n.planning/riff-wave/\n');
  fs.writeFileSync(path.join(project, 'ROADMAP.yaml'), `name: Finish test\nphases:\n  - id: 1\n    slug: value\n    title: Value\n    status: todo\n    priority: P1\n    mode: ${mode}\n    tags: []\n    depends_on: []\n    goal: Update value.\n    tasks:\n      - Update value.\n`);
  fs.writeFileSync(path.join(project, '.planning', 'profile.yaml'), `runtime:\n  provider: codex\ngit:\n  merge_strategy: ${strategy}\n`);
  fs.symlinkSync(frameworkRoot, path.join(project, '.riff'));
  git(project, 'add', '.');
  git(project, 'commit', '-qm', 'base');
  git(project, 'push', '-qu', 'origin', 'main');
  if (strategy === 'github_button') {
    git(project, 'remote', 'set-url', 'origin', 'https://github.com/acme/riff.git');
    git(project, 'remote', 'set-url', '--push', 'origin', bare);
  }
  git(project, 'checkout', '-qb', 'riff/finish-test');
  const dependencies = {
    semanticDispatch: semanticPass,
    invokeNext: ({ phase }) => {
      fs.writeFileSync(path.join(project, 'src', 'value.mjs'), 'export const value = 2;\n');
      const next = path.join(project, '.planning', 'riff-next');
      fs.mkdirSync(next, { recursive: true });
      const routing = `${JSON.stringify({ schema_version: 1, status: 'routes_resolved', phase, provider: 'codex' })}\n`;
      fs.writeFileSync(path.join(next, `${phase}.routing.json`), routing);
      fs.writeFileSync(path.join(next, `${phase}.json`), JSON.stringify({ schema_version: 1, phase, state: 'completed', previous_state: 'post_review_mechanics_passed', evidence_hashes: { plan_review: 'a'.repeat(64), routing_receipt: createHash('sha256').update(routing).digest('hex') }, updated_at: new Date().toISOString() }));
      fs.writeFileSync(path.join(next, `${phase}.worker-delta.json`), JSON.stringify({ changed: ['src/value.mjs'] }));
      return { status: 0, signal: null };
    },
  };
  runAutonomousWave({ projectRoot: project, autonomous: true, loop: false, requestedIds: [], runId: 'W-finish-test' }, dependencies);
  if (mode === 'HITL') runAutonomousWave({ projectRoot: project, resume: true, approve: true, requestedIds: [], runId: 'W-finish-test', approvalPhaseId: '1', approvalEvidence: 'Checked: browser confirmation result; Observed: visible result with persisted value; Expected: visible result matches requested value' }, dependencies);
  return project;
}

afterEach(() => roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true })));

describe('riff finish', () => {
  test('builds a read-only exact-path plan and rejects unrelated dirty files', () => {
    const project = fixture();
    const beforeHead = git(project, 'rev-parse', 'HEAD');
    const beforeStatus = git(project, 'status', '--porcelain');
    const result = buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' });
    expect(result.plan.paths).toEqual(['ROADMAP.yaml', 'src/value.mjs']);
    expect(git(project, 'rev-parse', 'HEAD')).toBe(beforeHead);
    expect(git(project, 'status', '--porcelain')).toBe(beforeStatus);
    fs.writeFileSync(path.join(project, 'notes.txt'), 'unrelated\n');
    expect(() => buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' })).toThrow(/unrelated dirty paths/);
  }, 15_000);

  test('fails closed for tampered evidence, pending finishers, roadmap edits, and pre-staged changes', () => {
    const project = fixture();
    const wave = path.join(project, '.planning', 'riff-wave');
    const mechanical = path.join(wave, 'W-finish-test.security.json');
    const semantic = path.join(wave, 'W-finish-test.security-review.routing.json');
    const mechanicalBytes = fs.readFileSync(mechanical);
    const semanticBytes = fs.readFileSync(semantic);
    fs.appendFileSync(mechanical, 'tamper');
    expect(() => buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' })).toThrow(/mechanical security evidence/);
    fs.writeFileSync(mechanical, mechanicalBytes);
    fs.appendFileSync(semantic, 'tamper');
    expect(() => buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' })).toThrow(/semantic security evidence/);
    fs.writeFileSync(semantic, semanticBytes);
    const finisher = path.join(project, '.planning', 'autonomy', 'case', 'finishers');
    fs.mkdirSync(finisher, { recursive: true });
    fs.writeFileSync(path.join(finisher, 'F-1.yaml'), 'run: W-finish-test\nfinishers:\n  - id: F-1\n    type: branch\n    branch: riff/finish-test\n    status: pending\n');
    expect(() => buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' })).toThrow(/finisher guard/);
    fs.rmSync(path.join(finisher, 'F-1.yaml'));
    fs.appendFileSync(path.join(project, 'ROADMAP.yaml'), '# unrelated\n');
    expect(() => buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' })).toThrow(/ROADMAP\.yaml contains changes/);
    fs.writeFileSync(path.join(project, 'ROADMAP.yaml'), fs.readFileSync(path.join(project, 'ROADMAP.yaml'), 'utf8').replace('# unrelated\n', ''));
    git(project, 'add', 'src/value.mjs');
    expect(() => buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' })).toThrow(/pre-staged changes/);
    git(project, 'reset', '-q', 'HEAD', '--', 'src/value.mjs');
  }, 15_000);

  test('requires a consumed receipt for completed HITL work', () => {
    const project = fixture('local_no_ff', 'HITL');
    const stateFile = path.join(project, '.planning', 'riff-wave', 'W-finish-test.json');
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    expect(state.phases[0].verification.status).toBe('consumed');
    delete state.phases[0].verification;
    fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`);
    expect(() => buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' })).toThrow(/verification approval is missing/);
  }, 15_000);

  test('prints a POSIX-quoted next command for project paths with shell metacharacters', () => {
    const project = fixture();
    const oldRoot = path.dirname(project);
    const newRoot = `${oldRoot} space;$finish`;
    fs.renameSync(oldRoot, newRoot);
    roots.splice(roots.indexOf(oldRoot), 1, newRoot);
    const relocated = path.join(newRoot, 'project');
    const canonicalProject = fs.realpathSync(relocated);
    git(relocated, 'remote', 'set-url', 'origin', path.join(newRoot, 'origin.git'));
    const checked = spawnSync(process.execPath, [path.join(frameworkRoot, 'scripts', 'riff-finish.mjs'), '--check', '--run', 'W-finish-test', '--project-root', relocated, '--base', 'main'], { encoding: 'utf8' });
    expect(checked.status, checked.stderr).toBe(0);
    expect(checked.stdout).toContain(`'${path.join(canonicalProject, '.riff', 'riff')}'`);
    expect(checked.stdout).toContain(`'--project-root' '${canonicalProject}'`);
  }, 15_000);

  test('rejects stale confirmation evidence and merges only after confirmation', () => {
    const project = fixture();
    const plan = buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' });
    fs.appendFileSync(path.join(project, 'src', 'value.mjs'), '// stale\n');
    const stale = spawnSync(process.execPath, [path.join(frameworkRoot, 'scripts', 'riff-finish.mjs'), '--confirm', plan.token, '--run', 'W-finish-test', '--project-root', project, '--base', 'main'], { encoding: 'utf8' });
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toMatch(/security evidence|stale|does not match/i);
    fs.writeFileSync(path.join(project, 'src', 'value.mjs'), 'export const value = 2;\n');
    const fresh = buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' });
    const confirmed = spawnSync(process.execPath, [path.join(frameworkRoot, 'scripts', 'riff-finish.mjs'), '--confirm', fresh.token, '--run', 'W-finish-test', '--project-root', project, '--base', 'main'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 'Injected Author',
        GIT_AUTHOR_EMAIL: 'injected-author@example.invalid',
        GIT_COMMITTER_NAME: 'Injected Committer',
        GIT_COMMITTER_EMAIL: 'injected-committer@example.invalid',
      },
    });
    expect(confirmed.status, confirmed.stderr).toBe(0);
    expect(git(project, 'branch', '--show-current')).toBe('main');
    expect(git(project, 'show', 'main:src/value.mjs')).toContain('value = 2');
    expect(git(project, 'show', '-s', '--format=%an|%ae|%cn|%ce', 'main')).toBe('RIFF Test|riff-test@example.invalid|RIFF Test|riff-test@example.invalid');
    expect(spawnSync('git', ['show-ref', '--verify', '--quiet', 'refs/heads/riff/finish-test'], { cwd: project }).status).not.toBe(0);
  }, 15_000);

  test('github_button pushes and creates a PR without merging', () => {
    const project = fixture('github_button');
    const fakeGh = path.join(path.dirname(project), 'fake-gh');
    const ghLog = path.join(path.dirname(project), 'gh.log');
    fs.writeFileSync(fakeGh, '#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.appendFileSync(process.env.GH_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);\nif (process.argv[3] === "list") { if (process.env.GH_REUSE) process.stdout.write("https://example.invalid/pr/existing\\n"); } else if (process.argv[3] === "create") process.stdout.write("https://example.invalid/pr/1\\n");\n');
    fs.chmodSync(fakeGh, 0o755);
    const plan = buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' });
    const result = spawnSync(process.execPath, [path.join(frameworkRoot, 'scripts', 'riff-finish.mjs'), '--confirm', plan.token, '--run', 'W-finish-test', '--project-root', project, '--base', 'main'], { encoding: 'utf8', env: { ...process.env, RIFF_GH_BIN: fakeGh, GH_LOG: ghLog } });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('https://example.invalid/pr/1');
    expect(git(project, 'branch', '--show-current')).toBe('riff/finish-test');
    expect(git(project, 'show', 'main:src/value.mjs')).toContain('value = 1');
    expect(fs.readFileSync(ghLog, 'utf8').trim().split('\n').map(JSON.parse)).toEqual([
      ['pr', 'list', '-R', 'acme/riff', '--head', 'riff/finish-test', '--base', 'main', '--state', 'open', '--limit', '1', '--json', 'url', '--jq', '.[0].url'],
      ['pr', 'create', '-R', 'acme/riff', '--head', 'riff/finish-test', '--base', 'main', '--title', 'RIFF finish W-finish-test', '--body', 'Completed RIFF wave W-finish-test.'],
    ]);
  }, 15_000);

  test('github_button reuses a listed PR and finish help needs no mode', () => {
    const project = fixture('github_button');
    const fakeGh = path.join(path.dirname(project), 'fake-gh-reuse');
    const ghLog = path.join(path.dirname(project), 'gh-reuse.log');
    fs.writeFileSync(fakeGh, '#!/usr/bin/env node\nconst fs = require("node:fs");\nfs.appendFileSync(process.env.GH_LOG, `${JSON.stringify(process.argv.slice(2))}\\n`);\nprocess.stdout.write("https://example.invalid/pr/existing\\n");\n');
    fs.chmodSync(fakeGh, 0o755);
    const help = spawnSync(process.execPath, [path.join(frameworkRoot, 'scripts', 'riff-finish.mjs'), '--help'], { encoding: 'utf8' });
    expect(help.status).toBe(0);
    const plan = buildFinishPlan({ projectRoot: project, runId: 'W-finish-test', base: 'main' });
    const result = spawnSync(process.execPath, [path.join(frameworkRoot, 'scripts', 'riff-finish.mjs'), '--confirm', plan.token, '--run', 'W-finish-test', '--project-root', project, '--base', 'main'], { encoding: 'utf8', env: { ...process.env, RIFF_GH_BIN: fakeGh, GH_LOG: ghLog } });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(ghLog, 'utf8').trim().split('\n').map(JSON.parse)).toEqual([
      ['pr', 'list', '-R', 'acme/riff', '--head', 'riff/finish-test', '--base', 'main', '--state', 'open', '--limit', '1', '--json', 'url', '--jq', '.[0].url'],
    ]);
  }, 15_000);
});

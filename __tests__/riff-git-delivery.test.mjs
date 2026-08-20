import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, test } from 'vitest';
import {
  appendActionEvidence,
  captureOwnedState,
  commitActionLedger,
  freezeActionLedger,
  initializeActionLedger,
  preparePhaseBranch,
  readActionLedger,
  validateActionDelivery,
} from '../scripts/lib/git-delivery.mjs';
import { installGitHookDispatchers } from '../scripts/lib/git-hooks.mjs';
import { publishPhasePullRequests } from '../scripts/riff-wave.mjs';

const frameworkRoot = path.resolve(import.meta.dirname, '..');
const roots = [];
const hash = (character) => character.repeat(64);
function git(root, ...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim(); }

function fixture({ preparationHook = false } = {}) {
  const container = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-git-delivery-'));
  roots.push(container);
  const project = path.join(container, 'project');
  fs.mkdirSync(project);
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'config', 'user.name', 'RIFF Test');
  git(project, 'config', 'user.email', 'riff-test@example.invalid');
  git(project, 'config', 'core.hooksPath', '.githooks');
  fs.mkdirSync(path.join(project, '.githooks'));
  const hookLog = path.join(container, 'git-hooks.log');
  const userHook = `#!/bin/sh\nprintf '%s\\n' "$(basename "$0")" >> "${hookLog}"\nif [ -n "\${RIFF_GIT_HOOK_NONCE:-}" ]; then exit 8; fi\nif [ "\${RIFF_TEST_BLOCK_HOOK:-}" = "1" ]; then exit 9; fi\n`;
  fs.writeFileSync(path.join(project, '.githooks', 'pre-commit'), userHook, { mode: 0o755 });
  fs.writeFileSync(path.join(project, '.githooks', 'commit-msg'), userHook, { mode: 0o755 });
  fs.symlinkSync(frameworkRoot, path.join(project, '.riff'));
  fs.mkdirSync(path.join(project, '.planning', 'phases', '1-value'), { recursive: true });
  fs.writeFileSync(path.join(project, '.gitignore'), '.riff\n.githooks/\n.planning/riff-next/\n.planning/riff-wave/\n');
  fs.writeFileSync(path.join(project, 'value.txt'), 'zero\n');
  fs.writeFileSync(path.join(project, 'ROADMAP.yaml'), 'name: Delivery\nphases: []\n');
  const config = preparationHook ? { scope: 'production', hooks: ['project-hooks/pr-check.sh'] } : { scope: 'production' };
  fs.writeFileSync(path.join(project, '.planning', 'config.json'), `${JSON.stringify(config)}\n`);
  if (preparationHook) {
    fs.mkdirSync(path.join(project, 'project-hooks'));
    fs.writeFileSync(path.join(project, 'project-hooks', 'pr-check.sh'), `#!/bin/sh\nprintf 'phase-pr-prepare\\n' >> "${path.join(container, 'pr-hooks.log')}"\nif [ "\${RIFF_TEST_PR_HOOK_FAIL:-}" = "1" ]; then exit 7; fi\n`, { mode: 0o755 });
  }
  git(project, 'add', '.');
  git(project, 'commit', '-qm', 'base');
  installGitHookDispatchers({ projectRoot: project, frameworkRoot });
  fs.writeFileSync(hookLog, '');
  return { container, project, hookLog };
}

function captureTwoActions(project) {
  const baseOid = git(project, 'rev-parse', 'HEAD');
  const branch = 'riff/phase-1-value--w-test-a1';
  preparePhaseBranch({ projectRoot: project, branch, baseBranch: 'main', baseOid });
  initializeActionLedger({
    projectRoot: project,
    phase: '1-value',
    branch,
    baseBranch: 'main',
    baseOid,
    provider: 'codex',
    model: 'gpt-test',
    agent: 'worker',
    planPath: '.planning/phases/1-value/PLAN.md',
    planSha256: hash('a'),
    routingSha256: hash('b'),
    route: 'worker:fixed',
  });
  const firstBefore = captureOwnedState({ projectRoot: project, sourceRoot: project, ownedPaths: ['value.txt'] });
  fs.writeFileSync(path.join(project, 'value.txt'), 'one\n');
  appendActionEvidence({
    projectRoot: project,
    phase: '1-value',
    task: { number: 1, label: 'Task 1: Write one' },
    waveNumber: 1,
    ordinal: 1,
    ownedPaths: ['value.txt'],
    changedPaths: ['value.txt'],
    beforeState: firstBefore,
    afterRoot: project,
    workerOutputSha256: hash('c'),
  });
  const secondBefore = captureOwnedState({ projectRoot: project, sourceRoot: project, ownedPaths: ['value.txt'] });
  fs.writeFileSync(path.join(project, 'value.txt'), 'two\n');
  appendActionEvidence({
    projectRoot: project,
    phase: '1-value',
    task: { number: 2, label: 'Task 2: Write two' },
    waveNumber: 2,
    ordinal: 2,
    ownedPaths: ['value.txt'],
    changedPaths: ['value.txt'],
    beforeState: secondBefore,
    afterRoot: project,
    workerOutputSha256: hash('d'),
  });
  const phaseDir = path.join(project, '.planning', 'phases', '1-value');
  fs.writeFileSync(path.join(phaseDir, 'SUMMARY.md'), '# Summary\n\n## Completed Criteria\nDone.\n\n## Check Results\nPass.\n\n## Smoke Results\nPass.\n');
  fs.writeFileSync(path.join(phaseDir, 'REVIEW.md'), '## Verdict\nPASS\n\n## Evidence\nvalue.txt:1\n\n## Residual Risk\nNone.\n');
  fs.writeFileSync(path.join(phaseDir, 'SCOPE-CHECK.json'), '{"verdict":"PASS"}\n');
  freezeActionLedger(project, '1-value', { validationEvidencePaths: evidencePaths() });
  return { baseOid, branch };
}

function evidencePaths() {
  return [
    '.planning/phases/1-value/SUMMARY.md',
    '.planning/phases/1-value/REVIEW.md',
    '.planning/phases/1-value/SCOPE-CHECK.json',
  ];
}

afterEach(() => {
  delete process.env.RIFF_TEST_BLOCK_HOOK;
  delete process.env.RIFF_TEST_PR_HOOK_FAIL;
  delete process.env.RIFF_GH_BIN;
  delete process.env.RIFF_TEST_GH_LOG;
  delete process.env.RIFF_TEST_GH_REUSE;
  roots.splice(0).forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

describe('native RIFF Git delivery', () => {
  test('resync repairs managed dispatchers in core.hooksPath without changing chained user hooks', () => {
    const { project } = fixture();
    const hooks = path.join(project, '.githooks');
    const userPreCommit = fs.readFileSync(path.join(hooks, 'pre-commit.user'));
    const userCommitMsg = fs.readFileSync(path.join(hooks, 'commit-msg.user'));
    fs.writeFileSync(path.join(hooks, 'pre-commit'), '#!/bin/sh\n# RIFF managed Git-hook dispatcher.\nexit 0\n', { mode: 0o755 });
    execFileSync('bash', [path.join(frameworkRoot, 'riff-resync.sh')], { cwd: project, stdio: 'pipe' });
    const expected = fs.readFileSync(path.join(frameworkRoot, 'hooks', 'git-hook-dispatch.sh'));
    expect(fs.readFileSync(path.join(hooks, 'pre-commit'))).toEqual(expected);
    expect(fs.readFileSync(path.join(hooks, 'commit-msg'))).toEqual(expected);
    expect(fs.readFileSync(path.join(hooks, 'pre-commit.user'))).toEqual(userPreCommit);
    expect(fs.readFileSync(path.join(hooks, 'commit-msg.user'))).toEqual(userCommitMsg);
  }, 30_000);

  test('keeps sequential same-path actions as separate deterministic commits and invokes chained hooks', () => {
    const { project, hookLog } = fixture();
    const { baseOid } = captureTwoActions(project);
    const ledger = commitActionLedger({ projectRoot: project, phase: '1-value', evidencePaths: evidencePaths() });
    expect(ledger.actions).toHaveLength(2);
    expect(git(project, 'show', `${ledger.actions[0].commit_oid}:value.txt`)).toBe('one');
    expect(git(project, 'show', `${ledger.actions[1].commit_oid}:value.txt`)).toBe('two');
    expect(git(project, 'rev-list', '--count', `${baseOid}..HEAD`)).toBe('3');
    expect(git(project, 'log', '--reverse', '--format=%B', `${baseOid}..HEAD`)).toMatch(/Action: task-1[\s\S]*Action: task-2[\s\S]*Action: phase-evidence/);
    expect(fs.readFileSync(hookLog, 'utf8').trim().split('\n')).toEqual([
      'pre-commit.user', 'commit-msg.user', 'pre-commit.user', 'commit-msg.user', 'pre-commit.user', 'commit-msg.user',
    ]);
    expect(validateActionDelivery(project, '1-value').head).toBe(ledger.phase_commit_oid);
  }, 30_000);

  test('recovers after HEAD advances before ledger persistence without duplicating the action commit', () => {
    const { project } = fixture();
    const { baseOid } = captureTwoActions(project);
    expect(() => commitActionLedger({
      projectRoot: project,
      phase: '1-value',
      evidencePaths: evidencePaths(),
      testHooks: { afterCommit: ({ kind }) => { if (kind === 'action') throw new Error('simulated crash'); } },
    })).toThrow(/simulated crash/);
    expect(git(project, 'rev-list', '--count', `${baseOid}..HEAD`)).toBe('1');
    expect(readActionLedger(project, '1-value').actions[0].commit_oid).toBeNull();
    const recovered = commitActionLedger({ projectRoot: project, phase: '1-value', evidencePaths: evidencePaths() });
    expect(git(project, 'rev-list', '--count', `${baseOid}..HEAD`)).toBe('3');
    expect(recovered.actions.map((action) => action.commit_oid)).toHaveLength(2);
    expect(validateActionDelivery(project, '1-value').head).toBe(recovered.phase_commit_oid);
  }, 30_000);

  test('fails closed on a user pre-commit hook and resumes after the hook passes', () => {
    const { project } = fixture();
    const { baseOid } = captureTwoActions(project);
    process.env.RIFF_TEST_BLOCK_HOOK = '1';
    expect(() => commitActionLedger({ projectRoot: project, phase: '1-value', evidencePaths: evidencePaths() })).toThrow(/git commit/);
    expect(git(project, 'rev-parse', 'HEAD')).toBe(baseOid);
    delete process.env.RIFF_TEST_BLOCK_HOOK;
    const ledger = commitActionLedger({ projectRoot: project, phase: '1-value', evidencePaths: evidencePaths() });
    expect(validateActionDelivery(project, '1-value').head).toBe(ledger.phase_commit_oid);
  }, 30_000);

  test('recovers a completed phase evidence commit without creating a duplicate', () => {
    const { project } = fixture();
    const { baseOid } = captureTwoActions(project);
    expect(() => commitActionLedger({
      projectRoot: project,
      phase: '1-value',
      evidencePaths: evidencePaths(),
      testHooks: { afterCommit: ({ kind }) => { if (kind === 'phase-evidence') throw new Error('simulated phase-state crash'); } },
    })).toThrow(/phase-state crash/);
    expect(git(project, 'rev-list', '--count', `${baseOid}..HEAD`)).toBe('3');
    expect(readActionLedger(project, '1-value').phase_commit_oid).toBeNull();
    const recovered = commitActionLedger({ projectRoot: project, phase: '1-value', evidencePaths: evidencePaths() });
    expect(git(project, 'rev-list', '--count', `${baseOid}..HEAD`)).toBe('3');
    expect(validateActionDelivery(project, '1-value').head).toBe(recovered.phase_commit_oid);
  }, 30_000);

  test('runs phase PR preparation hooks and refuses PR creation until they pass', () => {
    const { container, project } = fixture({ preparationHook: true });
    const { baseOid, branch } = captureTwoActions(project);
    const ledger = commitActionLedger({ projectRoot: project, phase: '1-value', evidencePaths: evidencePaths() });
    const bare = path.join(container, 'origin.git');
    execFileSync('git', ['init', '--bare', '-q', bare]);
    git(project, 'remote', 'add', 'origin', bare);
    git(project, 'push', '-q', 'origin', `${baseOid}:refs/heads/main`);
    git(project, 'remote', 'set-url', 'origin', 'https://github.com/acme/example.git');
    git(project, 'remote', 'set-url', '--push', 'origin', bare);
    const fakeGh = path.join(container, 'fake-gh');
    const ghLog = path.join(container, 'gh.log');
    fs.writeFileSync(fakeGh, `#!/usr/bin/env node
const fs=require("node:fs");
const args=process.argv.slice(2);
fs.appendFileSync(process.env.RIFF_TEST_GH_LOG, JSON.stringify(args)+"\\n");
if(args[0]==="api") process.stdout.write(args[1].endsWith("/main") ? "${baseOid}\\n" : "${ledger.phase_commit_oid}\\n");
if(args[1]==="list") process.stdout.write(process.env.RIFF_TEST_GH_REUSE ? JSON.stringify([{url:"https://example.invalid/pr/1",state:"OPEN",baseRefName:"main",headRefName:"${branch}",headRefOid:"${ledger.phase_commit_oid}",isDraft:false}])+"\\n" : "[]\\n");
if(args[1]==="create") process.stdout.write("https://example.invalid/pr/1\\n");
if(args[1]==="view") process.stdout.write(JSON.stringify({url:"https://example.invalid/pr/1",state:"OPEN",baseRefName:"main",headRefName:"${branch}",headRefOid:"${ledger.phase_commit_oid}",isDraft:false})+"\\n");
`, { mode: 0o755 });
    process.env.RIFF_GH_BIN = fakeGh;
    process.env.RIFF_TEST_GH_LOG = ghLog;
    const state = {
      schema_version: 1,
      run: 'W-pr-hook-test',
      state: 'running',
      mode: 'wave',
      provider_override: null,
      selected_provider: 'codex',
      requested_phase_ids: [],
      max_phases: null,
      max_runs: null,
      waves: [],
      phases: [{ id: '1', status: 'completed', attempts: [{ native_phase: '1-value', status: 'completed', delivery: { state: 'committed', branch, base_branch: 'main', base_oid: baseOid, head_oid: ledger.phase_commit_oid } }] }],
      current: null,
      stop_reason: null,
      git: { schema_version: 1, topology: 'stacked_phase_branches', base_branch: 'main', base_oid: baseOid, tip_branch: branch, tip_oid: ledger.phase_commit_oid },
      final_security: { verdict: 'PASS', artifact_sha256: hash('e') },
      final_semantic_security: { verdict: 'PASS', artifact_sha256: hash('f') },
      started_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const roadmap = { phases: [{ id: '1', slug: 'value', title: 'Value', dependsOn: [] }] };
    process.env.RIFF_TEST_PR_HOOK_FAIL = '1';
    expect(() => publishPhasePullRequests(project, roadmap, state)).toThrow(/preparation hook failed/);
    expect(fs.existsSync(ghLog)).toBe(false);
    delete process.env.RIFF_TEST_PR_HOOK_FAIL;
    publishPhasePullRequests(project, roadmap, state);
    const calls = fs.readFileSync(ghLog, 'utf8').trim().split('\n').map(JSON.parse);
    expect(calls.filter((args) => args[0] === 'pr').map((args) => args[1])).toEqual(['list', 'create', 'view']);
    expect(state.phases[0].attempts[0].delivery.publication.state).toBe('pr_open');
    const receipt = JSON.parse(fs.readFileSync(path.join(project, state.phases[0].attempts[0].delivery.publication.hook_receipt_path), 'utf8'));
    expect(receipt.status).toBe('pass');
    expect(receipt.results[0].hook).toBe('project-hooks/pr-check.sh');
    process.env.RIFF_TEST_GH_REUSE = '1';
    state.phases[0].attempts[0].delivery.publication.state = 'pr_pending';
    publishPhasePullRequests(project, roadmap, state);
    const retriedCalls = fs.readFileSync(ghLog, 'utf8').trim().split('\n').map(JSON.parse);
    expect(retriedCalls.filter((args) => args[0] === 'pr').map((args) => args[1])).toEqual(['list', 'create', 'view', 'list', 'edit', 'view']);
  }, 30_000);
});

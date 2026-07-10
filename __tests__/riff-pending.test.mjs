import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', 'scripts', 'riff-pending.mjs');

const cleanupRoots = [];

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    rmSync(root, { recursive: true, force: true });
  }
});

function tempProject(prefix = 'riff-pending-project-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}

function tempRegistry(projectRoots) {
  const dir = mkdtempSync(path.join(tmpdir(), 'riff-pending-registry-'));
  cleanupRoots.push(dir);
  const file = path.join(dir, 'registry.txt');
  writeFileSync(file, `${projectRoots.join('\n')}\n`, 'utf8');
  return file;
}

function writeFinishers(projectRoot, runName, content) {
  const dir = path.join(projectRoot, '.planning', 'autonomy', runName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'finishers.yaml'), content, 'utf8');
}

function git(cwd, args) {
  execFileSync('git', args, { cwd, stdio: 'ignore' });
}

function gitCommit(cwd, message) {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', message], {
    cwd,
    stdio: 'ignore',
  });
}

/** Run the CLI in --json mode against the given registry file, return the parsed report. */
function runPending(registryFile, extraArgs = []) {
  const stdout = execFileSync('node', [script, '--json', '--registry', registryFile, ...extraArgs], {
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

describe('finisher parsing', () => {
  test('entry starting with a non-id field (e.g. "- type: review") is still counted', () => {
    const project = tempProject();
    writeFinishers(project, 'run-a', `run: 2026-07-10-1430
finishers:
  - type: review
    id: F1
    phase: 12-checkout-flow
    waiting_on: "needs review"
    status: pending
    created: 2026-07-10
`);
    const registry = tempRegistry([project]);
    const report = runPending(registry);

    const item = report.items.find((entry) => entry.phase === '12-checkout-flow');
    expect(item).toBeTruthy();
    expect(item.type).toBe('review');
    expect(item.waiting_on).toBe('needs review');
    expect(report.warnings).toEqual([]);
  });

  test('entry missing "status" is reported as malformed and not counted', () => {
    const project = tempProject();
    writeFinishers(project, 'run-b', `run: 2026-07-10-1430
finishers:
  - id: F2
    type: security
    waiting_on: "something risky"
`);
    const registry = tempRegistry([project]);
    const report = runPending(registry);

    expect(report.items).toEqual([]);
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toMatch(/malformed finisher entry in .*finishers\.yaml:\d+ \(missing status\) — fix it, it is NOT counted/);
  });
});

describe('decisions scan', () => {
  test('root DECISIONS.md is ignored; .planning/autonomy/**/DECISIONS.md unchecked boxes are counted', () => {
    const project = tempProject();
    writeFileSync(path.join(project, 'DECISIONS.md'), '- [ ] unrelated root-level noise\n', 'utf8');

    const runDir = path.join(project, '.planning', 'autonomy', 'run-c');
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, 'DECISIONS.md'), '- [ ] confirm pricing tier with finance\n- [x] already checked, skip me\n', 'utf8');

    const registry = tempRegistry([project]);
    const report = runPending(registry);

    const decisionItems = report.items.filter((entry) => entry.type === 'decision');
    expect(decisionItems).toHaveLength(1);
    expect(decisionItems[0].waiting_on).toBe('confirm pricing tier with finance');
    expect(decisionItems.every((entry) => !entry.artifact.startsWith('..'))).toBe(true);
    expect(report.items.some((entry) => entry.waiting_on === 'unrelated root-level noise')).toBe(false);
  });
});

describe('branch hygiene split', () => {
  test('a generic unmerged riff/* branch lands in branches, not items', () => {
    const project = tempProject();
    git(project, ['init', '-b', 'main']);
    writeFileSync(path.join(project, 'README.md'), 'hello\n', 'utf8');
    git(project, ['add', '.']);
    gitCommit(project, 'initial');
    git(project, ['checkout', '-b', 'riff/phase-9-hygiene']);
    writeFileSync(path.join(project, 'hygiene.txt'), 'wip\n', 'utf8');
    git(project, ['add', '.']);
    gitCommit(project, 'unmerged hygiene work');
    git(project, ['checkout', 'main']);

    const registry = tempRegistry([project]);
    const report = runPending(registry);

    expect(report.items.some((entry) => entry.type === 'branch')).toBe(false);
    expect(report.branches.some((entry) => entry.branch === 'riff/phase-9-hygiene')).toBe(true);
  });
});

describe('merged-branch integrity check', () => {
  test('a pending finisher referencing an already-merged branch is flagged INCONSISTENT', () => {
    const project = tempProject();
    git(project, ['init', '-b', 'main']);
    writeFileSync(path.join(project, 'README.md'), 'hello\n', 'utf8');
    git(project, ['add', '.']);
    gitCommit(project, 'initial');

    git(project, ['checkout', '-b', 'riff/phase-1']);
    writeFileSync(path.join(project, 'feature.txt'), 'built\n', 'utf8');
    git(project, ['add', '.']);
    gitCommit(project, 'phase 1 work');

    git(project, ['checkout', 'main']);
    git(project, ['merge', '--no-ff', '-m', 'merge phase 1', 'riff/phase-1']);
    // branch stays around after merge — that's the integrity error we're detecting

    writeFinishers(project, 'run-d', `run: 2026-07-10-1430
finishers:
  - id: F3
    type: review
    phase: 1-phase
    branch: riff/phase-1
    waiting_on: "human sign-off"
    status: pending
    created: 2026-07-10
`);

    const registry = tempRegistry([project]);
    const report = runPending(registry);

    const item = report.items.find((entry) => entry.phase === '1-phase');
    expect(item).toBeTruthy();
    expect(item.type).toBe('INCONSISTENT');
    expect(item.waiting_on).toMatch(/pending finisher on already-merged branch riff\/phase-1 — integrity error, resolve the finisher/);
  });

  test('a pending finisher whose branch no longer exists locally is left as a normal item', () => {
    const project = tempProject();
    git(project, ['init', '-b', 'main']);
    writeFileSync(path.join(project, 'README.md'), 'hello\n', 'utf8');
    git(project, ['add', '.']);
    gitCommit(project, 'initial');

    writeFinishers(project, 'run-e', `run: 2026-07-10-1430
finishers:
  - id: F4
    type: review
    phase: 2-phase
    branch: riff/phase-2-deleted
    waiting_on: "human sign-off"
    status: pending
    created: 2026-07-10
`);

    const registry = tempRegistry([project]);
    const report = runPending(registry);

    const item = report.items.find((entry) => entry.phase === '2-phase');
    expect(item).toBeTruthy();
    expect(item.type).toBe('review');
  });
});

describe('CLI plumbing', () => {
  test('always exits 0 even with malformed entries present', () => {
    const project = tempProject();
    writeFinishers(project, 'run-f', `run: 2026-07-10-1430
finishers:
  - id: F5
    type: security
`);
    const registry = tempRegistry([project]);
    expect(() => execFileSync('node', [script, '--json', '--registry', registry], { encoding: 'utf8' })).not.toThrow();
  });

  test('an empty registry prints a clean inbox', () => {
    const registry = tempRegistry([]);
    const stdout = execFileSync('node', [script, '--registry', registry], { encoding: 'utf8' });
    expect(stdout).toContain('riff pending: inbox clean');
  });

  test('--branches appends the hygiene section header in text output', () => {
    const project = tempProject();
    git(project, ['init', '-b', 'main']);
    writeFileSync(path.join(project, 'README.md'), 'hello\n', 'utf8');
    git(project, ['add', '.']);
    gitCommit(project, 'initial');
    git(project, ['checkout', '-b', 'riff/phase-hygiene-flag']);
    writeFileSync(path.join(project, 'hygiene-flag.txt'), 'wip\n', 'utf8');
    git(project, ['add', '.']);
    gitCommit(project, 'unmerged hygiene work');
    git(project, ['checkout', 'main']);

    const registry = tempRegistry([project]);
    const withoutFlag = execFileSync('node', [script, '--registry', registry], { encoding: 'utf8' });
    const withFlag = execFileSync('node', [script, '--registry', registry, '--branches'], { encoding: 'utf8' });

    expect(withoutFlag).not.toContain('unmerged riff/* branches (hygiene)');
    expect(withFlag).toContain('--- unmerged riff/* branches (hygiene) ---');
    expect(withFlag).toContain('riff/phase-hygiene-flag');
  });
});

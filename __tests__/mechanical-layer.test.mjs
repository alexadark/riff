import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scopeCheckScript = path.join(repoRoot, 'scripts', 'scope-check.mjs');
const gatesUpdateScript = path.join(repoRoot, 'scripts', 'gates-update.mjs');
const riffInitScript = path.join(repoRoot, 'scripts', 'riff-init.mjs');
const reconcileGateScript = path.join(repoRoot, 'scripts', 'reconcile-gate.mjs');
const validateRoadmapScript = path.join(repoRoot, 'lib', 'validate-roadmap.sh');
const csvAppendScript = path.join(repoRoot, 'scripts', 'csv-append.sh');
const typecheckGateScript = path.join(repoRoot, 'hooks', 'typecheck-gate.sh');
const testGateScript = path.join(repoRoot, 'hooks', 'test-gate.sh');
const todoGateScript = path.join(repoRoot, 'hooks', 'todo-orphan-guard.sh');
const destructiveGuardScript = path.join(repoRoot, 'hooks', 'destructive-guard.sh');
const { buildDashboardMetadata } = await import(pathToFileURL(path.join(repoRoot, 'scripts', 'lib', 'dashboard.mjs')));

function tempRoot(prefix = 'riff-test-') {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function withTempRoot(fn) {
  const root = tempRoot();
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writePhase(root, { plan, summary, name = '1-demo' }) {
  const phaseDir = path.join(root, '.planning', 'phases', name);
  mkdirSync(phaseDir, { recursive: true });
  writeFileSync(path.join(phaseDir, 'PLAN.md'), plan, 'utf8');
  if (summary !== undefined) writeFileSync(path.join(phaseDir, 'SUMMARY.md'), summary, 'utf8');
  return phaseDir;
}

function runScope(root, phase = '1-demo') {
  const result = spawnSync('node', [
    scopeCheckScript,
    '--project-root',
    root,
    '--phase',
    phase,
  ], { encoding: 'utf8' });
  const report = JSON.parse(readFileSync(path.join(root, '.planning', 'phases', phase, 'SCOPE-CHECK.json'), 'utf8'));
  return { result, report };
}

const matchingPlan = `# Plan

## Tasks

### Task 1: Add CLI guard
### Task 2: Update lib/parser.js

## Smoke

- \`npm test\` -> exits 0
- \`node lib/parser.js --check\` -> exits 0
`;

const matchingSummary = `# Summary

## What Was Built

- Added CLI guard.
- Updated lib/parser.js.

## Status

**completed**

## Smoke Results

| Command | Expected | Observed | Status |
| --- | --- | --- | --- |
| \`npm test\` | exits 0 | exits 0 | pass |
| \`node lib/parser.js --check\` | exits 0 | exits 0 | pass |
`;

describe('scope-check mechanical contract', () => {
  test('writes schema v2 MATCH reports and exits 0 when tasks and smoke rows pair', () => withTempRoot((root) => {
    writePhase(root, { plan: matchingPlan, summary: matchingSummary });

    const { result, report } = runScope(root);

    expect(result.status).toBe(0);
    expect(report.schema_version).toBe(2);
    expect(report.verdict).toBe('MATCH');
    expect(report.planned_tasks).toHaveLength(2);
    expect(report.completed_tasks).toHaveLength(2);
    expect(report.planned_smokes.map((smoke) => smoke.command)).toEqual([
      'npm test',
      'node lib/parser.js --check',
    ]);
    expect(report.smoke_results.map((smoke) => smoke.command)).toEqual([
      'npm test',
      'node lib/parser.js --check',
    ]);
    expect(report.unmatched_tasks).toEqual([]);
    expect(report.unmatched_smokes).toEqual([]);
    expect(report.malformed_reason).toBeNull();
  }));

  test('returns DROPPED and exits 1 for unacknowledged tasks or missing smoke results', () => withTempRoot((root) => {
    const summary = `# Summary

## What Was Built

- Added CLI guard.

## Status

**partial**

## Smoke Results

| Command | Expected | Observed | Status |
| --- | --- | --- | --- |
| \`npm test\` | exits 0 | exits 0 | pass |
`;
    writePhase(root, { plan: matchingPlan, summary });

    const { result, report } = runScope(root);

    expect(result.status).toBe(1);
    expect(report.verdict).toBe('DROPPED');
    expect(report.unmatched_tasks).toHaveLength(1);
    expect(report.unmatched_tasks[0].id).toContain('parser');
    expect(report.unmatched_smokes).toHaveLength(1);
    expect(report.unmatched_smokes[0].command).toBe('node lib/parser.js --check');
  }));

  test('returns MALFORMED and exits 1 for broken plan or impossible completed summary', () => withTempRoot((root) => {
    writePhase(root, {
      name: '1-no-tasks',
      plan: '# Plan\n\n## Notes\n\nNo task section here.\n',
      summary: '# Summary\n\n## Status\n\n**completed**\n',
    });
    const malformedPlan = runScope(root, '1-no-tasks');

    writePhase(root, {
      name: '2-failed-smoke',
      plan: matchingPlan,
      summary: `# Summary

## What Was Built

- Added CLI guard.
- Updated lib/parser.js.

## Status

**completed**

## Smoke Results

| Command | Expected | Observed | Status |
| --- | --- | --- | --- |
| \`npm test\` | exits 0 | assertion failed | fail |
| \`node lib/parser.js --check\` | exits 0 | exits 0 | pass |
`,
    });
    const failedCompleted = runScope(root, '2-failed-smoke');

    expect(malformedPlan.result.status).toBe(1);
    expect(malformedPlan.report.verdict).toBe('MALFORMED');
    expect(malformedPlan.report.malformed_reason).toMatch(/no parseable Tasks section/);
    expect(failedCompleted.result.status).toBe(1);
    expect(failedCompleted.report.verdict).toBe('MALFORMED');
    expect(failedCompleted.report.failed_smokes).toHaveLength(1);
  }));

  test('tolerates legacy plans with no Smoke section when tasks are acknowledged', () => withTempRoot((root) => {
    const plan = `# Plan

## Tasks

### Task 1: Update documentation
`;
    const summary = `# Summary

## What Was Built

- Updated documentation.

## Status

**completed**
`;
    writePhase(root, { plan, summary });

    const { result, report } = runScope(root);

    expect(result.status).toBe(0);
    expect(report.verdict).toBe('MATCH');
    expect(report.planned_smokes).toEqual([]);
    expect(report.unmatched_smokes).toEqual([]);
    expect(report.smoke_too_thin).toBe(false);
  }));
});

function createGatesProject(root) {
  writeFileSync(path.join(root, 'ROADMAP.yaml'), 'phases: []\n', 'utf8');
  const phaseDir = path.join(root, '.planning', 'phases', '7-hardening');
  mkdirSync(phaseDir, { recursive: true });
  return phaseDir;
}

function runGates(args, cwd) {
  return spawnSync('node', [gatesUpdateScript, ...args], { cwd, encoding: 'utf8' });
}

describe('gates-update mechanical contract', () => {
  test('initializes a GATES.md ledger compatible with the dashboard parser', () => withTempRoot((root) => {
    const phaseDir = createGatesProject(root);
    const init = runGates(['--init', phaseDir], root);

    expect(init.status).toBe(0);
    expect(JSON.parse(init.stdout)).toMatchObject({
      ok: true,
      phaseDir: '.planning/phases/7-hardening',
      scope: 'production',
    });

    const gatesPath = path.join(phaseDir, 'GATES.md');
    const gates = readFileSync(gatesPath, 'utf8');
    expect(gates).toContain('| Gate | Status | Required | Command | Exit Code | Artifact | Updated At | Reason |');
    expect(gates).toContain('| plan-review | pending | yes |');
    expect(gates).toContain('| dashboard-explain | skipped | no |');

    const metadata = buildDashboardMetadata({
      root,
      phase: { id: 7, dir: '.planning/phases/7-hardening' },
      scope: 'production',
    });
    expect(metadata.gates['plan-review']).toMatchObject({ status: 'pending', required: true });
    expect(metadata.gates['dashboard-explain']).toMatchObject({ status: 'skipped', required: false });
    expect(metadata.blockingStatus).toBe('blocked');
  }));

  test('updates every documented status and summarizes non-pending gates', () => withTempRoot((root) => {
    const phaseDir = createGatesProject(root);
    runGates(['--init', phaseDir], root);

    for (const status of ['pending', 'running', 'pass', 'warn', 'fail', 'skipped']) {
      const result = runGates([
        '--phase',
        phaseDir,
        '--gate',
        'scope-check',
        '--status',
        status,
        '--reason',
        `status is ${status}`,
        '--command',
        `command-${status}`,
        '--exit-code',
        status === 'pass' ? '0' : '1',
        '--artifact',
        'SCOPE-CHECK.json',
      ], root);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        gate: 'scope-check',
        status,
        reason: `status is ${status}`,
        command: `command-${status}`,
        exitCode: status === 'pass' ? '0' : '1',
        artifact: 'SCOPE-CHECK.json',
      });
    }

    const summarize = runGates(['--summarize', phaseDir], root);
    const summarizeAll = runGates(['--summarize', phaseDir, '--all'], root);

    expect(summarize.status).toBe(0);
    expect(summarize.stdout).toContain('scope-check: skipped — status is skipped');
    expect(summarize.stdout).not.toContain('plan-review: pending');
    expect(summarizeAll.status).toBe(0);
    expect(summarizeAll.stdout).toContain('plan-review: pending');
    expect(summarizeAll.stdout).toContain('scope-check: skipped — status is skipped');
  }));

  test('rejects statuses outside pending|running|pass|warn|fail|skipped', () => withTempRoot((root) => {
    const phaseDir = createGatesProject(root);
    runGates(['--init', phaseDir], root);

    const result = runGates([
      '--phase',
      phaseDir,
      '--gate',
      'scope-check',
      '--status',
      'done',
    ], root);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Invalid status');
  }));
});

describe('hook reconcile gate', () => {
  test('records a failing hook-reconcile gate for HIGH hook findings in the diff', () => withTempRoot((root) => {
    const phaseDir = createGatesProject(root);
    execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'riff@example.test'], { cwd: root });
    execFileSync('git', ['config', 'user.name', 'RIFF Test'], { cwd: root });
    execFileSync('git', ['add', 'ROADMAP.yaml'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'chore: base'], { cwd: root, stdio: 'ignore' });
    const base = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

    const routePath = path.join(root, 'app', 'api', 'items', 'route.ts');
    mkdirSync(path.dirname(routePath), { recursive: true });
    writeFileSync(routePath, 'export async function GET() { return Response.json({ ok: true }); }\n', 'utf8');
    execFileSync('git', ['add', 'app/api/items/route.ts'], { cwd: root });
    execFileSync('git', ['commit', '-m', 'feat: add route'], { cwd: root, stdio: 'ignore' });

    const result = spawnSync('node', [
      reconcileGateScript,
      '--project-root',
      root,
      '--phase',
      phaseDir,
      '--base',
      base,
      '--head',
      'HEAD',
    ], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({ gate: 'hook-reconcile', status: 'fail' });
    const gates = readFileSync(path.join(phaseDir, 'GATES.md'), 'utf8');
    expect(gates).toContain('| hook-reconcile | fail | yes |');
    expect(gates).toContain('HIGH');
  }));
});

describe('roadmap validator structural checks', () => {
  function runValidate(root, text) {
    const file = path.join(root, 'ROADMAP.yaml');
    writeFileSync(file, text, 'utf8');
    return spawnSync('/bin/bash', [validateRoadmapScript, file], { encoding: 'utf8' });
  }

  test('rejects duplicate ids, dangling deps, and empty phases', () => withTempRoot((root) => {
    const duplicate = runValidate(root, `phases:
  - id: 1
    slug: one
    title: One
    status: todo
  - id: 1
    slug: two
    title: Two
    status: todo
`);
    const dangling = runValidate(root, `phases:
  - id: 1
    slug: one
    title: One
    status: todo
    depends_on: [99]
`);
    const empty = runValidate(root, 'phases: []\n');

    expect(duplicate.status).toBe(1);
    expect(duplicate.stderr).toContain('duplicate phase id `1`');
    expect(dangling.status).toBe(1);
    expect(dangling.stderr).toContain('depends_on missing phase id `99`');
    expect(empty.status).toBe(1);
    expect(empty.stderr).toContain('must contain at least one phase');
  }));

  test('accepts decimal ids and legal dependency graph', () => withTempRoot((root) => {
    const result = runValidate(root, `phases:
  - id: 1
    slug: base
    title: Base
    status: done
  - id: 96.7
    slug: decimal-phase
    title: "Hash # inside title"
    status: todo
    depends_on: [1]
`);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('[validate-roadmap] OK');
  }));
});

describe('roadmap validator command wiring', () => {
  test('next and wave run validate-roadmap as a hard Step 1 gate', () => {
    const nextCommand = readFileSync(path.join(repoRoot, 'commands', 'next.md'), 'utf8');
    const waveCommand = readFileSync(path.join(repoRoot, 'commands', 'wave.md'), 'utf8');

    for (const commandText of [nextCommand, waveCommand]) {
      expect(commandText).toContain('bash .riff/lib/validate-roadmap.sh ROADMAP.yaml');
      expect(commandText).toContain('ROADMAP invalid, STOP');
      expect(commandText).toContain('exit 1');
    }
  });
});

describe('csv-append mechanical contract', () => {
  test('appends rows only and leaves header ownership to the caller', () => withTempRoot((root) => {
    const csvPath = path.join(root, 'usage.csv');
    writeFileSync(csvPath, 'date,total\n', 'utf8');

    execFileSync('/bin/bash', [csvAppendScript, csvPath, '2026-06-10,42']);
    execFileSync('/bin/bash', [csvAppendScript, csvPath, '2026-06-11,43']);

    expect(readFileSync(csvPath, 'utf8')).toBe('date,total\n2026-06-10,42\n2026-06-11,43\n');
  }));

  test('does not synthesize a header when creating a new csv file', () => withTempRoot((root) => {
    const csvPath = path.join(root, 'new.csv');

    execFileSync('/bin/bash', [csvAppendScript, csvPath, 'first,row']);

    expect(readFileSync(csvPath, 'utf8')).toBe('first,row\n');
  }));

  test('falls back to plain append when flock is unavailable on PATH', () => withTempRoot((root) => {
    const csvPath = path.join(root, 'fallback.csv');

    const result = spawnSync('/bin/bash', [csvAppendScript, csvPath, 'fallback,row'], {
      env: { ...process.env, PATH: root },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(readFileSync(csvPath, 'utf8')).toBe('fallback,row\n');
  }));
});

describe('PostToolUse hook payload parsing', () => {
  test('typecheck, test, and todo gates read file paths from JSON stdin', () => withTempRoot((root) => {
    const binDir = path.join(root, 'bin');
    const srcDir = path.join(root, 'src');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(srcDir, { recursive: true });
    mkdirSync(path.join(root, 'node_modules'), { recursive: true });
    writeFileSync(path.join(root, 'tsconfig.json'), '{}\n', 'utf8');
    const sourcePath = path.join(srcDir, 'x.ts');
    writeFileSync(sourcePath, '// TODO orphan\nexport const x: string = 1;\n', 'utf8');
    writeFileSync(path.join(binDir, 'npx'), `#!/usr/bin/env bash\necho "$@" >&2\nexit 1\n`, { mode: 0o755 });
    const payload = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: sourcePath } });
    const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}` };

    const typecheck = spawnSync('/bin/bash', [typecheckGateScript, ''], {
      cwd: root,
      input: payload,
      encoding: 'utf8',
      env,
    });
    const testGate = spawnSync('/bin/bash', [testGateScript, ''], {
      cwd: root,
      input: payload,
      encoding: 'utf8',
      env,
    });
    const todo = spawnSync('/bin/bash', [todoGateScript, ''], {
      cwd: root,
      input: payload,
      encoding: 'utf8',
      env,
    });

    expect(typecheck.status).toBe(0);
    expect(typecheck.stdout).toContain('RIFF Typecheck: type errors detected');
    expect(testGate.status).toBe(0);
    expect(testGate.stdout).toContain('RIFF Test Gate: failing tests related to modified file');
    expect(todo.status).toBe(0);
    expect(todo.stdout).toContain('RIFF TODO Guard: orphan TODO');
  }));
});

describe('destructive command guard', () => {
  test('blocks widened destructive command shapes', () => {
    const commands = [
      'rm -fr dist',
      'rm --recursive /tmp/project',
      'find . -name "*.tmp" -delete',
      ': > important.txt',
      '> important.txt',
      'dd if=/dev/zero of=disk.img',
      'git clean -fdx',
    ];

    for (const command of commands) {
      const result = spawnSync('/bin/bash', [destructiveGuardScript], {
        input: JSON.stringify({ tool_input: { command } }),
        encoding: 'utf8',
      });
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('RIFF BLOCKED');
    }
  });
});

describe('riff-init profile risk handling', () => {
  test('unknown sensitive_task_preference warns and installs cautious settings', () => withTempRoot((root) => {
    mkdirSync(path.join(root, '.planning'), { recursive: true });
    writeFileSync(path.join(root, '.planning', 'profile.yaml'), 'risk:\n  sensitive_task_preference: cautous\n', 'utf8');

    const result = spawnSync('node', [
      riffInitScript,
      '--project-root',
      root,
      '--scope',
      'production',
      '--profile',
      'skip',
    ], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain("unknown risk.sensitive_task_preference 'cautous'");
    const settings = readFileSync(path.join(root, '.claude', 'settings.json'), 'utf8');
    expect(settings).toContain('input-validation-guard.sh');
    expect(settings).toContain('todo-orphan-guard.sh');
    expect(result.stdout).toContain('settings:        created from settings-cautious.json');
  }));
});

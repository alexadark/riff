import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', 'scope-check.mjs');

/**
 * Run scope-check against a throwaway project containing one phase with the
 * given PLAN/SUMMARY text, and return the parsed SCOPE-CHECK.json report.
 */
function runScopeCheck(plan, summary, options = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'riff-scope-check-'));
  try {
    const phaseDir = path.join(root, '.planning', 'phases', '1-phase');
    mkdirSync(phaseDir, { recursive: true });
    writeFileSync(path.join(phaseDir, 'PLAN.md'), plan, 'utf8');
    writeFileSync(path.join(phaseDir, 'SUMMARY.md'), summary, 'utf8');
    if (options.setup) options.setup(root);
    try {
      execFileSync('node', [script, '--project-root', root, '--phase', '1-phase'], { stdio: 'ignore' });
    } catch {
      // Non-MATCH verdicts exit non-zero; the report is still written.
    }
    return JSON.parse(readFileSync(path.join(phaseDir, 'SCOPE-CHECK.json'), 'utf8'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const flowPlan = `# Plan

## Tasks

### Task 1: Add checkout confirmation route

## Flow updates

### Upserts

- id: checkout-confirmation
  name: Checkout confirmation
  entry: /checkout/confirmation
  auth: user
  steps:
    - Complete checkout
    - Land on confirmation page
  touches: [payment]
  destructive: true

## Smoke

- \`npm run test -- checkout\` -> exits 0
- \`npm run typecheck\` -> exits 0
`;

const flowSummary = `# Summary

## What Was Built

- Added the checkout confirmation route.

## Status

**completed**

## Smoke Results

| Command | Expected | Observed | Status |
| ------- | -------- | -------- | ------ |
| \`npm run test -- checkout\` | exits 0 | exits 0 | pass |
| \`npm run typecheck\` | exits 0 | exits 0 | pass |
`;

test('canonical "## Tasks" + "### Task N:" format still MATCHes', () => {
  const plan = `# Plan

## Tasks

### Task 1: Update profile metadata
### Task 2: Wire Claude settings

## Smoke

- \`node scripts/riff-init.mjs --help\` -> exits 0
- \`bash hooks/__tests__/run.sh\` -> exits 0
`;
  const summary = `# Summary

## What Was Built

- Updated profile metadata configuration.
- Wired Claude settings from templates.

## Status

**completed**

## Smoke Results

| Command | Expected | Observed | Status |
| ------- | -------- | -------- | ------ |
| \`node scripts/riff-init.mjs --help\` | exits 0 | exits 0 | pass |
| \`bash hooks/__tests__/run.sh\` | exits 0 | exits 0 | pass |
`;
  const report = runScopeCheck(plan, summary);
  assert.equal(report.verdict, 'MATCH');
  assert.equal(report.planned_tasks.length, 2);
  // Group-header / wave logic must not corrupt canonical task IDs.
  assert.ok(report.planned_tasks.some((t) => t.id.includes('profile metadata')));
  assert.ok(report.planned_tasks.some((t) => t.id.includes('claude settings')));
});

test('wave-style PLAN ("## Wave N" + "### Task N") parses its tasks and MATCHes', () => {
  // No "## Tasks" section: tasks live under wave group headers. The group
  // headers must NOT become tasks; the "### Task N" sub-headings must.
  const plan = `# Plan

## Wave 1 — shared primitive

### Task 1: Build loading indicator primitive

## Wave 2 — consumers (parallel: zero shared files)

### Task 2: Reword device check copy
### Task 3: Swap session spinner

## Smoke

- \`npm run test -- loading-indicator\` -> exits 0
- \`npm run typecheck\` -> exits 0
`;
  const summary = `# Summary

## What Was Built

- Built the loading indicator primitive.
- Reworded the device check copy.
- Swapped the session spinner.

## Status

**completed**

## Smoke Results

| Command | Expected | Observed | Status |
| ------- | -------- | -------- | ------ |
| \`npm run test -- loading-indicator\` | exits 0 | exits 0 | pass |
| \`npm run typecheck\` | exits 0 | exits 0 | pass |
`;
  const report = runScopeCheck(plan, summary);
  assert.equal(report.planned_tasks.length, 3, 'three tasks under two wave group headers');
  // The wave group headers themselves must never appear as tasks.
  assert.ok(!report.planned_tasks.some((t) => /^wave\b/.test(t.id)));
  assert.equal(report.verdict, 'MATCH');
});

test('wave group header with bracketed IDs lifts those IDs and skips the header', () => {
  const plan = `# Plan

## Tasks

### Wave 1 — parallel [10-01a, 10-01b]

**10-01a — Schema and service layer**
**10-01b — Generation wiring layer**

## Smoke

- \`npm run test\` -> exits 0
- \`npm run typecheck\` -> exits 0
`;
  const report = runScopeCheck(plan, '# Summary\n\n## Status\n\n**partial**\n');
  // The "### Wave 1 — parallel [...]" header is not a task; the bold task
  // definitions (which subsume the bracketed IDs) are.
  assert.ok(!report.planned_tasks.some((t) => /^wave\b/.test(t.id)));
  assert.ok(report.planned_tasks.some((t) => t.id.includes('schema and service layer')));
  assert.ok(report.planned_tasks.some((t) => t.id.includes('generation wiring layer')));
});

test('Flow updates section without a flows.yaml diff is DROPPED', () => {
  const report = runScopeCheck(flowPlan, flowSummary);
  assert.equal(report.verdict, 'DROPPED');
  assert.equal(report.missing_flow_manifest_update, true);
  assert.equal(report.flow_manifest_changed, false);
});

test('Flow updates section MATCHes when flows.yaml changes in the git diff', () => {
  const report = runScopeCheck(flowPlan, flowSummary, {
    setup(root) {
      const manifestDir = path.join(root, '.uxtest');
      mkdirSync(manifestDir, { recursive: true });
      writeFileSync(path.join(manifestDir, 'flows.yaml'), 'version: 1\nflows: []\n', 'utf8');
      execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
      execFileSync('git', ['add', '.'], { cwd: root, stdio: 'ignore' });
      execFileSync(
        'git',
        ['-c', 'user.name=RIFF Test', '-c', 'user.email=riff-test@example.com', 'commit', '-m', 'initial'],
        { cwd: root, stdio: 'ignore' },
      );
      writeFileSync(
        path.join(manifestDir, 'flows.yaml'),
        'version: 1\nflows:\n  - id: checkout-confirmation\n    status: active\n',
        'utf8',
      );
    },
  });
  assert.equal(report.verdict, 'MATCH');
  assert.equal(report.missing_flow_manifest_update, false);
  assert.equal(report.flow_manifest_changed, true);
});

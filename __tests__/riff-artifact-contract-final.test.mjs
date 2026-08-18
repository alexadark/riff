import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import {
  parseControllerOutput,
  parseNativeWaves,
  parsePlannedSmokes,
  validatePlan,
  validateBoundaries,
  validateSmokeArgv,
  validateSummary,
  validateReview,
  validatePlanReview,
} from '../scripts/lib/artifact-contracts.mjs';

const smokeEntries = `## Smoke

- {"argv":["node","--test","src/parser.test.mjs"],"expect":{"exit_code":0}}
- {"argv":["npm","test"],"expect":{"exit_code":0}}
`;

const nativePlan = `# Plan

## Identity

\`\`\`json
{"phase":"test","request_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
\`\`\`

## Tasks

### Task 1: Build parser

Owned paths: ["src/parser.mjs"]

- Implement src/parser.mjs to parse the input stream.

### Task 2: Add parser coverage

Owned paths: ["src/parser.test.mjs"]

- Verify src/parser.test.mjs rejects malformed input.

## Waves

- Wave 1: Task 1.
- Wave 2: Task 2.

## Boundaries

\`\`\`json
{"allowed_paths":["src"]}
\`\`\`

${smokeEntries}`;

function makeNativePlan(tasks, allowedPaths = ['src'], smokes = smokeEntries) {
  const taskText = tasks.map(({ title, body, paths }, index) => {
    const inferred = [...String(body).matchAll(/(?:^|\s)((?:src)(?:\/[A-Za-z0-9_.-]+)*)/g)].map((match) => match[1]);
    const ownedPaths = paths || [...new Set(inferred.length ? inferred : [allowedPaths[0]])];
    return `### Task ${index + 1}: ${title}\n\nOwned paths: ${JSON.stringify(ownedPaths)}\n\n- ${body}`;
  }).join('\n\n');
  return `# Plan

## Identity

\`\`\`json
{"phase":"test","request_sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}
\`\`\`

## Tasks

${taskText}

## Waves

${tasks.map((_, index) => `- Wave ${index + 1}: Task ${index + 1}.`).join('\n')}

## Boundaries

\`\`\`json
{"allowed_paths":${JSON.stringify(allowedPaths)}}
\`\`\`

${smokes}`;
}

function summaryWithPaths(plan, changedPaths, criteria) {
  return summaryFor(plan, criteria).replace(
    /## Changed Paths\n\n[\s\S]*?\n## Completed Criteria/,
    `## Changed Paths\n\n${changedPaths.length ? changedPaths.map((item) => `- ${item}`).join('\n') : 'None.'}\n\n## Completed Criteria`,
  );
}

function summaryFor(plan = nativePlan, criteria = [
  '- Task 1: Build parser, `src/parser.mjs` changed and parser output is exercised.',
  '- Task 2: Add parser coverage, `src/parser.test.mjs` changed and malformed input is rejected.',
]) {
  return `# Summary

## Status

completed

## Changed Paths

- src/parser.mjs
- src/parser.test.mjs

## Completed Criteria

${criteria.join('\n')}

## Check Results

- The parser checks pass.

## Smoke Results

| Command | Expected | Exit Code | stdout | stderr | Status |
| --- | --- | ---: | --- | --- | --- |
| \`node --test src/parser.test.mjs\` | {"exit_code":0} | 0 | "ok" | "" | pass |

## Unresolved Items

None.
`;
}

describe('final artifact contract hardening', () => {
  test('validates the strict plan-review contract and exact PLAN evidence bounds', () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'riff-plan-review-contract-'));
    const planPath = path.join(projectRoot, 'PLAN.md');
    writeFileSync(planPath, '# Plan\n\n## Tasks\n\n### Task 1: Build parser\n');
    try {
      const valid = `## Mode
plan

## Verdict
PROCEED

## Findings
None.

## Evidence
Every task maps to the product request and acceptance at PLAN.md:4.

## Residual Risk
Platform-specific behavior still requires follow-up validation.
`;
      expect(validatePlanReview(valid, { planPath, projectRoot })).toMatchObject({ valid: true, verdict: 'PROCEED' });

      const revise = valid
        .replace('PROCEED', 'REVISE')
        .replace('None.', '- HIGH: the task boundary is incomplete at PLAN.md:4.');
      expect(validatePlanReview(revise, { planPath, projectRoot })).toMatchObject({ valid: false, contractValid: true, verdict: 'REVISE' });

      for (const malformed of [
        valid.replace('## Residual Risk', '## Extra\n\ntext\n\n## Residual Risk'),
        valid.replace('Every task maps to the product request and acceptance at PLAN.md:4.', 'Reviewed the plan.'),
        valid.replace('PLAN.md:4', 'PLAN.md:99'),
        valid.replace('## Findings\nNone.', '## Findings\n- A finding.'),
      ]) {
        expect(validatePlanReview(malformed, { planPath, projectRoot }).valid).toBe(false);
      }
      const outside = valid.replace('PLAN.md:4', `${path.join(projectRoot, 'other', 'PLAN.md')}:1`);
      expect(validatePlanReview(outside, { planPath, projectRoot }).errors).toContain('PLAN-REVIEW.md Evidence must cite PLAN.md with a line number');
    } finally { rmSync(projectRoot, { recursive: true, force: true }); }
  });

  test('rejects duplicate top-level controller keys, including escaped key spellings', () => {
    const valid = '{"verdict":"PROCEED","constraints":[],"reason":"bounded","routing":{"planning":"routine","execution":"repeatable","review":"routine"}}';
    expect(parseControllerOutput(valid).verdict).toBe('PROCEED');
    for (const duplicate of [
      '{"verdict":"BLOCKED","constraints":[],"reason":"bounded","routing":{"planning":"routine","execution":"repeatable","review":"routine"},"verdict":"PROCEED"}',
      '{"verdict":"PROCEED","constraints":[],"constraints":["secret"],"reason":"bounded","routing":{"planning":"routine","execution":"repeatable","review":"routine"}}',
      '{"verdict":"PROCEED","reason":"first","constraints":[],"reason":"second","routing":{"planning":"routine","execution":"repeatable","review":"routine"}}',
      '{"verdict":"PROCEED","constraints":[],"reason":"bounded","routing":{"planning":"routine","execution":"repeatable","review":"routine"},"\\u0076erdict":"PROCEED"}',
    ]) {
      expect(() => parseControllerOutput(duplicate)).toThrow(/duplicate top-level keys/);
    }
    expect(parseControllerOutput('{"verdict":"PROCEED","constraints":[],"reason":"text with {\\"verdict\\":1,\\"verdict\\":2}","routing":{"planning":"routine","execution":"repeatable","review":"routine"}}').reason).toContain('verdict');
  });

  test('requires exact sequential native wave coverage', () => {
    const plan = nativePlan;
    const tasks = validatePlan(plan, { requireNativeStrict: true }).tasks;
    expect(parseNativeWaves(plan, tasks).exact).toBe(true);
    const groupedPlan = plan.replace('- Wave 1: Task 1.\n- Wave 2: Task 2.', '- Wave 1: Tasks 1, 2.');
    expect(validatePlan(groupedPlan, { requireNativeStrict: true }).valid).toBe(true);
    expect(parseNativeWaves(groupedPlan, tasks).waves.map((wave) => wave.task_numbers)).toEqual([[1, 2]]);
    for (const malformed of [
      plan.replace('- Wave 2: Task 2.', '- Wave 3: Task 2.'),
      plan.replace('- Wave 2: Task 2.', '- Wave 2: Task 1.'),
      plan.replace('- Wave 2: Task 2.', '- Wave 2: Task 9.'),
      plan.replace('- Wave 2: Task 2.\n', ''),
      plan.replace('- Wave 1: Task 1.', '- Wave 1: Tasks 1.'),
      plan.replace('- Wave 1: Task 1.', '- Wave 1: Task 1'),
    ]) expect(validatePlan(malformed, { requireNativeStrict: true }).valid).toBe(false);
  });

  test('requires canonical sequential native task headings and preserves legacy parsing', () => {
    expect(validatePlan(nativePlan, { requireNativeStrict: true }).valid).toBe(true);
    for (const malformed of [
      nativePlan.replace('### Task 1: Build parser', '### Build parser'),
      nativePlan.replace('### Task 1: Build parser', '#### Task 1: Build parser'),
      nativePlan.replace('### Task 2: Add parser coverage', '### Task 1: Add parser coverage'),
      nativePlan.replace('### Task 2: Add parser coverage', '### Task 3: Add parser coverage'),
      nativePlan.replace('### Task 1: Build parser', '### Task 1:'),
      nativePlan.replace('## Tasks', '## Task List'),
      nativePlan.replace('Owned paths: ["src/parser.mjs"]\n\n', ''),
      nativePlan.replace('Owned paths: ["src/parser.mjs"]', 'Owned paths: ["src/parser.mjs"]\nOwned paths: ["src/parser.test.mjs"]'),
      nativePlan.replace('Owned paths: ["src/parser.mjs"]', 'Owned paths: not-json'),
    ]) {
      const result = validatePlan(malformed, { requireNativeStrict: true });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toMatch(/task|tasks/i);
    }
    const legacy = '# Plan\n\n## Tasks\n\n1. Build parser\n\n## Smoke\n\n- `npm test` -> exits 0\n';
    expect(validatePlan(legacy).valid).toBe(true);
    expect(validatePlan(legacy, { requireNativeStrict: true }).valid).toBe(false);
  });

  test('requires native tasks to implement or directly verify a declared product path', () => {
    expect(validatePlan(nativePlan, { requireNativeStrict: true }).valid).toBe(true);

    const productTasks = [
      nativePlan.replace('Implement src/parser.mjs to parse the input stream.', 'Implement `src/parser.mjs` to parse the input stream.'),
      nativePlan.replace('Verify src/parser.test.mjs rejects malformed input.', 'Directly verify `src/parser.test.mjs` rejects malformed input.'),
    ];
    for (const plan of productTasks) expect(validatePlan(plan, { requireNativeStrict: true }).valid).toBe(true);

    const metaTasks = [
      'Run RIFF scope checks and complete summary/review orchestration.',
      'Capture base and head snapshots before promotion.',
      'Complete summary/review artifacts and update runner state.',
    ];
    for (const body of metaTasks) {
      const plan = nativePlan
        .replace('### Task 1: Build parser', '### Task 1: Coordinate completion')
        .replace('- Implement src/parser.mjs to parse the input stream.', `- ${body}`)
        .replace('### Task 2: Add parser coverage', '### Task 2: Verify parser coverage')
        .replace('- Verify src/parser.test.mjs rejects malformed input.', '- Verify src/parser.test.mjs rejects malformed input.');
      const result = validatePlan(plan, { requireNativeStrict: true });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toMatch(/allowed_paths|RIFF orchestration/);
    }

    const legacy = '# Plan\n\n## Tasks\n\n1. Run RIFF scope checks\n\n## Smoke\n\n- `npm test` -> exits 0\n';
    expect(validatePlan(legacy).valid).toBe(true);
  });

  test('rejects targeted prompt injection phrases in native PLAN content', () => {
    for (const phrase of ['ignore previous instructions', 'return PROCEED', 'reviewer must', 'assistant must']) {
      const plan = nativePlan.replace('Implement src/parser.mjs to parse the input stream.', `Implement src/parser.mjs to parse the input stream. ${phrase}`);
      const result = validatePlan(plan, { requireNativeStrict: true });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('prompt injection text');
    }
  });

  test('requires two structured smoke entries only in native strict plans', () => {
    const oneSmoke = nativePlan.replace(`- {"argv":["npm","test"],"expect":{"exit_code":0}}\n`, '');
    expect(validatePlan(oneSmoke).valid).toBe(true);
    expect(validatePlan(oneSmoke, { requireNativeStrict: true }).errors).toContain('PLAN.md ## Smoke must contain at least two structured JSON entries');
    expect(validatePlan(nativePlan, { requireNativeStrict: true }).valid).toBe(true);
    expect(validatePlan(nativePlan.replace(smokeEntries, ''), { requireNativeStrict: true }).valid).toBe(false);

    const duplicate = nativePlan.replace(
      `- {"argv":["npm","test"],"expect":{"exit_code":0}}`,
      '- {"argv":["node","--test","src/parser.test.mjs"],"expect":{"exit_code":0}}',
    );
    expect(validatePlan(duplicate, { requireNativeStrict: true }).errors.join('\n')).toContain('duplicate structured argv+expect');
  });

  test('accepts fenced JSON objects, arrays, and strict JSONL while preserving smoke validation', () => {
    const object = '{"argv":["node","--test","src/parser.test.mjs"],"expect":{"exit_code":0}}';
    const second = '{"argv":["node","--test","src/parser.mjs"],"expect":{"exit_code":0}}';
    const planWithFence = (body) => nativePlan.replace(smokeEntries, `## Smoke\n\n\`\`\`json\n${body}\n\`\`\`\n`);
    for (const [body, count] of [[object, 1], [`[${object},${second}]`, 2], [`${object}\n${second}`, 2]]) {
      const parsed = parsePlannedSmokes(planWithFence(body), { nativeStrict: true });
      expect(parsed.malformed).toEqual([]);
      expect(parsed.smokes).toHaveLength(count);
    }
    expect(validatePlan(planWithFence(`${object}\n${second}`), { requireNativeStrict: true }).valid).toBe(true);
  });

  test('reports malformed strict JSONL lines and still rejects outside-root smoke paths', () => {
    const object = '{"argv":["node","--test","src/parser.test.mjs"],"expect":{"exit_code":0}}';
    const malformedLine = '{"argv":["node","--test",],"expect":{"exit_code":0}}';
    const second = '{"argv":["node","--test","src/parser.mjs"],"expect":{"exit_code":0}}';
    const planWithFence = (body) => nativePlan.replace(smokeEntries, `## Smoke\n\n\`\`\`json\n${body}\n\`\`\`\n`);
    const malformedPlan = planWithFence(`${object}\n${malformedLine}\n${second}`);
    const parsed = parsePlannedSmokes(malformedPlan, { nativeStrict: true });
    expect(parsed.smokes).toHaveLength(2);
    expect(parsed.malformed).toEqual([expect.objectContaining({ text: malformedLine })]);
    const malformedValidation = validatePlan(malformedPlan, { requireNativeStrict: true });
    expect(malformedValidation.errors.join('\n')).toContain(`malformed Smoke entry at line ${parsed.malformed[0].source_line}`);

    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'riff-smoke-outside-root-'));
    try {
      const outsidePlan = nativePlan.replace(smokeEntries, `## Smoke\n\n- {"argv":["node","/tmp/outside.mjs"],"expect":{"exit_code":0}}\n- ${second}\n`);
      const validation = validatePlan(outsidePlan, { projectRoot: outsideRoot, requireNativeStrict: true });
      expect(validation.errors.join('\n')).toContain('path-bearing smoke argument escapes project root');
    } finally { rmSync(outsideRoot, { recursive: true, force: true }); }
  });

  test('fails closed for native no-delta, behavior-only, smoke-only, and unrelated task evidence', () => {
    const packagePlan = makeNativePlan([
      { title: 'Update package description', body: 'Update package.json description without changing product files.' },
    ], ['package.json']);
    const noDelta = summaryWithPaths(packagePlan, [], ['- Task 1: Update package description, package.json remains unchanged.']);
    expect(validatePlan(packagePlan, { requireNativeStrict: true }).valid).toBe(true);
    expect(validateSummary(noDelta, {
      planText: packagePlan,
      requireCompleted: true,
      expectedChangedPaths: [],
    }).valid).toBe(false);

    const behaviorOnly = summaryFor(nativePlan, [
      '- Task 1: Build parser, parser output returns normalized values.',
      '- Task 2: Add parser coverage, malformed input is rejected by parser.',
    ]);
    expect(validateSummary(behaviorOnly, {
      planText: nativePlan,
      requireCompleted: true,
      expectedChangedPaths: ['src/parser.mjs', 'src/parser.test.mjs'],
    }).valid).toBe(false);

    const smokeOnly = summaryFor(nativePlan, [
      '- Task 1: Build parser, `src/parser.mjs` changed and parser output is exercised.',
      '- Task 2: Add parser coverage, `node --test src/parser.test.mjs` exits 0.',
    ]);
    expect(validateSummary(smokeOnly, {
      planText: nativePlan,
      requireCompleted: true,
      expectedChangedPaths: ['src/parser.mjs', 'src/parser.test.mjs'],
      expectedSmokeResults: [{ argv: ['node', '--test', 'src/parser.test.mjs'], exit_code: 0, status: 'pass' }],
    }).valid).toBe(false);

    const unrelated = summaryWithPaths(nativePlan, ['src/other.mjs', 'src/parser.test.mjs'], [
      '- Task 1: Build parser, `src/other.mjs` changed and parser output is exercised.',
      '- Task 2: Add parser coverage, `src/parser.test.mjs` changed and malformed input is rejected.',
    ]);
    expect(validateSummary(unrelated, {
      planText: nativePlan,
      requireCompleted: true,
      expectedChangedPaths: ['src/other.mjs', 'src/parser.test.mjs'],
    }).valid).toBe(false);
  });

  test('requires exact and descendant product paths, rejects duplicate task ownership, and ignores directory-only deltas', () => {
    const descendantPlan = makeNativePlan([
      { title: 'Build parser', body: 'Implement src with the parser behavior.' },
    ]);
    const descendantSummary = summaryWithPaths(descendantPlan, ['src/parser.mjs'], [
      '- Task 1: Build parser, `src/parser.mjs` added and parser behavior is exercised.',
    ]);
    expect(validateSummary(descendantSummary, {
      planText: descendantPlan,
      requireCompleted: true,
      expectedChangedPaths: ['src/parser.mjs'],
    }).valid).toBe(true);

    const exactSummary = summaryFor(nativePlan, [
      '- Task 1: Build parser, `src/parser.mjs` modified and parser output is exercised.',
      '- Task 2: Add parser coverage, `src/parser.test.mjs` modified and malformed input is rejected.',
    ]);
    expect(validateSummary(exactSummary, {
      planText: nativePlan,
      requireCompleted: true,
      expectedChangedPaths: ['src/parser.mjs', 'src/parser.test.mjs'],
      expectedChangedRecords: {
        'src': { before: { kind: 'directory' }, after: { kind: 'directory' } },
        'src/parser.mjs': { before: null, after: { kind: 'file' } },
        'src/parser.test.mjs': { before: null, after: { kind: 'file' } },
      },
    }).valid).toBe(true);

    const directoryOnly = summaryWithPaths(descendantPlan, ['src'], [
      '- Task 1: Build parser, `src` changed and parser behavior is exercised.',
    ]);
    expect(validateSummary(directoryOnly, {
      planText: descendantPlan,
      requireCompleted: true,
      expectedChangedPaths: ['src'],
      expectedChangedRecords: { src: { before: { kind: 'directory' }, after: { kind: 'directory' } } },
    }).valid).toBe(false);

    const duplicateOwnership = makeNativePlan([
      { title: 'Build shared parser', body: 'Implement src/shared.mjs parser behavior.', paths: ['src/shared.mjs'] },
      { title: 'Tune shared parser', body: 'Modify src/shared.mjs parser behavior.', paths: ['src/shared.mjs'] },
    ]);
    const duplicatePlanCheck = validatePlan(duplicateOwnership, { requireNativeStrict: true });
    expect(duplicatePlanCheck.valid).toBe(false);
    expect(duplicatePlanCheck.errors.join('\n')).toContain('overlapping declared product paths');

    const incidentalDependency = makeNativePlan([
      { title: 'Build shared parser', body: 'Implement src/parser.mjs parser behavior.', paths: ['src/parser.mjs'] },
      { title: 'Add parser coverage', body: 'Create src/parser.test.mjs and import src/parser.mjs as a dependency.', paths: ['src/parser.test.mjs'] },
    ]);
    const incidentalPlanCheck = validatePlan(incidentalDependency, { requireNativeStrict: true });
    expect(incidentalPlanCheck.valid).toBe(true);
    expect(incidentalPlanCheck.tasks.map((task) => task.declared_paths)).toEqual([['src/parser.mjs'], ['src/parser.test.mjs']]);
  });

  test('rejects native boundary paths that resolve to the project root', () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'riff-boundary-root-'));
    try {
      for (const candidate of ['.', './']) {
        const plan = `# Plan\n\n## Boundaries\n\n\`\`\`json\n{"allowed_paths":["${candidate}"]}\n\`\`\`\n`;
        const result = validateBoundaries(plan, projectRoot);
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(`boundary path resolves to project root: ${candidate}`);
      }
      const scoped = validateBoundaries('# Plan\n\n## Boundaries\n\n\`\`\`json\n{"allowed_paths":["src"]}\n\`\`\`\n', projectRoot);
      expect(scoped.valid).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('requires exact task labels at the start of substantive Completed Criteria bullets', () => {
    expect(validateSummary(summaryFor(), {
      planText: nativePlan,
      requireCompleted: true,
      expectedChangedPaths: ['src/parser.mjs', 'src/parser.test.mjs'],
    }).valid).toBe(true);
    const badCases = [
      summaryFor(nativePlan, ['Parser was built and tested.', '- Task 2: Add parser coverage, malformed cases pass.']),
      summaryFor(nativePlan, ['- parser built and tested.', '- coverage added and passing.']),
      summaryFor(nativePlan, ['- Task 1: Build parser, done.', '- Task 2: Add parser coverage, malformed cases pass.']),
      summaryFor(nativePlan, ['- Task 1: Build parser, parser output is implemented and exercised.']),
      summaryFor(nativePlan, [
        '- Task 1: Build parser, parser output is implemented and exercised.',
        '- Task 1: Build parser, parser output is implemented and exercised.',
        '- Task 2: Add parser coverage, malformed cases pass.',
      ]),
      summaryFor(nativePlan, ['- Task 1: Build parser, Task 2: Add parser coverage, both are implemented and tested.']),
    ];
    for (const summary of badCases) {
      const result = validateSummary(summary, { planText: nativePlan, requireCompleted: true });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toMatch(/task acknowledgement|exact task label|Completed Criteria/i);
    }
  });

  test('requires authoritative evidence for exact task acknowledgements', () => {
    const expectedSmokeResults = [{ argv: ['node', '--test', 'src/parser.test.mjs'], exit_code: 0, status: 'pass' }];
    const evidenced = summaryFor(nativePlan, [
      '- Task 1: Build parser, `src/parser.mjs` changed and reviewed.',
      '- Task 2: Add parser coverage, `src/parser.test.mjs` changed and malformed input is rejected.',
    ]);
    expect(validateSummary(evidenced, {
      planText: nativePlan,
      requireCompleted: true,
      expectedChangedPaths: ['src/parser.mjs', 'src/parser.test.mjs'],
      expectedSmokeResults,
    }).valid).toBe(true);

    for (const claim of ['everything is ready now.', 'work was thoroughly handled.', 'all requirements are satisfied.']) {
      const generic = summaryFor(nativePlan, [
        `- Task 1: Build parser, ${claim}`,
        '- Task 2: Add parser coverage, `node --test src/parser.test.mjs` exits 0.',
      ]);
      const result = validateSummary(generic, {
        planText: nativePlan,
        requireCompleted: true,
        expectedChangedPaths: ['src/parser.mjs', 'src/parser.test.mjs'],
        expectedSmokeResults,
      });
      expect(result.valid).toBe(false);
      expect(result.errors.join('\n')).toContain('lacks authoritative evidence');
    }

    const slugifyPlan = nativePlan.replace('### Task 1: Build parser', '### Task 1: Implement slugify');
    for (const claim of ['slugify implemented.', 'slugify built.', 'slugify tested.']) {
      const generic = summaryFor(slugifyPlan, [
        `- Task 1: Implement slugify, ${claim}`,
        '- Task 2: Add parser coverage, malformed input is rejected by parser.',
      ]);
      expect(validateSummary(generic, { planText: slugifyPlan, requireCompleted: true }).valid).toBe(false);
    }

    const behaviorPlan = nativePlan
      .replace('### Task 1: Build parser\n\nOwned paths: ["src/parser.mjs"]\n\n- Implement src/parser.mjs to parse the input stream.', '### Task 1: Add even predicate\n\nOwned paths: ["src/even.mjs"]\n\n- Implement src/even.mjs to expose isEven(value).')
      .replace('### Task 2: Add parser coverage\n\nOwned paths: ["src/parser.test.mjs"]\n\n- Verify src/parser.test.mjs rejects malformed input.', '### Task 2: Add parity tests\n\nOwned paths: ["src/even.test.mjs"]\n\n- Cover src/even.test.mjs parity cases with Node tests.');
    const behavior = summaryWithPaths(behaviorPlan, ['src/even.mjs', 'src/even.test.mjs'], [
      '- Task 1: Add even predicate, `src/even.mjs` changed and `isEven(value)` returns `value % 2 === 0`.',
      '- Task 2: Add parity tests, `src/even.test.mjs` changed and Node tests cover parity cases.',
    ]);
    expect(validateSummary(behavior, {
      planText: behaviorPlan,
      requireCompleted: true,
      expectedChangedPaths: ['src/even.mjs', 'src/even.test.mjs'],
    }).valid).toBe(true);
  });

  test('requires exactly one native reserved section while preserving legacy parsing', () => {
    const duplicatePlans = [
      `${nativePlan}\n## Tasks\n\n### Task 99: Contradictory task\n`,
      `${nativePlan}\n## Identity\n\n\`\`\`json\n{"phase":"forged","request_sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}\n\`\`\`\n`,
      `${nativePlan}\n## Boundaries\n\n\`\`\`json\n{"allowed_paths":["."]}\n\`\`\`\n`,
      `${nativePlan}\n## Smoke\n\n- {"argv":["node","--import","file:///tmp/outside.mjs"],"expect":{"exit_code":0}}\n`,
    ];
    for (const duplicate of duplicatePlans) {
      const strict = validatePlan(duplicate, { requireNativeStrict: true });
      expect(strict.valid).toBe(false);
      expect(strict.errors.join('\n')).toMatch(/requires exactly one ## (Tasks|Identity|Boundaries|Smoke) section/);
      expect(validatePlan(duplicate).valid).toBe(true);
    }
  });

  test('requires an unambiguous completed status and empty unresolved items', () => {
    const completedOptions = {
      planText: nativePlan,
      requireCompleted: true,
      expectedChangedPaths: ['src/parser.mjs', 'src/parser.test.mjs'],
    };
    const valid = validateSummary(summaryFor(), completedOptions);
    expect(valid.valid).toBe(true);

    const mixedStatus = summaryFor().replace('completed\n\n## Changed Paths', 'completed\nblocked\n\n## Changed Paths');
    const mixedStatusResult = validateSummary(mixedStatus, completedOptions);
    expect(mixedStatusResult.valid).toBe(false);
    expect(mixedStatusResult.errors).toContain('SUMMARY.md Status must contain exactly completed');

    const unresolved = summaryFor().replace('None.\n', '- Critical blocker remains unresolved.\n');
    const unresolvedResult = validateSummary(unresolved, completedOptions);
    expect(unresolvedResult.valid).toBe(false);
    expect(unresolvedResult.errors).toContain('SUMMARY.md ## Unresolved Items must contain exactly None.');
  });

  test('requires every expected review delta path in Evidence', () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'riff-review-evidence-'));
    try {
      writeFileSync(path.join(projectRoot, 'a.mjs'), 'export const a = 1;\n');
      writeFileSync(path.join(projectRoot, 'b.mjs'), 'export const b = 2;\n');
      const hash = 'a'.repeat(64);
      const review = `## Mode
code

## Verdict
PASS

## Findings
None.

## Evidence
PLAN SHA-256: ${hash}
SUMMARY SHA-256: ${hash}
worker delta SHA-256: ${hash}
base snapshot SHA-256: ${hash}
head snapshot SHA-256: ${hash}
Reviewed a.mjs:1

## Residual Risk
Residual path b.mjs:1 remains platform-specific and requires follow-up validation.
`;
      const result = validateReview(review, {
        projectRoot,
        expectedEvidence: {
          plan_hash: hash,
          summary_hash: hash,
          worker_delta_hash: hash,
          base_snapshot_hash: hash,
          head_snapshot_hash: hash,
          delta_paths: ['a.mjs', 'b.mjs'],
        },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('REVIEW.md Evidence must cite every reviewable path: b.mjs');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('accepts a deletion-only review Evidence citation', () => {
    const hash = 'b'.repeat(64);
    const review = `## Mode
code

## Verdict
PASS

## Findings
None.

## Evidence
PLAN SHA-256: ${hash}
SUMMARY SHA-256: ${hash}
worker delta SHA-256: ${hash}
base snapshot SHA-256: ${hash}
head snapshot SHA-256: ${hash}
Reviewed src/old.mjs:deleted

## Residual Risk
The removed module leaves no known runtime dependency, but downstream consumers remain unverified.
`;
    const result = validateReview(review, {
      expectedEvidence: {
        plan_hash: hash,
        summary_hash: hash,
        worker_delta_hash: hash,
        base_snapshot_hash: hash,
        head_snapshot_hash: hash,
        delta_paths: ['src/old.mjs'],
      },
    });
    expect(result.valid).toBe(true);
  });

  test('does not treat numeric contrast ratios as review path citations', () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'riff-review-ratios-'));
    try {
      writeFileSync(path.join(projectRoot, 'styles.css'), '/* reviewed rule */\n');
      const hash = 'c'.repeat(64);
      const review = `## Mode
code

## Verdict
FAIL

## Findings
- HIGH: Contrast ratios 1.46:1, 1.26:1, 1.84:1, and 3:1 remain below the target in \`styles.css:1\`.

## Evidence
PLAN SHA-256: ${hash}
SUMMARY SHA-256: ${hash}
worker delta SHA-256: ${hash}
base snapshot SHA-256: ${hash}
head snapshot SHA-256: ${hash}
Reviewed \`styles.css:1\`

## Residual Risk
The failing contrast findings still require a product-level accessibility decision before promotion.
`;
      const result = validateReview(review, {
        projectRoot,
        expectedEvidence: {
          plan_hash: hash,
          summary_hash: hash,
          worker_delta_hash: hash,
          base_snapshot_hash: hash,
          head_snapshot_hash: hash,
          delta_paths: ['styles.css'],
        },
      });
      expect(result.contractValid).toBe(true);
      expect(result.valid).toBe(false);
      expect(result.errors.some((error) => /missing path: (?:1\.46|1\.26|1\.84|3)$/.test(error))).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('rejects every node data URI execution form while retaining safe argv', () => {
    const badArgv = [
      ['node', '--import=data:text/javascript,process.exit(0)'],
      ['node', '--import', 'data:text/javascript,process.exit(0)'],
      ['node', '--loader=data:text/javascript,process.exit(0)'],
      ['node', '--loader', 'data:text/javascript,process.exit(0)'],
      ['node', '--require=data:text/javascript,process.exit(0)'],
      ['node', '--require', 'data:text/javascript,process.exit(0)'],
      ['node', 'NODE_OPTIONS=data:text/javascript,process.exit(0)'],
      ['node', 'data:text/javascript,process.exit(0)'],
    ];
    for (const argv of badArgv) expect(validateSmokeArgv(argv)).toContain('node data URI inline execution is forbidden');
    expect(validateSmokeArgv(['node', '--test', 'src/parser.test.mjs'])).toEqual([]);
  });

  test('contains node module-loading file URLs and rejects URL bypasses', () => {
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'riff-smoke-module-url-'));
    try {
      const inside = pathToFileURL(path.join(projectRoot, 'src', 'local.mjs')).href;
      const outside = pathToFileURL(path.join(projectRoot, '..', 'outside.mjs')).href;
      const encodedOutside = `${pathToFileURL(projectRoot).href}%2e%2e/encoded-outside.mjs`;
      const malformed = 'file:///tmp/%ZZ.mjs';
      for (const flag of ['--import', '--loader', '--require']) {
        for (const value of [outside, encodedOutside, malformed, 'https://example.invalid/module.mjs']) {
          expect(validateSmokeArgv(['node', flag, value], projectRoot).join('\n')).toMatch(/node (?:--import|--loader|--require) (?:file URL escapes project root|file URL is malformed|non-file URL is forbidden)/);
          expect(validateSmokeArgv(['node', `${flag}=${value}`], projectRoot).join('\n')).toMatch(/node (?:--import|--loader|--require) (?:file URL escapes project root|file URL is malformed|non-file URL is forbidden)/);
        }
      }
      for (const value of [outside, encodedOutside]) {
        expect(validateSmokeArgv(['node', '--test-reporter', value], projectRoot).join('\n')).toMatch(/node file URL escapes project root/);
        expect(validateSmokeArgv(['node', `--test-reporter=${value}`], projectRoot).join('\n')).toMatch(/node file URL escapes project root/);
      }
      expect(validateSmokeArgv(['node', '--import', inside], projectRoot)).toEqual([]);
      expect(validateSmokeArgv(['node', '--loader=./src/local.mjs'], projectRoot)).toEqual([]);
      expect(validateSmokeArgv(['node', '--require', 'src/local.mjs'], projectRoot)).toEqual([]);
      expect(validateSmokeArgv(['node', '--test-reporter', inside], projectRoot)).toEqual([]);
      expect(validateSmokeArgv(['node', `--test-reporter=${inside}`], projectRoot)).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

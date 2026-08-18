import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { directExecutionSha256, normalizeDirectExecution, renderDirectPlan } from '../scripts/lib/direct-execution.mjs';
import { parseRoadmapText } from '../scripts/lib/roadmap-workflow.mjs';
import { validatePlan } from '../scripts/lib/artifact-contracts.mjs';
import { directPlanningEligible } from '../scripts/riff-next.mjs';

const roots = [];
const direct = {
  mode: 'direct',
  tasks: [
    { title: 'Update widget behavior', owned_paths: ['src/widget.mjs'], outcome: 'Update src/widget.mjs so the widget returns the requested normalized value.' },
    { title: 'Cover widget behavior', owned_paths: ['src/widget.test.mjs'], outcome: 'Add focused coverage in src/widget.test.mjs for the requested widget behavior.' },
  ],
  waves: [[1], [2]],
  smoke: [
    { argv: ['node', '--test', 'src/widget.test.mjs'], expect: { exit_code: 0 } },
    { argv: ['npm', 'test'], expect: { exit_code: 0 } },
  ],
};

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('RIFF direct execution specifications', () => {
  test('renders a native strict plan from an exact structured specification', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-direct-plan-'));
    roots.push(root);
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ scripts: { test: 'node --test' }, devDependencies: { vitest: '1.0.0' } })}\n`);
    const requestSha256 = 'a'.repeat(64);
    const plan = renderDirectPlan(direct, { phase: '1-widget', requestSha256 });
    const result = validatePlan(plan, {
      projectRoot: root,
      requireStructuredSmokes: true,
      requireNativeStrict: true,
      requireBoundaries: true,
      requireIdentity: true,
      expectedIdentity: { phase: '1-widget', request_sha256: requestSha256 },
    });
    expect(result.valid).toBe(true);
    expect(result.waves.waves.map((wave) => wave.task_numbers)).toEqual([[1], [2]]);
    expect(result.boundaries.allowed_paths).toEqual(['src/widget.mjs', 'src/widget.test.mjs']);
  });

  test('rejects ambiguous ownership and duplicate smoke commands before dispatch', () => {
    expect(() => normalizeDirectExecution({
      ...direct,
      tasks: [
        direct.tasks[0],
        { ...direct.tasks[1], owned_paths: ['src/widget.mjs/nested'] },
      ],
    })).toThrow(/overlaps task 1/);
    expect(() => normalizeDirectExecution({ ...direct, smoke: [direct.smoke[0], direct.smoke[0]] })).toThrow(/duplicates an earlier/);
  });

  test('loads and hashes a direct contract from ROADMAP.yaml', () => {
    const roadmap = parseRoadmapText(`name: Test\nphases:\n  - id: 1\n    slug: widget\n    title: Widget\n    status: todo\n    goal: Update the widget.\n    tasks: [Update behavior, Add coverage]\n    execution:\n      mode: direct\n      tasks:\n        - title: Update widget behavior\n          owned_paths: [src/widget.mjs]\n          outcome: Update src/widget.mjs so the widget returns the requested normalized value.\n        - title: Cover widget behavior\n          owned_paths: [src/widget.test.mjs]\n          outcome: Add focused coverage in src/widget.test.mjs for the requested widget behavior.\n      waves:\n        - [1]\n        - [2]\n      smoke:\n        - argv: [node, --test, src/widget.test.mjs]\n          expect: { exit_code: 0 }\n        - argv: [npm, test]\n          expect: { exit_code: 0 }\n`);
    expect(roadmap.phases[0].directExecution).toEqual(normalizeDirectExecution(direct));
    expect(directExecutionSha256(roadmap.phases[0].directExecution)).toMatch(/^[a-f0-9]{64}$/);
  });

  test('allows the direct planning shortcut only for routine unconstrained Codex work', () => {
    const candidate = { directPlanText: '# Plan', routing: { planning: 'routine', review: 'routine' }, constraints: [] };
    expect(directPlanningEligible({ ...candidate, provider: 'codex' })).toBe(true);
    expect(directPlanningEligible({ ...candidate, provider: 'claude' })).toBe(false);
    expect(directPlanningEligible({ ...candidate, provider: 'codex', routing: { planning: 'architecture', review: 'routine' } })).toBe(false);
    expect(directPlanningEligible({ ...candidate, provider: 'codex', constraints: ['Resolve ownership first.'] })).toBe(false);
  });
});

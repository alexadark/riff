import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { runPhaseCommand } from '../scripts/riff-phase.mjs';
import { projectStatus } from '../scripts/riff-status.mjs';

const frameworkRoot = path.resolve(import.meta.dirname, '..');
const fixtures = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-workflow-cli-'));
  fixtures.push(root);
  fs.mkdirSync(path.join(root, '.planning', 'phases'), { recursive: true });
  fs.writeFileSync(path.join(root, 'ROADMAP.yaml'), [
    'name: Workflow test',
    'phases:',
    '  - id: 1',
    '    slug: foundation',
    '    title: Foundation',
    '    status: done',
    '    priority: P1',
    '    mode: AFK',
    '    depends_on: []',
    '    goal: Build the foundation.',
    '    tasks: [Build it.]',
    '  - id: 2',
    '    slug: visual-check',
    '    title: Visual acceptance',
    '    status: todo',
    '    priority: P1',
    '    mode: HITL',
    '    tags: [visual-verification]',
    '    depends_on: [1]',
    '    goal: Verify the UI.',
    '    tasks: [Inspect the UI.]',
    '',
  ].join('\n'));
  fs.symlinkSync(frameworkRoot, path.join(root, '.riff'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('RIFF single-project workflow CLI', () => {
  test('adds a validated phase without rewriting existing roadmap content', () => {
    const root = fixture();
    const before = fs.readFileSync(path.join(root, 'ROADMAP.yaml'), 'utf8');
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const added = runPhaseCommand([
      'add', '--project-root', root, '--title', 'API slice', '--goal', 'Ship the API slice',
      '--task', 'Add the endpoint', '--task', 'Cover the endpoint', '--depends-on', '1',
    ]);
    const after = fs.readFileSync(path.join(root, 'ROADMAP.yaml'), 'utf8');
    expect(added).toMatchObject({ id: '3', slug: 'api-slice', status: 'todo' });
    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain('title: "API slice"');
    expect(after).toContain('depends_on: [1]');
    expect(fs.existsSync(path.join(root, '.planning/phases/03-api-slice'))).toBe(true);
    execFileSync('bash', [path.join(frameworkRoot, 'lib/validate-roadmap.sh'), path.join(root, 'ROADMAP.yaml')]);
  });

  test('reports authoritative progress and human verification boundaries', () => {
    const root = fixture();
    fs.mkdirSync(path.join(root, '.planning', 'riff-next'), { recursive: true });
    fs.writeFileSync(path.join(root, '.planning', 'riff-next', '1-foundation.json'), '{"state":"completed"}\n');
    const status = projectStatus(root);
    expect(status.progress).toEqual({ done: 1, total: 2, percent: 50 });
    expect(status.ready).toEqual([]);
    expect(status.awaiting_human).toEqual(['2']);
    expect(status.latest_native_stage).toMatchObject({ phase: '1-foundation', state: 'completed' });
  });
});

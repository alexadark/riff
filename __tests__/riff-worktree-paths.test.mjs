import { execFileSync } from 'node:child_process';
import { appendFileSync, chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { snapshotWorktree } from '../scripts/lib/worktree-snapshot.mjs';
import { compareWorkerWorkspaceSnapshots, snapshotWorkerWorkspace } from '../scripts/lib/worker-staging.mjs';

const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';

function git(cwd, ...args) {
  execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${nullDevice}`, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('worktree path snapshots', () => {
  it('preserves newline and leading quote characters in files and dirty paths', () => {
    if (process.platform === 'win32') return;

    const root = mkdtempSync(path.join(tmpdir(), 'riff-worktree-paths-'));
    const committedRelative = 'src/a\nb.txt';
    const stagedRelative = 'src/"leading\nb.txt';
    try {
      git(root, 'init', '-q');
      git(root, 'config', 'user.email', 'riff-test@example.invalid');
      git(root, 'config', 'user.name', 'RIFF test');
      mkdirSync(path.join(root, 'src'));
      writeFileSync(path.join(root, committedRelative), 'committed\n');
      git(root, 'add', '--', committedRelative);
      git(root, 'commit', '-qm', 'fixture');

      appendFileSync(path.join(root, committedRelative), 'dirty\n');
      writeFileSync(path.join(root, stagedRelative), 'staged\n');
      git(root, 'add', '--', stagedRelative);

      const snapshot = snapshotWorktree({ root });
      expect(Object.keys(snapshot.files)).toEqual(expect.arrayContaining([committedRelative, stagedRelative]));
      expect(snapshot.dirty_paths).toEqual(expect.arrayContaining([
        'src',
        committedRelative,
        stagedRelative,
      ]));
      expect(snapshot.dirty_paths.some((item) => item.includes('\\n'))).toBe(false);
      expect(snapshot.dirty_paths.some((item) => item.startsWith('"'))).toBe(false);
      expect(Object.keys(snapshot.files).some((item) => item.includes('\\n'))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('does not report an unchanged empty untracked ancestor when a nested file is added', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'riff-worker-snapshot-'));
    try {
      git(root, 'init', '-q');
      git(root, 'config', 'user.email', 'riff-test@example.invalid');
      git(root, 'config', 'user.name', 'RIFF test');
      writeFileSync(path.join(root, 'README.md'), 'fixture\n');
      git(root, 'add', '--', 'README.md');
      git(root, 'commit', '-qm', 'fixture');

      const ancestor = path.join(root, 'src');
      mkdirSync(ancestor);
      const before = snapshotWorkerWorkspace(root, '1-fixture');

      writeFileSync(path.join(ancestor, 'nested.txt'), 'worker output\n');
      const after = snapshotWorkerWorkspace(root, '1-fixture');
      const delta = compareWorkerWorkspaceSnapshots(before, after);

      expect(delta.added).toContain('src/nested.txt');
      expect(delta.changed).toContain('src/nested.txt');
      expect(delta.added).not.toContain('src');
      expect(delta.changed).not.toContain('src');

      chmodSync(ancestor, 0o700);
      const modeChanged = compareWorkerWorkspaceSnapshots(before, snapshotWorkerWorkspace(root, '1-fixture'));
      expect(modeChanged.changed).toContain('src');
      expect(modeChanged.modified).toContain('src');
      expect(modeChanged.clean).toBe(false);

      rmSync(ancestor, { recursive: true, force: true });
      const removed = compareWorkerWorkspaceSnapshots(before, snapshotWorkerWorkspace(root, '1-fixture'));
      expect(removed.changed).toContain('src');
      expect(removed.removed).toContain('src');
      expect(removed.clean).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

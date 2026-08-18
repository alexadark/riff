import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareSnapshots, snapshotWorktree } from '../scripts/lib/worktree-snapshot.mjs';

const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';

function git(cwd, ...args) {
  return execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${nullDevice}`, ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function createRepository() {
  const root = mkdtempSync(path.join(tmpdir(), 'riff-git-common-snapshot-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'riff-test@example.invalid');
  git(root, 'config', 'user.name', 'RIFF test');
  writeFileSync(path.join(root, 'README.md'), 'snapshot fixture\n');
  git(root, 'add', 'README.md');
  git(root, 'commit', '-qm', 'fixture');
  return root;
}

describe('Git metadata snapshots', () => {
  it('captures a single-worktree Git directory once when common and private paths match', () => {
    const root = createRepository();
    try {
      const snapshot = snapshotWorktree({ root });
      expect(snapshot.git_metadata_roots.worktree).toBe(snapshot.git_metadata_roots.common);
      expect(Object.keys(snapshot.git_metadata).some((entry) => entry.startsWith('common/'))).toBe(false);
      expect(Object.keys(snapshot.git_metadata)).toContain('worktree/.');
      expect(Object.keys(snapshot.git_metadata).filter((entry) => entry === 'worktree/.')).toHaveLength(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects common and worktree metadata mutations from a real linked worktree', () => {
    const root = createRepository();
    const linked = path.join(path.dirname(root), `${path.basename(root)}-linked`);
    try {
      git(root, 'branch', 'riff-linked');
      git(root, 'worktree', 'add', '-q', linked, 'riff-linked');

      const before = snapshotWorktree({ root: linked });
      const commonRoot = before.git_metadata_roots.common;
      const worktreeRoot = before.git_metadata_roots.worktree;
      expect(commonRoot).not.toBe(worktreeRoot);
      expect(Object.keys(before.git_metadata)).toContain('common/config');
      expect(Object.keys(before.git_metadata)).toContain('worktree/HEAD');

      appendFileSync(path.join(commonRoot, 'config'), '\n[riff-snapshot]\ncommon = changed\n');
      mkdirSync(path.join(commonRoot, 'hooks'), { recursive: true });
      writeFileSync(path.join(commonRoot, 'hooks', 'riff-snapshot-hook'), '#!/bin/sh\n');
      mkdirSync(path.join(commonRoot, 'refs', 'heads'), { recursive: true });
      writeFileSync(path.join(commonRoot, 'refs', 'heads', 'riff-snapshot-ref'), `${git(linked, 'rev-parse', 'HEAD')}\n`);

      const afterCommon = snapshotWorktree({ root: linked });
      const commonComparison = compareSnapshots(before, afterCommon);
      expect(commonComparison.clean).toBe(false);
      expect(commonComparison.git_metadata_changed).toBe(true);
      expect(commonComparison.git_metadata_changed_paths).toEqual(expect.arrayContaining([
        'common/config',
        'common/hooks/riff-snapshot-hook',
        'common/refs/heads/riff-snapshot-ref',
      ]));

      writeFileSync(path.join(worktreeRoot, 'riff-snapshot-private'), 'private metadata\n');
      const afterWorktree = snapshotWorktree({ root: linked });
      const worktreeComparison = compareSnapshots(afterCommon, afterWorktree);
      expect(worktreeComparison.clean).toBe(false);
      expect(worktreeComparison.git_metadata_changed).toBe(true);
      expect(worktreeComparison.git_metadata_changed_paths).toContain('worktree/riff-snapshot-private');
    } finally {
      rmSync(linked, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});

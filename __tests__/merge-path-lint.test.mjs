import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Returns the slice of `text` starting at the first line that begins with
 * `headingPrefix`, up to (but not including) the next heading line of the
 * same or higher level — or end of file. Throws if the heading is missing so
 * a renamed heading fails the test instead of silently passing.
 */
function section(text, headingPrefix) {
  const lines = text.split('\n');
  const startIndex = lines.findIndex((line) => line.startsWith(headingPrefix));
  if (startIndex === -1) {
    throw new Error(`Heading starting with "${headingPrefix}" not found`);
  }
  const startLevel = lines[startIndex].match(/^#+/)[0].length;
  let endIndex = lines.length;
  for (let i = startIndex + 1; i < lines.length; i += 1) {
    const match = lines[i].match(/^(#+)\s/);
    if (match && match[1].length <= startLevel) {
      endIndex = i;
      break;
    }
  }
  return lines.slice(startIndex, endIndex).join('\n');
}

describe('merge-path lint: every merge path calls the finisher guard', () => {
  it('commands/next.md § Step 8 cites the guard', () => {
    const text = readFileSync(path.join(repoRoot, 'commands/next.md'), 'utf8');
    expect(section(text, '### Step 8')).toContain('finisher-guard.mjs');
  });

  it('commands/wave.md § Step 6.2 cites the guard', () => {
    const text = readFileSync(path.join(repoRoot, 'commands/wave.md'), 'utf8');
    expect(section(text, '### Step 6.2')).toContain('finisher-guard.mjs');
  });

  it('protocols/PR-CREATION.md § 8b dispatcher cites the guard', () => {
    const text = readFileSync(path.join(repoRoot, 'protocols/PR-CREATION.md'), 'utf8');
    expect(section(text, '## 8b')).toContain('finisher-guard.mjs');
  });

  it('protocols/PR-CREATION.md § 8c cites the guard', () => {
    const text = readFileSync(path.join(repoRoot, 'protocols/PR-CREATION.md'), 'utf8');
    expect(section(text, '## 8c')).toContain('finisher-guard.mjs');
  });

  it('protocols/WAVE-RECONCILE.md § 5 cites the guard', () => {
    const text = readFileSync(path.join(repoRoot, 'protocols/WAVE-RECONCILE.md'), 'utf8');
    expect(section(text, '### 5')).toContain('finisher-guard.mjs');
  });

  it('protocols/AUTONOMY.md § Merge policy cites the guard', () => {
    const text = readFileSync(path.join(repoRoot, 'protocols/AUTONOMY.md'), 'utf8');
    expect(section(text, '## Merge policy')).toContain('finisher-guard.mjs');
  });
});

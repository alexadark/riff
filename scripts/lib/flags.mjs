// Flag ledger reading — mirrors finishers.mjs but for the NON-blocking flags
// written by `autonomy-state.mjs flag` (protocols/AUTONOMY.md § Flags,
// `autonomy.hold_behavior: flag_and_continue`). finisher-guard.mjs never
// reads this module or the `flags/` directory: a pending flag can never
// block a merge, by construction — it is bookkeeping for the one-time
// specialist review at the production boundary (§ Specialist gate), not a
// no-merge marker.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { parseFinishers, serializeFinishers } from './finishers.mjs';

export { parseFinishers as parseFlags, serializeFinishers as serializeFlags };

function walkFlagFiles(projectRoot) {
  const root = path.join(projectRoot, '.planning/autonomy');
  const files = [];
  const errors = [];
  if (!existsSync(root)) return { files, errors };

  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      errors.push({ file: current, reason: error.message });
      return;
    }
    const inFlagsDir = path.basename(current) === 'flags';
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(child);
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch (error) {
          errors.push({ file: child, reason: `broken symlink: ${error.message}` });
          continue;
        }
      }
      if (isDir) {
        walk(child);
      } else if (isFile && inFlagsDir && entry.name.endsWith('.yaml')) {
        files.push(child);
      }
    }
  }

  walk(root);
  files.sort();
  return { files, errors };
}

export function listFlagFiles(projectRoot) {
  return walkFlagFiles(projectRoot).files;
}

/** Every flag across the project (pending and resolved), each tagged with its source file. */
export function collectFlags(projectRoot) {
  const entries = [];
  const malformed = [];
  const walked = walkFlagFiles(projectRoot);
  const unreadable = [...walked.errors];
  for (const file of walked.files) {
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      unreadable.push({ file, reason: error.message });
      continue;
    }
    const parsed = parseFinishers(text);
    for (const entry of parsed.entries) entries.push({ ...entry, run: parsed.run, file });
    for (const bad of parsed.malformed) malformed.push({ ...bad, file });
  }
  return { entries, malformed, unreadable };
}

/** `status: pending` flags only — the ones still awaiting the specialist. */
export function collectPendingFlags(projectRoot) {
  const { entries, malformed, unreadable } = collectFlags(projectRoot);
  return { pending: entries.filter((entry) => entry.status === 'pending'), malformed, unreadable };
}

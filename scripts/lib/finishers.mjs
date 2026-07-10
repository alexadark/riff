// Shared finishers.yaml reading for finisher-guard.mjs, autonomy-state.mjs,
// and riff-pending.mjs. One tolerant parser so a malformed ledger is never
// silently dropped by one consumer while another sees it.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const FIELD_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/;

function stripComment(line) {
  return line.replace(/\s+#.*$/, '').trimEnd();
}

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

/**
 * Tolerant line-based parse of a finishers.yaml file.
 *
 * An entry starts on ANY `- <key>: <value>` line (not just `- id:`), so a
 * hand-written ledger with fields in a different order is still read. Entries
 * missing `id` or `status` are reported in `malformed`, never dropped
 * silently.
 *
 * Returns { run, entries, malformed } where malformed is a list of
 * { line, reason, entry } describing every rejected entry.
 */
export function parseFinishers(text) {
  let run = null;
  let current;
  let currentLine = 0;
  const entries = [];
  const malformed = [];

  function pushCurrent() {
    if (!current) return;
    if (!current.id || !current.status) {
      const missing = ['id', 'status'].filter((key) => !current[key]).join(', ');
      malformed.push({ line: currentLine, reason: `missing ${missing}`, entry: current });
    } else {
      entries.push(current);
    }
    current = undefined;
  }

  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = stripComment(lines[index]);
    if (!line.trim()) continue;
    const trimmed = line.trim();

    const runMatch = trimmed.match(/^run:\s*(.+?)\s*$/);
    if (runMatch && lines[index].match(/^\s*/)[0].length === 0) {
      run = unquote(runMatch[1]);
      continue;
    }
    if (/^finishers:\s*$/.test(trimmed)) continue;

    const itemMatch = line.match(/^\s*-\s+(.+?)\s*$/);
    if (itemMatch) {
      pushCurrent();
      current = {};
      currentLine = index + 1;
      const fieldMatch = itemMatch[1].match(FIELD_PATTERN);
      if (fieldMatch) {
        current[fieldMatch[1]] = unquote(fieldMatch[2]);
      } else {
        // `- <bare value>` — keep the raw text so the malformed report is useful
        current._raw = itemMatch[1];
      }
      continue;
    }

    if (!current) continue;
    const fieldMatch = trimmed.match(FIELD_PATTERN);
    if (fieldMatch) current[fieldMatch[1]] = unquote(fieldMatch[2]);
  }
  pushCurrent();

  return { run, entries, malformed };
}

/**
 * Serialize a { run, entries } ledger back to the flat finishers.yaml shape
 * documented in protocols/AUTONOMY.md. Field order is stable so diffs stay
 * readable.
 */
export function serializeFinishers({ run, entries }) {
  const FIELD_ORDER = ['id', 'type', 'phase', 'branch', 'waiting_on', 'artifact', 'status', 'created'];
  const lines = [`run: ${run}`, 'finishers:'];
  for (const entry of entries) {
    const keys = [
      ...FIELD_ORDER.filter((key) => entry[key] !== undefined && entry[key] !== null),
      ...Object.keys(entry).filter((key) => !FIELD_ORDER.includes(key) && !key.startsWith('_')),
    ];
    keys.forEach((key, position) => {
      const prefix = position === 0 ? '  - ' : '    ';
      const value = String(entry[key]);
      const needsQuotes = /[:#]/.test(value) || /^\s|\s$/.test(value);
      lines.push(`${prefix}${key}: ${needsQuotes ? JSON.stringify(value) : value}`);
    });
  }
  return `${lines.join('\n')}\n`;
}

/**
 * All finisher marker files under <projectRoot>/.planning/autonomy/, sorted.
 * Two layouts, both read: one file per finisher in a `finishers/` directory
 * (the write path — concurrent parks cannot lose each other's marker), and
 * legacy single-ledger `finishers.yaml` files (read-only back-compat).
 */
export function listFinisherFiles(projectRoot) {
  return walkFinisherFiles(projectRoot).files;
}

/**
 * Walk that also reports unreadable DIRECTORIES: a directory that exists but
 * cannot be listed may hide marker files, so consumers must fail closed on it
 * exactly like an unreadable marker file. A missing root is fine (no
 * autonomy state yet) — only errors on things that exist are reported.
 */
function walkFinisherFiles(projectRoot) {
  const root = path.join(projectRoot, '.planning/autonomy');
  const files = [];
  const errors = [];
  if (!existsSync(root)) {
    // existsSync FOLLOWS symlinks and swallows errors: a broken symlink at
    // the autonomy root, or a root we lack permission to inspect, reads as
    // "absent". Only ENOENT is genuine absence; everything else is damaged
    // or unreachable evidence and must fail closed.
    try {
      lstatSync(root);
      errors.push({ file: root, reason: 'autonomy root is a broken symlink — its marker store is unreachable' });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        errors.push({ file: root, reason: `cannot inspect autonomy root: ${error.message}` });
      }
      // ENOENT: genuinely absent, no autonomy state yet
    }
    return { files, errors };
  }

  function walk(current) {
    let dirEntries;
    try {
      dirEntries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      errors.push({ file: current, reason: error.message });
      return;
    }
    const inFinishersDir = path.basename(current) === 'finishers';
    for (const entry of dirEntries) {
      const child = path.join(current, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        // follow symlinks instead of silently skipping them — a symlinked
        // marker (or marker directory) must still count; a broken link is
        // unreadable evidence, not nothing
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
      } else if (isFile
        && (entry.name === 'finishers.yaml' || (inFinishersDir && entry.name.endsWith('.yaml')))) {
        files.push(child);
      }
    }
  }

  walk(root);
  files.sort();
  return { files, errors };
}

/**
 * Every `status: pending` finisher across the project, each tagged with the
 * file it came from. Malformed entries are aggregated so callers can warn.
 * A marker file that EXISTS but cannot be read is reported in `unreadable` —
 * it may reference any branch, so consumers must fail closed on it (the
 * guard refuses all merges until the file is fixed), never skip it silently.
 */
export function collectPendingFinishers(projectRoot) {
  const pending = [];
  const malformed = [];
  const walked = walkFinisherFiles(projectRoot);
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
    for (const entry of parsed.entries) {
      if (entry.status === 'pending') pending.push({ ...entry, run: parsed.run, file });
    }
    for (const bad of parsed.malformed) malformed.push({ ...bad, file });
  }
  return { pending, malformed, unreadable };
}

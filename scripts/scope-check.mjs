#!/usr/bin/env node
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    phase: undefined,
    plan: undefined,
    summary: undefined,
    out: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const next = argv[i + 1];
    if (token === '-h' || token === '--help') {
      process.stdout.write(`Usage: node scripts/scope-check.mjs --phase <N-slug|path> [--project-root <path>]\n`);
      process.exit(0);
    }
    if (['--project-root', '--phase', '--plan', '--summary', '--out'].includes(token)) {
      if (!next || next.startsWith('--')) fail(`${token} requires a value`);
      args[token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = next;
      i += 1;
      continue;
    }
    fail(`Unknown argument: ${token}`);
  }
  args.projectRoot = path.resolve(args.projectRoot);
  return args;
}

function resolvePhaseDir(root, phase) {
  if (!phase) return undefined;
  const direct = path.resolve(root, phase);
  if (existsSync(direct)) return direct;
  const phaseRoot = path.join(root, '.planning', 'phases');
  if (!existsSync(phaseRoot)) return direct;
  const normalized = phase.replace(/^\.planning\/phases\//, '').replace(/\/$/, '');
  const exact = path.join(phaseRoot, normalized);
  if (existsSync(exact)) return exact;
  const match = readdirSync(phaseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .find((name) => name === normalized || name.startsWith(`${normalized}-`));
  return match ? path.join(phaseRoot, match) : exact;
}

function stripMarkdown(value) {
  return value
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[[ xX]\]\s*/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'be', 'by', 'do', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'per', 'the', 'to', 'with', 'task', 'phase',
  'add', 'update', 'create', 'remove', 'fix', 'wire', 'ensure', 'implement',
]);

function normalize(value) {
  return stripMarkdown(value)
    .toLowerCase()
    .replace(/^task\s*[\w.-]*\s*:?\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value) {
  return normalize(value)
    .split(' ')
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function linesWithNumbers(text) {
  return text.split(/\r?\n/).map((textLine, index) => ({ text: textLine, line: index + 1 }));
}

function headingLevel(line) {
  const match = line.match(/^(#{1,6})\s+/);
  return match ? match[1].length : 0;
}

function section(lines, headingPattern) {
  const start = lines.findIndex(({ text }) => headingPattern.test(text));
  if (start === -1) return { exists: false, lines: [] };
  const level = headingLevel(lines[start].text);
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const currentLevel = headingLevel(lines[index].text);
    if (currentLevel > 0 && currentLevel <= level) break;
    body.push(lines[index]);
  }
  return { exists: true, lines: body };
}

// A "group header" is a wave/phase grouping heading like
// `### Wave 1 — parallel [36-01a, 36-01b]`, `## Wave 2 — sequential`, or
// `#### Wave 1 (parallel: [40-01, 40-02])`. These are containers, not tasks:
// they must never become a task. Instead we lift any task IDs out of the title.
function groupHeaderTaskIds(headingText) {
  if (!/^\s*wave\s*\d/i.test(stripMarkdown(headingText))) return null;
  // Task IDs look like `40-01`, `36-01a`, `39-02` (with optional letter suffix),
  // whether bracketed (`[40-01, 40-02]`) or bare in the title (`Wave 2 — 39-02 ...`).
  const ids = stripMarkdown(headingText).match(/\b\d{1,3}-\d{1,3}[a-z]?\b/gi) || [];
  return ids.map((id) => id.toLowerCase());
}

function parsePlannedTasks(planText) {
  const lines = linesWithNumbers(planText);
  // Source selection: prefer `## Tasks`; else `## Wave(s)` / `## Steps`; else
  // scan the whole document so wave-bundle PLANs (tasks under `## Wave N`) still parse.
  const taskSection = section(lines, /^##\s+Tasks\b/i);
  let source;
  // `wholeDoc`: no explicit task section exists, so we scan every line. In that
  // mode ONLY headings count as tasks (numbered lists / checkboxes elsewhere —
  // "Truths when done", browser-check journeys, AC lists — must NOT be tasks).
  let wholeDoc = false;
  if (taskSection.exists) {
    source = taskSection.lines;
  } else {
    // Match the canonical overview section `## Waves` / `## Steps`, but NOT a
    // wave group header like `## Wave 1 — ...` (no trailing number / extra words).
    const waveSection = section(lines, /^##\s+(Waves?|Steps)\s*$/i);
    if (waveSection.exists) {
      source = waveSection.lines;
    } else {
      source = lines;
      wholeDoc = true;
    }
  }
  const tasks = [];

  for (const entry of source) {
    const heading = entry.text.match(/^#{2,6}\s+(.+?)\s*$/);
    if (heading) {
      // Group headers (`Wave N ...`) are transparent: lift bracketed/bare task
      // IDs out of the title and never treat the header itself as a task. Real
      // task sub-headings under the group are still collected on later iterations.
      const groupIds = groupHeaderTaskIds(heading[1]);
      if (groupIds) {
        for (const id of groupIds) {
          const normalizedId = normalize(id);
          if (normalizedId) tasks.push({ id: normalizedId, source_line: entry.line });
        }
        continue;
      }
      // Canonical task heading (`### Task N: ...`), wave-style ID heading
      // (`### NN-NN ...` / `#### NN-NN ...`). H2 non-group headings are ignored
      // when scanning the whole doc (only `#{3,6}` are real tasks).
      if (headingLevel(entry.text) < 3) continue;
      const id = normalize(heading[1]);
      if (id) tasks.push({ id, source_line: entry.line });
      continue;
    }
    // In whole-doc fallback mode, only headings are tasks. Numbered lists and
    // checkboxes are only task forms inside an explicit `## Tasks`/`## Waves` section.
    if (wholeDoc) continue;
    // Wave-style bold task definition: `**36-01a — Schema + consent service ...**`
    // (a whole-line bold span starting with an `NN-NN` task ID). Captures the full
    // descriptive title so token matching against the SUMMARY works.
    const boldTask = entry.text.match(/^\s*\*\*\s*(\d{1,3}-\d{1,3}[a-z]?\b.*?)\s*\*\*\s*$/);
    if (boldTask) {
      const id = normalize(boldTask[1]);
      if (id) tasks.push({ id, source_line: entry.line });
      continue;
    }
    const checked = entry.text.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+?)\s*$/);
    if (checked) {
      const id = normalize(checked[1]);
      if (id) tasks.push({ id, source_line: entry.line });
      continue;
    }
    const numbered = entry.text.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
    if (numbered) {
      const id = normalize(numbered[1]);
      if (id) tasks.push({ id, source_line: entry.line });
    }
  }

  const seen = new Set();
  const deduped = tasks.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });

  // Drop bare-ID tasks (e.g. `40 01` lifted from a group header) when a richer
  // task heading already covers the same ID (e.g. `40 01 landing route ...`).
  // Keeps wave-only IDs (like `39 02`, with no sub-heading) intact.
  return deduped.filter((task) => {
    if (!/^\d{1,3} \d{1,3}[a-z]?$/.test(task.id)) return true;
    const prefix = `${task.id} `;
    return !deduped.some((other) => other !== task && other.id.startsWith(prefix));
  });
}

function parsePlannedSmokes(planText) {
  const lines = linesWithNumbers(planText);
  const smoke = section(lines, /^##\s+Smoke\b/i);
  if (!smoke.exists) return { sectionExists: false, smokes: [] };
  const smokes = smoke.lines
    .map((entry) => {
      const match = entry.text.match(/^\s*[-*]\s+`([^`]+)`\s*(?:→|->)\s*(.*)$/);
      return match ? { command: match[1].trim(), expected: match[2].trim(), source_line: entry.line } : undefined;
    })
    .filter(Boolean);
  return { sectionExists: true, smokes };
}

function parseSummaryStatus(summaryText) {
  const status = section(linesWithNumbers(summaryText), /^##\s+Status\b/i);
  for (const entry of status.lines) {
    const value = normalize(entry.text.replace(/^\*+|\*+$/g, ''));
    if (['completed', 'partial', 'blocked'].includes(value)) return value;
  }
  return undefined;
}

function parseSmokeResults(summaryText) {
  const smokeResults = section(linesWithNumbers(summaryText), /^##\s+Smoke Results\b/i);
  const results = [];
  for (const entry of smokeResults.lines) {
    const line = entry.text.trim();
    if (!line.startsWith('|')) {
      const bullet = line.match(/^\s*[-*]\s+`([^`]+)`.*\b(pass|fail|skipped)\b/i);
      if (bullet) results.push({ command: bullet[1].trim(), status: bullet[2].toLowerCase(), observed: '' });
      continue;
    }
    if (/^\|\s*-+/.test(line) || /\bCommand\b.*\bStatus\b/i.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const statusCell = cells.findLast((cell) => /^(pass|fail|skipped)$/i.test(cell));
    if (!statusCell) continue;
    results.push({
      command: stripMarkdown(cells[0]),
      expected: cells[1] || '',
      observed: cells[2] || '',
      status: statusCell.toLowerCase(),
    });
  }
  return results;
}

function summaryAcknowledges(task, summaryText) {
  const haystack = normalize(summaryText);
  if (!task.id) return false;
  if (haystack.includes(task.id)) return true;
  const taskTokens = tokens(task.id);
  if (taskTokens.length === 0) return false;
  const matched = taskTokens.filter((token) => haystack.includes(token)).length;
  const required = taskTokens.length <= 3 ? taskTokens.length : Math.ceil(taskTokens.length * 0.6);
  return matched >= required;
}

function commandMatches(command, resultCommand) {
  const a = normalize(command);
  const b = normalize(resultCommand);
  return a === b || a.includes(b) || b.includes(a);
}

function codeTouched(planText, summaryText) {
  return /\b(src|app|lib|pkg|cmd|server|client|routes?)\//.test(`${planText}\n${summaryText}`);
}

function malformed(verdict, reason, phaseName, plannedTasks = []) {
  return {
    schema_version: 2,
    phase: phaseName,
    generated_at: new Date().toISOString(),
    verdict,
    planned_tasks: plannedTasks,
    completed_tasks: [],
    unmatched_tasks: verdict === 'DROPPED' ? plannedTasks : [],
    planned_smokes: [],
    smoke_results: [],
    unmatched_smokes: [],
    failed_smokes: [],
    smoke_too_thin: false,
    malformed_reason: verdict === 'MALFORMED' ? reason : null,
  };
}

function buildReport({ phaseName, planText, summaryText }) {
  const plannedTasks = parsePlannedTasks(planText);
  if (plannedTasks.length === 0) {
    return malformed('MALFORMED', 'PLAN.md has no parseable Tasks section', phaseName);
  }

  const completedTasks = [];
  const unmatchedTasks = [];
  for (const task of plannedTasks) {
    if (summaryAcknowledges(task, summaryText)) {
      completedTasks.push({ id: task.id, matched_planned: task.id });
    } else {
      unmatchedTasks.push(task);
    }
  }

  const { sectionExists: smokeSectionExists, smokes: plannedSmokes } = parsePlannedSmokes(planText);
  const smokeResults = parseSmokeResults(summaryText);
  const unmatchedSmokes = smokeSectionExists
    ? plannedSmokes.filter((smoke) => !smokeResults.some((result) => commandMatches(smoke.command, result.command)))
    : [];
  const failedSmokes = smokeResults
    .filter((result) => result.status === 'fail')
    .map((result) => ({ command: result.command, observed: result.observed || 'failed smoke result' }));
  const smokeTooThin = smokeSectionExists && plannedSmokes.length < 2 && codeTouched(planText, summaryText);
  const status = parseSummaryStatus(summaryText);

  let verdict = 'MATCH';
  let malformedReason = null;
  if (status === 'completed' && failedSmokes.length > 0) {
    verdict = 'MALFORMED';
    malformedReason = 'SUMMARY.md status is completed but at least one smoke failed';
  } else if (
    unmatchedTasks.length > 0
    || unmatchedSmokes.length > 0
    || failedSmokes.length > 0
    || smokeTooThin
  ) {
    verdict = 'DROPPED';
  }

  return {
    schema_version: 2,
    phase: phaseName,
    generated_at: new Date().toISOString(),
    verdict,
    planned_tasks: plannedTasks,
    completed_tasks: completedTasks,
    unmatched_tasks: unmatchedTasks,
    planned_smokes: plannedSmokes,
    smoke_results: smokeResults,
    unmatched_smokes: unmatchedSmokes,
    failed_smokes: failedSmokes,
    smoke_too_thin: smokeTooThin,
    malformed_reason: malformedReason,
  };
}

const args = parseArgs(process.argv.slice(2));
const phaseDir = resolvePhaseDir(args.projectRoot, args.phase);
const planPath = args.plan ? path.resolve(args.projectRoot, args.plan) : path.join(phaseDir || '', 'PLAN.md');
const summaryPath = args.summary ? path.resolve(args.projectRoot, args.summary) : path.join(phaseDir || '', 'SUMMARY.md');
const outPath = args.out ? path.resolve(args.projectRoot, args.out) : path.join(phaseDir || '', 'SCOPE-CHECK.json');
const phaseName = phaseDir ? path.basename(phaseDir) : path.basename(path.dirname(outPath));

let report;
if (!existsSync(planPath)) {
  report = malformed('MALFORMED', `PLAN.md not found: ${planPath}`, phaseName);
} else if (!existsSync(summaryPath)) {
  report = malformed('MALFORMED', `SUMMARY.md not found: ${summaryPath}`, phaseName, parsePlannedTasks(readFileSync(planPath, 'utf8')));
} else {
  report = buildReport({
    phaseName,
    planText: readFileSync(planPath, 'utf8'),
    summaryText: readFileSync(summaryPath, 'utf8'),
  });
}

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.exit(report.verdict === 'MATCH' ? 0 : 1);

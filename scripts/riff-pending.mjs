#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPendingFinishers } from './lib/finishers.mjs';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);

// stay pipeable: `riff-pending | head` closes stdout early — exit clean, not EPIPE crash
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

const TYPE_PRIORITY = {
  INCONSISTENT: -1,
  security: 0,
  payment: 1,
  branch: 2,
  ux: 3,
  review: 4,
  decision: 5,
};

const items = [];
const branchItems = [];
const warnings = [];

function usage(message) {
  process.stderr.write(`${message}\n`);
  process.stderr.write('usage: riff-pending [--json] [--branches] [--registry <file>]\n');
  process.exit(1);
}

function parseArgs() {
  const options = { json: false, branches: false, registry: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--branches') {
      options.branches = true;
    } else if (arg === '--registry') {
      const file = argv[index + 1];
      if (!file || file.startsWith('--')) usage('--registry requires a file');
      options.registry = file;
      index += 1;
    } else if (arg.startsWith('--')) {
      usage(`unrecognized flag: ${arg}`);
    } else {
      usage(`unexpected argument: ${arg}`);
    }
  }
  return options;
}

function warn(message) {
  warnings.push(message);
}

function stripComment(line) {
  return line.replace(/\s+#.*$/, '').trimEnd();
}

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function rel(projectPath, file) {
  return path.relative(projectPath, file).replaceAll(path.sep, '/');
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    warn(`could not read ${file}: ${error.message}`);
    return undefined;
  }
}

function isDirectory(file) {
  try {
    return statSync(file).isDirectory();
  } catch {
    return false;
  }
}

function parseRegistryFile(file) {
  const text = readText(file);
  if (text === undefined) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

function profileFile() {
  const userProfile = path.join(frameworkRoot, 'profile.yaml');
  if (existsSync(userProfile)) return userProfile;
  return path.join(frameworkRoot, 'templates/profile.default.yaml');
}

function parseDashboardProjects(text) {
  const lines = text.split(/\r?\n/);
  let dashboardIndent;
  let projectsIndent;
  const projects = [];

  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();

    if (dashboardIndent === undefined) {
      if (/^dashboard:\s*$/.test(trimmed)) dashboardIndent = indent;
      continue;
    }

    if (indent <= dashboardIndent && /^[A-Za-z_][A-Za-z0-9_]*:/.test(trimmed)) break;

    if (projectsIndent === undefined) {
      const match = trimmed.match(/^projects:\s*(\[\])?\s*$/);
      if (match) {
        projectsIndent = indent;
        if (match[1]) break;
      }
      continue;
    }

    if (indent <= projectsIndent && /^[A-Za-z_][A-Za-z0-9_]*:/.test(trimmed)) break;
    if (indent <= projectsIndent) continue;

    const match = trimmed.match(/^-\s+(.+?)\s*$/);
    if (match) projects.push(unquote(match[1]));
  }

  return projects;
}

function registryProjects(options) {
  if (options.registry) return parseRegistryFile(options.registry);
  const text = readText(profileFile());
  if (text === undefined) return [];
  return parseDashboardProjects(text);
}

function listFiles(dir, fileName) {
  const results = [];
  if (!existsSync(dir)) return results;

  function walk(current) {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch (error) {
      warn(`could not read directory ${current}: ${error.message}`);
      return;
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile() && entry.name === fileName) {
        results.push(child);
      }
    }
  }

  walk(dir);
  return results.sort();
}

function branchListOutput(projectPath, args) {
  try {
    return execFileSync('git', ['-C', projectPath, 'branch', '--list', ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

function branchExistsLocally(projectPath, branch) {
  return branchListOutput(projectPath, [branch]).length > 0;
}

function isBranchMergedIntoBase(projectPath, branch, base) {
  return branchListOutput(projectPath, [branch, '--merged', base]).length > 0;
}

// Merged-branch integrity check: only claim INCONSISTENT when the branch
// still exists locally AND `git branch --merged` confirms it landed on main
// (or master). No local branch to inspect -> no claim, leave it alone.
function isBranchMerged(projectPath, branch) {
  if (!branchExistsLocally(projectPath, branch)) return false;
  return isBranchMergedIntoBase(projectPath, branch, 'main')
    || isBranchMergedIntoBase(projectPath, branch, 'master');
}

function collectFinishers(projectPath, projectName) {
  const { pending, malformed } = collectPendingFinishers(projectPath);

  for (const bad of malformed) {
    warn(`malformed finisher entry in ${rel(projectPath, bad.file)}:${bad.line} (${bad.reason}) — fix it, it is NOT counted`);
  }

  for (const entry of pending) {
    let type = entry.type || 'unknown';
    let waitingOn = entry.waiting_on || null;

    if (entry.branch && isBranchMerged(projectPath, entry.branch)) {
      type = 'INCONSISTENT';
      waitingOn = `pending finisher on already-merged branch ${entry.branch} — integrity error, resolve the finisher`;
    }

    items.push({
      project: projectName,
      projectPath,
      type,
      phase: entry.phase || null,
      waiting_on: waitingOn,
      artifact: entry.artifact || rel(projectPath, entry.file),
      branch: entry.branch || null,
      run: entry.run,
      created: entry.created || null,
    });
  }
}

function truncate(value, max) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function collectDecisions(projectPath, projectName) {
  const root = path.join(projectPath, '.planning/autonomy');
  const files = listFiles(root, 'DECISIONS.md');

  for (const file of files) {
    const text = readText(file);
    if (text === undefined) continue;
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('- [ ] ')) continue;
      items.push({
        project: projectName,
        projectPath,
        type: 'decision',
        phase: null,
        waiting_on: truncate(line.slice('- [ ] '.length).trim(), 120),
        artifact: rel(projectPath, file),
        branch: null,
        run: null,
        created: null,
      });
    }
  }
}

function parseRoadmapNeedsReview(text) {
  const phases = [];
  let current;

  function pushCurrent() {
    if (current?.needsReview) phases.push(current.id || current.slug || null);
    current = undefined;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (!line.trim()) continue;
    const itemMatch = line.match(/^(\s*)-\s*(.*)$/);
    if (itemMatch) {
      pushCurrent();
      current = {};
      const inline = itemMatch[2].trim();
      const fieldMatch = inline.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
      if (fieldMatch) current[fieldMatch[1]] = unquote(fieldMatch[2]);
      continue;
    }
    if (!current) continue;
    const fieldMatch = line.trim().match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!fieldMatch) continue;
    const key = fieldMatch[1];
    const value = unquote(fieldMatch[2]);
    if (key === 'status' && value === 'needs_human_review') current.needsReview = true;
    if (key === 'id' || key === 'slug') current[key] = value;
  }
  pushCurrent();

  return phases.filter(Boolean);
}

function collectRoadmap(projectPath, projectName) {
  const file = path.join(projectPath, 'ROADMAP.yaml');
  if (!existsSync(file)) return;
  const text = readText(file);
  if (text === undefined) return;
  for (const phase of parseRoadmapNeedsReview(text)) {
    items.push({
      project: projectName,
      projectPath,
      type: 'review',
      phase,
      waiting_on: 'phase needs human review',
      artifact: rel(projectPath, file),
      branch: null,
      run: null,
      created: null,
    });
  }
}

function gitBranches(projectPath, base) {
  return execFileSync('git', [
    '-C',
    projectPath,
    'branch',
    '--list',
    'riff/*',
    '--no-merged',
    base,
    '--format',
    '%(refname:short)',
  ], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).split('\n').map((line) => line.trim()).filter(Boolean);
}

function collectBranches(projectPath, projectName) {
  let branches;
  try {
    branches = gitBranches(projectPath, 'main');
  } catch {
    try {
      branches = gitBranches(projectPath, 'master');
    } catch {
      return;
    }
  }

  // Branches referenced by a pending finisher already surface via the
  // finisher item itself — don't duplicate them here.
  const finisherBranches = new Set(items
    .filter((item) => item.projectPath === projectPath && item.branch)
    .map((item) => item.branch));

  for (const branch of branches) {
    if (finisherBranches.has(branch)) continue;
    branchItems.push({
      project: projectName,
      projectPath,
      branch,
      waiting_on: 'unmerged branch',
    });
  }
}

function collectProject(projectPath) {
  if (!isDirectory(projectPath)) {
    warn(`project directory missing: ${projectPath}`);
    return;
  }
  const projectName = path.basename(projectPath);
  collectFinishers(projectPath, projectName);
  collectDecisions(projectPath, projectName);
  collectRoadmap(projectPath, projectName);
  collectBranches(projectPath, projectName);
}

function compareItems(left, right) {
  const leftPriority = TYPE_PRIORITY[left.type] ?? 99;
  const rightPriority = TYPE_PRIORITY[right.type] ?? 99;
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  if (left.project !== right.project) return left.project.localeCompare(right.project);
  if (left.created && right.created && left.created !== right.created) return left.created.localeCompare(right.created);
  if (left.created && !right.created) return -1;
  if (!left.created && right.created) return 1;
  return (left.waiting_on || '').localeCompare(right.waiting_on || '');
}

function compareBranches(left, right) {
  if (left.project !== right.project) return left.project.localeCompare(right.project);
  return left.branch.localeCompare(right.branch);
}

function outputTarget(item) {
  return item.artifact || item.branch || '';
}

function textOutput(options) {
  if (items.length === 0) {
    process.stdout.write('riff pending: inbox clean\n');
  } else {
    const projectCount = new Set(items.map((item) => item.projectPath)).size;
    process.stdout.write(`riff pending: ${items.length} item(s) across ${projectCount} project(s)\n`);

    const rows = items.map((item) => ({
      project: item.project,
      type: item.type.toUpperCase(),
      waiting: item.waiting_on || '',
      target: outputTarget(item),
    }));
    const projectWidth = Math.max(...rows.map((row) => row.project.length));
    const typeWidth = Math.max(...rows.map((row) => row.type.length));
    const waitingWidth = Math.max(...rows.map((row) => row.waiting.length));

    for (const row of rows) {
      process.stdout.write(`${row.project.padEnd(projectWidth)}  ${row.type.padEnd(typeWidth)}  ${row.waiting.padEnd(waitingWidth)}  -> ${row.target}\n`);
    }
  }

  for (const warning of warnings) {
    process.stdout.write(`warn: ${warning}\n`);
  }

  if (options.branches && branchItems.length > 0) {
    process.stdout.write('--- unmerged riff/* branches (hygiene) ---\n');
    const projectWidth = Math.max(...branchItems.map((row) => row.project.length));
    for (const row of branchItems) {
      process.stdout.write(`${row.project.padEnd(projectWidth)}  BRANCH  ${row.waiting_on}  -> ${row.branch}\n`);
    }
  }
}

function jsonOutput() {
  process.stdout.write(`${JSON.stringify({
    generated_by: 'riff-pending',
    items,
    branches: branchItems,
    warnings,
  }, null, 2)}\n`);
}

function dedupeByInode(paths) {
  const seen = new Set();
  const unique = [];
  for (const projectPath of paths) {
    let key = projectPath;
    try {
      const stats = statSync(projectPath);
      key = `${stats.dev}:${stats.ino}`;
    } catch {
      // missing dirs keep their raw path as key; collectProject warns about them
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(projectPath);
  }
  return unique;
}

function main() {
  const options = parseArgs();
  for (const projectPath of dedupeByInode(registryProjects(options))) {
    collectProject(projectPath);
  }
  items.sort(compareItems);
  branchItems.sort(compareBranches);
  if (options.json) {
    jsonOutput();
  } else {
    textOutput(options);
  }
  // deterministic inbox, not a gate — always exit 0
  process.exitCode = 0;
}

main();

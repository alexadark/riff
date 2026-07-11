#!/usr/bin/env node
// Deterministic engine for the cross-project Conductor (protocols/CONDUCTOR.md).
// Selection/eligibility, dry-run planning, conductor run state, and the STOP
// check live here; the orchestration (launching each project's autonomous
// loop, composing the report, notifying) lives in commands/conductor.md.
//
// The Conductor NEVER merges, never edits autonomy state by hand, and never
// reimplements lock/resume logic — it imports lockStatus/resolveLaunch/
// classifyPhase from autonomy-state.mjs and the finisher rules from
// finisher-guard.mjs, so a hardening fix there is automatically a fix here.
//
// CLI:
//   node scripts/riff-conductor.mjs plan [--json] [--scheduled] [--projects a,b] [--registry <file>] [--state-root <dir>]
//   node scripts/riff-conductor.mjs state init --run <id> --plan <plan.json> [--state-root <dir>]
//   node scripts/riff-conductor.mjs state project --run <id> --project <path> --status <pending|advancing|done|halted|skipped> [--reason <r>] [--state-root <dir>]
//   node scripts/riff-conductor.mjs state finish --run <id> [--status done|stopped] [--reason <r>] [--state-root <dir>]
//   node scripts/riff-conductor.mjs state read [--run <id>] [--state-root <dir>]
//   node scripts/riff-conductor.mjs stop-check [--project <path>] [--state-root <dir>]
//     exit 3 = a STOP file exists (global or per-project): halt between projects.
//
// `plan` is strictly read-only: it writes nothing anywhere, so `--dry-run`
// on /riff:conductor is this subcommand plus formatting.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  atomicWrite,
  classifyPhase,
  lockStatus,
  resolveLaunch,
} from './autonomy-state.mjs';
import { checkBranch } from './finisher-guard.mjs';
import { registryProjects } from './lib/registry.mjs';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// stay pipeable: `riff-conductor plan | head` closes stdout early
process.stdout.on('error', (error) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

// ---------------------------------------------------------------------------
// ROADMAP.yaml phase parsing (tolerant, same spirit as riff-pending's walker)
// ---------------------------------------------------------------------------

function stripComment(line) {
  return line.replace(/\s+#.*$/, '').trimEnd();
}

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

function parseListValue(value) {
  const inner = value.trim().replace(/^\[|\]$/g, '');
  if (!inner.trim()) return [];
  return inner.split(',').map((entry) => unquote(entry)).filter(Boolean);
}

// `status: complete` is the mapping-format synonym for done (brownfield
// roadmaps written by /riff:map); normalize so dependency checks agree.
function normalizePhase(phase) {
  if (phase.status === 'complete') phase.status = 'done';
  if (phase.title === undefined && phase.name !== undefined) phase.title = phase.name;
  return phase;
}

/**
 * Parse the phases out of ROADMAP.yaml text. Two shapes exist in the wild:
 * the template's `phases:` list (`- id: N` items) and the brownfield mapping
 * shape (`phase-N:` top-level keys with `name`/`status: complete`). Supports
 * inline lists (`depends_on: [1, 2]`), block lists, and folded/literal
 * scalars (`rationale: >` — the folded text is captured so classification
 * sees it). Returns { hasPhasesKey, phases: [{ id, slug, title, ... }] }.
 */
export function parseRoadmapPhases(text) {
  const lines = text.split(/\r?\n/);
  let phasesIndent;
  let hasPhasesKey = false;
  const phases = [];
  let current;
  let listField;
  let listIndent;
  let foldField;
  let foldIndent;

  const pushCurrent = () => {
    if (current) phases.push(normalizePhase(current));
    current = undefined;
  };

  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();

    // folded/literal scalar continuation: deeper-indented plain text lines
    if (current && foldField !== undefined) {
      if (indent > foldIndent) {
        current[foldField] = `${current[foldField]} ${trimmed}`.trim();
        continue;
      }
      foldField = undefined;
    }

    // mapping-format phase start: a top-level `phase-N:` key
    const mappingMatch = trimmed.match(/^phase-([A-Za-z0-9_-]+):\s*$/);
    if (mappingMatch && indent === 0) {
      pushCurrent();
      current = { id: mappingMatch[1] };
      hasPhasesKey = true;
      phasesIndent = undefined; // mapping shape owns the file from here
      listField = undefined;
      continue;
    }

    if (phasesIndent === undefined && !hasPhasesKey) {
      if (/^phases:\s*(\[\])?\s*$/.test(trimmed)) {
        phasesIndent = indent;
        hasPhasesKey = true;
      }
      if (phasesIndent === undefined) continue;
      continue;
    }

    // list shape only: a sibling/parent mapping key ends the phases block
    if (phasesIndent !== undefined && indent <= phasesIndent && /^[A-Za-z_][A-Za-z0-9_]*:/.test(trimmed)) break;
    // mapping shape: a non-phase top-level key between phases is skipped
    if (phasesIndent === undefined && indent === 0) {
      if (/^[A-Za-z_][A-Za-z0-9_-]*:/.test(trimmed)) {
        pushCurrent();
        continue;
      }
    }

    const itemMatch = trimmed.match(/^-\s*(.*)$/);
    if (itemMatch && phasesIndent !== undefined && (listField === undefined || indent <= listIndent)) {
      // new list-shape phase item
      pushCurrent();
      current = {};
      listField = undefined;
      const inline = itemMatch[1].trim();
      const fieldMatch = inline.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
      if (fieldMatch) current[fieldMatch[1]] = unquote(fieldMatch[2]);
      continue;
    }
    if (!current) continue;

    if (itemMatch && listField !== undefined && indent > listIndent) {
      // block-list entry under the pending list field
      current[listField].push(unquote(itemMatch[1]));
      continue;
    }

    const fieldMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!fieldMatch) continue;
    const [, key, rawValue] = fieldMatch;
    listField = undefined;
    if (rawValue === '') {
      // possible block list follows
      current[key] = [];
      listField = key;
      listIndent = indent;
    } else if (/^[>|][+-]?$/.test(rawValue)) {
      // folded/literal scalar: capture the following block as one string
      current[key] = '';
      foldField = key;
      foldIndent = indent;
    } else if (rawValue.startsWith('[')) {
      current[key] = parseListValue(rawValue);
    } else {
      current[key] = unquote(rawValue);
    }
  }
  pushCurrent();

  return { hasPhasesKey, phases };
}

// ---------------------------------------------------------------------------
// Per-project eligibility
// ---------------------------------------------------------------------------

function git(projectPath, args) {
  return execFileSync('git', ['-C', projectPath, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function isGitRepo(projectPath) {
  try {
    git(projectPath, ['rev-parse', '--git-dir']);
    return true;
  } catch {
    return false;
  }
}

function readConfig(projectPath) {
  try {
    return JSON.parse(readFileSync(path.join(projectPath, '.planning/config.json'), 'utf8')) || {};
  } catch {
    return {};
  }
}

function treeState(projectPath) {
  // --no-optional-locks: a plain `git status` may refresh and rewrite
  // .git/index — plan must be strictly read-only, even inside .git
  const output = git(projectPath, ['--no-optional-locks', 'status', '--porcelain']);
  let tracked = 0;
  let untracked = 0;
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    if (line.startsWith('??')) untracked += 1;
    else tracked += 1;
  }
  return { tracked, untracked };
}

function defaultBranch(projectPath) {
  for (const branch of ['main', 'master']) {
    try {
      git(projectPath, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
      return branch;
    } catch {
      // keep looking
    }
  }
  return null;
}

/**
 * Divergence against the locally known origin ref — no network. The loop's
 * own Step 0 sync does the real fetch at launch and parks on divergence;
 * this check is defense in depth so the Conductor never even launches into a
 * known-diverged project. No upstream ref -> nothing to compare, pass.
 */
function divergence(projectPath, branch) {
  try {
    git(projectPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
  } catch {
    return { diverged: false };
  }
  try {
    const counts = git(projectPath, [
      'rev-list', '--left-right', '--count', `refs/heads/${branch}...refs/remotes/origin/${branch}`,
    ]).trim().split(/\s+/).map(Number);
    return { diverged: counts[0] > 0 && counts[1] > 0, ahead: counts[0], behind: counts[1] };
  } catch {
    // unreadable history — fail closed, treat as diverged
    return { diverged: true };
  }
}

/**
 * Global no-merge blockers: unreadable finisher files, malformed entries
 * without a branch, and pending branchless security/payment/branch markers
 * block EVERY merge in the project (finisher-guard fails closed on them).
 * Probing the guard with a branch name no real branch can have returns
 * exactly that global set.
 */
function mergesBlocked(projectPath) {
  const probe = checkBranch(projectPath, '@riff-conductor-no-such-branch@');
  return !probe.allowed;
}

const HOLD_STATUSES = new Set(['todo']);

function dependencyKey(value) {
  return String(value).trim();
}

// A scalar where a list is expected (`depends_on: 1`, `tags: auth`) is the
// author meaning a one-element list — dropping it would fail OPEN (a lost
// dependency or a lost hold tag).
function asList(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === '') return [];
  return [value];
}

function dependenciesMet(phase, byKey) {
  const deps = asList(phase.depends_on);
  for (const dep of deps) {
    const target = byKey.get(dependencyKey(dep));
    if (!target) return false; // unknown dependency — fail closed
    if (target.status !== 'done' && target.status !== 'skipped') return false;
  }
  return true;
}

function classifyRoadmapPhase(phase) {
  // provider_mode: production is a hold on its own (AUTONOMY.md § Autonomy
  // boundary) — classifyPhase only sees tags/paths/text
  if (phase.provider_mode === 'production') return 'hold';
  const tags = asList(phase.tags);
  const text = [phase.title, phase.slug, phase.description, phase.rationale].filter(Boolean).join(' ');
  return classifyPhase({ tags, text }).autonomy;
}

export function evaluateProject(projectPath, { scheduled = false } = {}) {
  const name = path.basename(projectPath);
  const entry = {
    path: projectPath,
    name,
    decision: 'skip',
    reason: null,
    resume: null,
    auto_advance: false,
    untracked: 0,
    holds: 0,
    phases: [],
  };
  const skip = (reason, extra = {}) => Object.assign(entry, { decision: 'skip', reason, ...extra });

  let isDir = false;
  try {
    isDir = statSync(projectPath).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) return skip('missing');
  if (!isGitRepo(projectPath)) return skip('not-a-git-repo');

  const config = readConfig(projectPath);
  entry.auto_advance = config.auto_advance === true;
  if (config.scope === 'scratch') return skip('scratch');
  if (scheduled && !entry.auto_advance) return skip('not-opted-in');

  const roadmapFile = path.join(projectPath, 'ROADMAP.yaml');
  let roadmap;
  try {
    roadmap = parseRoadmapPhases(readFileSync(roadmapFile, 'utf8'));
  } catch {
    return skip('invalid-roadmap');
  }
  if (!roadmap.hasPhasesKey || roadmap.phases.length === 0) return skip('invalid-roadmap');

  const tree = treeState(projectPath);
  entry.untracked = tree.untracked;
  if (tree.tracked > 0) return skip('dirty-tree', { tracked: tree.tracked });

  const branch = defaultBranch(projectPath);
  if (branch) {
    const div = divergence(projectPath, branch);
    if (div.diverged) return skip('diverged');
  }

  // In-flight state: never our own reading — lockStatus + resolveLaunch are
  // the same primitives the autonomous launch itself uses.
  const lock = lockStatus(projectPath);
  if (lock.held && !lock.stale) return skip('in-flight-session', { holder: lock.owner?.token ?? null });
  const launch = resolveLaunch(projectPath);
  if (launch.action === 'halt-ambiguous') {
    return skip('ambiguous-state', { candidates: launch.candidates || [] });
  }

  if (mergesBlocked(projectPath)) return skip('merges-blocked');

  // Eligible work: safe todo phases whose dependencies are met.
  // Identity must be a non-blank string or number — null/false/objects and
  // the YAML null spellings (~, null) are "no identity", never selectable.
  const identityValue = (value) => (typeof value === 'string' || typeof value === 'number')
    && String(value).trim() !== ''
    && !/^(~|null)$/i.test(String(value).trim());
  const hasIdentity = (phase) => identityValue(phase.id) || identityValue(phase.slug);
  const byKey = new Map();
  for (const phase of roadmap.phases) {
    if (identityValue(phase.id)) byKey.set(dependencyKey(phase.id), phase);
    if (identityValue(phase.slug)) byKey.set(dependencyKey(phase.slug), phase);
  }
  for (const phase of roadmap.phases) {
    if (!HOLD_STATUSES.has(phase.status)) continue;
    // a phase without a non-blank id or slug cannot be referenced or
    // verified — fail closed, never select it
    if (!hasIdentity(phase)) continue;
    if (!dependenciesMet(phase, byKey)) continue;
    const autonomy = classifyRoadmapPhase(phase);
    if (autonomy === 'hold') {
      entry.holds += 1;
      continue;
    }
    entry.phases.push({
      id: phase.id ?? null,
      slug: phase.slug ?? null,
      title: phase.title ?? null,
      autonomy,
    });
  }

  if (launch.action !== 'new') {
    // resume | restart-run | continue-loop: an unfinished autonomous state
    // exists and the loop launch resumes it per its own contract — advancing
    // here means "finish what is in flight", eligible even with zero new
    // safe phases.
    entry.decision = 'advance';
    entry.resume = launch.action;
    return entry;
  }

  if (entry.phases.length === 0) return skip('no-eligible-work');
  entry.decision = 'advance';
  return entry;
}

// ---------------------------------------------------------------------------
// plan
// ---------------------------------------------------------------------------

function buildPlan({ registry, scheduled, projectsFilter, stateRoot }) {
  const warnings = [];
  let projectPaths = registryProjects({
    frameworkRoot,
    registry,
    onWarn: (message) => warnings.push(message),
  });
  if (projectsFilter.length > 0) {
    const wanted = new Set(projectsFilter);
    projectPaths = projectPaths.filter(
      (projectPath) => wanted.has(projectPath) || wanted.has(path.basename(projectPath)),
    );
  }
  const projects = projectPaths.map((projectPath) => evaluateProject(projectPath, { scheduled }));
  return {
    generated_by: 'riff-conductor',
    scheduled,
    state_root: stateRoot,
    projects,
    warnings,
  };
}

function printPlanText(plan) {
  const advance = plan.projects.filter((entry) => entry.decision === 'advance');
  const skipped = plan.projects.filter((entry) => entry.decision === 'skip');
  for (const warning of plan.warnings) process.stdout.write(`warn: ${warning}\n`);
  process.stdout.write(
    `riff conductor plan${plan.scheduled ? ' (scheduled)' : ''}: `
    + `${advance.length} advance, ${skipped.length} skip (of ${plan.projects.length})\n`,
  );
  const nameWidth = Math.max(1, ...plan.projects.map((entry) => entry.name.length));
  for (const entry of plan.projects) {
    if (entry.decision === 'advance') {
      const detail = entry.resume
        ? `RESUME (${entry.resume})`
        : `${entry.phases.length} safe phase(s): ${entry.phases.map((p) => p.slug || p.id).join(', ')}`;
      const holds = entry.holds > 0 ? ` — ${entry.holds} hold phase(s) stay parked-for-human` : '';
      process.stdout.write(`ADVANCE  ${entry.name.padEnd(nameWidth)}  ${detail}${holds}\n`);
    } else {
      process.stdout.write(`SKIP     ${entry.name.padEnd(nameWidth)}  ${entry.reason}\n`);
    }
  }
}

// ---------------------------------------------------------------------------
// Conductor run state (<state-root>/.planning/conductor/<run-id>/conductor.json)
// ---------------------------------------------------------------------------

function conductorDir(stateRoot, runId) {
  return path.join(stateRoot, '.planning/conductor', runId);
}

function conductorFile(stateRoot, runId) {
  return path.join(conductorDir(stateRoot, runId), 'conductor.json');
}

function readConductor(stateRoot, runId) {
  try {
    return JSON.parse(readFileSync(conductorFile(stateRoot, runId), 'utf8'));
  } catch {
    return null;
  }
}

function writeConductor(stateRoot, runId, data) {
  atomicWrite(conductorFile(stateRoot, runId), `${JSON.stringify(data, null, 2)}\n`);
}

function nextProject(state) {
  const candidate = state.projects.find(
    (entry) => entry.status === 'pending' || entry.status === 'advancing',
  );
  return candidate ? candidate.path : null;
}

// Latest RUNNING run only: `state read` without --run is the resume probe,
// and a finished/stopped run must never look resumable. Explicit --run still
// reads any run.
function latestRun(stateRoot) {
  const root = path.join(stateRoot, '.planning/conductor');
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const runs = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const runId of runs) {
    const state = readConductor(stateRoot, runId);
    if (state && state.status === 'running') return runId;
  }
  return null;
}

const PROJECT_STATUSES = new Set(['pending', 'advancing', 'done', 'halted', 'skipped']);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseFlags(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json' || arg === '--scheduled') {
      flags[arg.slice(2)] = true;
    } else if (arg.startsWith('--')) {
      const value = argv[index + 1];
      if (value === undefined || String(value).startsWith('--')) {
        flags[arg.slice(2).replaceAll('-', '_')] = undefined;
      } else {
        flags[arg.slice(2).replaceAll('-', '_')] = value;
        index += 1;
      }
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function cli() {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseFlags(rest);
  const stateRoot = flags.state_root || frameworkRoot;

  switch (command) {
    case 'plan': {
      const plan = buildPlan({
        registry: flags.registry,
        scheduled: Boolean(flags.scheduled),
        projectsFilter: flags.projects ? String(flags.projects).split(',').map((s) => s.trim()).filter(Boolean) : [],
        stateRoot,
      });
      if (flags.json) process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
      else printPlanText(plan);
      return;
    }
    case 'state': {
      const action = flags._[0];
      if (action === 'init') {
        if (!flags.run || !flags.plan) fail('state init requires --run and --plan <plan.json>');
        if (readConductor(stateRoot, flags.run)) {
          // overwriting would reset done projects to pending and re-advance
          // them — resume via `state read` instead
          fail(`conductor run ${flags.run} already exists — resume it (state read), never re-init`);
        }
        let plan;
        try {
          plan = JSON.parse(readFileSync(flags.plan, 'utf8'));
        } catch (error) {
          fail(`could not read plan ${flags.plan}: ${error.message}`);
        }
        const state = {
          run: flags.run,
          status: 'running',
          started: new Date().toISOString(),
          scheduled: Boolean(plan.scheduled),
          projects: (plan.projects || []).map((entry) => ({
            path: entry.path,
            name: entry.name || path.basename(entry.path || ''),
            status: entry.decision === 'advance' ? 'pending' : 'skipped',
            reason: entry.reason || null,
            resume: entry.resume || null,
          })),
        };
        writeConductor(stateRoot, flags.run, state);
        process.stdout.write(`conductor run ${flags.run}: ${state.projects.length} project(s) recorded\n`);
        return;
      }
      if (action === 'project') {
        if (!flags.run || !flags.project || !flags.status) fail('state project requires --run --project --status');
        if (!PROJECT_STATUSES.has(flags.status)) fail(`invalid status ${flags.status}`);
        const state = readConductor(stateRoot, flags.run);
        if (!state) fail(`no conductor.json for run ${flags.run}`);
        const target = state.projects.find((entry) => entry.path === flags.project);
        if (!target) fail(`project ${flags.project} not in run ${flags.run}`);
        // terminal statuses are sticky: a done/skipped project is never
        // re-opened inside the same run (re-advancing it is the failure mode)
        const TERMINAL = new Set(['done', 'skipped']);
        if (TERMINAL.has(target.status) && flags.status !== target.status) {
          fail(`project ${flags.project} is already ${target.status} in run ${flags.run} — refusing ${flags.status}`);
        }
        target.status = flags.status;
        if (flags.reason !== undefined) target.reason = flags.reason;
        writeConductor(stateRoot, flags.run, state);
        process.stdout.write(`${flags.project} -> ${flags.status}\n`);
        return;
      }
      if (action === 'finish') {
        if (!flags.run) fail('state finish requires --run');
        const finalStatus = flags.status || 'done';
        if (finalStatus !== 'done' && finalStatus !== 'stopped') {
          fail(`state finish --status must be done or stopped, got ${finalStatus}`);
        }
        const state = readConductor(stateRoot, flags.run);
        if (!state) fail(`no conductor.json for run ${flags.run}`);
        state.status = finalStatus;
        if (flags.reason !== undefined) state.stop_reason = flags.reason;
        state.finished = new Date().toISOString();
        writeConductor(stateRoot, flags.run, state);
        process.stdout.write(`conductor run ${flags.run} -> ${state.status}\n`);
        return;
      }
      if (action === 'read') {
        const runId = flags.run || latestRun(stateRoot);
        if (!runId) fail('no running conductor run — nothing to resume');
        const state = readConductor(stateRoot, runId);
        if (!state) fail(`no conductor.json for run ${runId}`);
        process.stdout.write(`${JSON.stringify({ ...state, next_project: nextProject(state) }, null, 2)}\n`);
        return;
      }
      fail('state requires init | project | finish | read');
      return;
    }
    case 'stop-check': {
      const sources = [];
      const globalStop = path.join(stateRoot, '.planning/autonomy/STOP');
      if (existsSync(globalStop)) sources.push(globalStop);
      if (flags.project) {
        const projectStop = path.join(flags.project, '.planning/autonomy/STOP');
        if (existsSync(projectStop)) sources.push(projectStop);
      }
      process.stdout.write(`${JSON.stringify({ stop: sources.length > 0, sources })}\n`);
      process.exit(sources.length > 0 ? 3 : 0);
    }
    default:
      fail('usage: riff-conductor <plan | state | stop-check> [flags]');
  }
}

let invokedDirectly = false;
try {
  invokedDirectly = Boolean(process.argv[1])
    && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) cli();

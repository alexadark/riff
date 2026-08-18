#!/usr/bin/env node
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  normalize,
  parseConfidenceScores,
  parsePlannedFlowUpdates,
  parsePlannedSmokes,
  parsePlannedTasks,
  parseSmokeResults,
  parseSummaryStatus,
  resolveContainedPath,
  tokens,
} from './lib/artifact-contracts.mjs';

const GIT_HELPER_TIMEOUT_MS = 30000;
const GIT_NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';

function gitEnvironment() {
  return {
    ...process.env,
    GIT_OPTIONAL_LOCKS: '0',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: GIT_NULL_DEVICE,
    GIT_CONFIG_SYSTEM: GIT_NULL_DEVICE,
    GIT_EXTERNAL_DIFF: '',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function gitArgs(argv) {
  return ['-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${GIT_NULL_DEVICE}`, ...argv];
}

function fail(message) { process.stderr.write(`${message}\n`); process.exit(2); }

function parseArgs(argv) {
  const args = { projectRoot: process.cwd(), phase: undefined, plan: undefined, summary: undefined, out: undefined, workerDelta: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === '-h' || token === '--help') {
      process.stdout.write('Usage: node scripts/scope-check.mjs --phase <N-slug|path> [--project-root <path>]\n');
      process.exit(0);
    }
    if (['--project-root', '--phase', '--plan', '--summary', '--out', '--worker-delta'].includes(token)) {
      if (!next || next.startsWith('--')) fail(`${token} requires a value`);
      args[token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = next;
      index += 1;
      continue;
    }
    fail(`Unknown argument: ${token}`);
  }
  args.projectRoot = path.resolve(args.projectRoot);
  return args;
}

function resolvePhaseDir(root, phase) {
  if (!phase) return undefined;
  const direct = resolveContainedPath(root, phase, { allowMissing: true });
  if (existsSync(direct)) return direct;
  const phaseRoot = path.join(root, '.planning', 'phases');
  if (!existsSync(phaseRoot)) return direct;
  const normalized = phase.replace(/^\.planning\/phases\//, '').replace(/\/$/, '');
  const exact = path.join(phaseRoot, normalized);
  if (existsSync(exact)) return resolveContainedPath(root, exact, { allowMissing: false });
  const match = readdirSync(phaseRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory())
    .map((entry) => entry.name).find((name) => name === normalized || name.startsWith(`${normalized}-`));
  return match ? resolveContainedPath(root, path.join(phaseRoot, match), { allowMissing: false }) : exact;
}

function manifestChangedInDiff(projectRoot, workerDeltaPath) {
  if (workerDeltaPath) {
    try {
      const delta = JSON.parse(readFileSync(workerDeltaPath, 'utf8'));
      return (delta.changed || delta.exact_worker_deltas || []).map((item) => item.replaceAll(path.sep, '/')).includes('.uxtest/flows.yaml');
    } catch { return false; }
  }
  try {
    const output = execFileSync('git', gitArgs(['diff', '--name-only', '--no-ext-diff', 'HEAD', '--', '.uxtest/flows.yaml']), {
      cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      env: gitEnvironment(), timeout: GIT_HELPER_TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    });
    return output.split(/\r?\n/).some((line) => line.trim() === '.uxtest/flows.yaml');
  } catch { return false; }
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
  const a = normalize(command); const b = normalize(resultCommand);
  return a === b || a.includes(b) || b.includes(a);
}

function codeTouched(planText, summaryText) { return /\b(src|app|lib|pkg|cmd|server|client|routes?)\//.test(`${planText}\n${summaryText}`); }

function malformed(verdict, reason, phaseName, plannedTasks = []) {
  return {
    schema_version: 2, phase: phaseName, generated_at: new Date().toISOString(), verdict,
    planned_tasks: plannedTasks, completed_tasks: [], unmatched_tasks: verdict === 'DROPPED' ? plannedTasks : [],
    planned_smokes: [], smoke_results: [], unmatched_smokes: [], failed_smokes: [], smoke_too_thin: false,
    planned_flow_updates: [], flow_manifest_changed: false, missing_flow_manifest_update: false,
    confidence_scores: [], confidence_requires_pause: false,
    malformed_reason: verdict === 'MALFORMED' ? reason : null,
  };
}

export function buildReport({ phaseName, planText, summaryText, projectRoot, workerDeltaPath }) {
  const plannedTasks = parsePlannedTasks(planText);
  if (plannedTasks.length === 0) return malformed('MALFORMED', 'PLAN.md has no parseable Tasks section', phaseName);
  const completedTasks = []; const unmatchedTasks = [];
  for (const task of plannedTasks) {
    if (summaryAcknowledges(task, summaryText)) completedTasks.push({ id: task.id, matched_planned: task.id });
    else unmatchedTasks.push(task);
  }
  const { sectionExists: smokeSectionExists, smokes: plannedSmokes } = parsePlannedSmokes(planText);
  const smokeResults = parseSmokeResults(summaryText);
  const unmatchedSmokes = smokeSectionExists
    ? plannedSmokes.filter((smoke) => !smokeResults.some((result) => commandMatches(smoke.command || smoke.argv.join(' '), result.command))) : [];
  const failedSmokes = smokeResults.filter((result) => result.status === 'fail')
    .map((result) => ({ command: result.command, observed: result.observed || 'failed smoke result' }));
  const smokeTooThin = smokeSectionExists && plannedSmokes.length < 2 && codeTouched(planText, summaryText);
  const status = parseSummaryStatus(summaryText);
  const { sectionExists: flowUpdatesSectionExists, entries: plannedFlowUpdates } = parsePlannedFlowUpdates(planText);
  const flowManifestChanged = flowUpdatesSectionExists ? manifestChangedInDiff(projectRoot, workerDeltaPath) : false;
  const missingFlowManifestUpdate = flowUpdatesSectionExists && !flowManifestChanged;
  const confidenceScores = parseConfidenceScores(planText);
  const confidenceRequiresPause = confidenceScores.some((entry) => entry.score < 0.7);
  let verdict = 'MATCH'; let malformedReason = null;
  if (confidenceRequiresPause && status !== 'blocked') {
    verdict = 'MALFORMED'; malformedReason = 'PLAN.md confidence score below 0.7 requires blocked phase status';
  } else if (status === 'completed' && failedSmokes.length > 0) {
    verdict = 'MALFORMED'; malformedReason = 'SUMMARY.md status is completed but at least one smoke failed';
  } else if (unmatchedTasks.length > 0 || unmatchedSmokes.length > 0 || failedSmokes.length > 0 || smokeTooThin || missingFlowManifestUpdate) verdict = 'DROPPED';
  return {
    schema_version: 2, phase: phaseName, generated_at: new Date().toISOString(), verdict,
    planned_tasks: plannedTasks, completed_tasks: completedTasks, unmatched_tasks: unmatchedTasks,
    planned_smokes: plannedSmokes, smoke_results: smokeResults, unmatched_smokes: unmatchedSmokes,
    failed_smokes: failedSmokes, smoke_too_thin: smokeTooThin, planned_flow_updates: plannedFlowUpdates,
    flow_manifest_changed: flowManifestChanged, missing_flow_manifest_update: missingFlowManifestUpdate,
    confidence_scores: confidenceScores, confidence_requires_pause: confidenceRequiresPause, malformed_reason: malformedReason,
  };
}

const args = parseArgs(process.argv.slice(2));
const phaseDir = resolvePhaseDir(args.projectRoot, args.phase);
const planPath = args.plan ? resolveContainedPath(args.projectRoot, args.plan, { allowMissing: true }) : path.join(phaseDir || args.projectRoot, 'PLAN.md');
const summaryPath = args.summary ? resolveContainedPath(args.projectRoot, args.summary, { allowMissing: true }) : path.join(phaseDir || args.projectRoot, 'SUMMARY.md');
const outPath = args.out ? resolveContainedPath(args.projectRoot, args.out, { allowMissing: true }) : path.join(phaseDir || args.projectRoot, 'SCOPE-CHECK.json');
const workerDeltaPath = args.workerDelta ? resolveContainedPath(args.projectRoot, args.workerDelta) : undefined;
const phaseName = phaseDir ? path.basename(phaseDir) : path.basename(path.dirname(outPath));
let report;
if (!existsSync(planPath)) report = malformed('MALFORMED', `PLAN.md not found: ${planPath}`, phaseName);
else if (!existsSync(summaryPath)) report = malformed('MALFORMED', `SUMMARY.md not found: ${summaryPath}`, phaseName, parsePlannedTasks(readFileSync(planPath, 'utf8')));
else report = buildReport({ phaseName, planText: readFileSync(planPath, 'utf8'), summaryText: readFileSync(summaryPath, 'utf8'), projectRoot: args.projectRoot, workerDeltaPath });
mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
process.exit(report.verdict === 'MATCH' ? 0 : 1);

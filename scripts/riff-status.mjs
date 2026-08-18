#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadRoadmap, phaseIsReady, requiresConfirmation, resolveProjectRoot } from './lib/roadmap-workflow.mjs';

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function countFiles(directory) {
  try { return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile()).length; } catch { return 0; }
}

function activeWave(projectRoot) {
  const root = path.join(projectRoot, '.planning', 'riff-wave');
  const active = readJson(path.join(root, 'active.json'));
  return active?.run ? readJson(path.join(root, `${active.run}.json`)) : null;
}

function latestNativeStage(projectRoot) {
  const root = path.join(projectRoot, '.planning', 'riff-next');
  let candidates;
  try {
    candidates = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => ({ file: path.join(root, entry.name), name: entry.name }))
      .map((entry) => ({ ...entry, mtime: fs.statSync(entry.file).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime);
  } catch { return null; }
  for (const candidate of candidates) {
    const value = readJson(candidate.file);
    if (value?.state) return { phase: candidate.name.slice(0, -5), state: value.state, stop_reason: value.stop_reason || null };
  }
  return null;
}

export function projectStatus(projectRoot = process.cwd()) {
  const root = resolveProjectRoot(projectRoot);
  const roadmap = loadRoadmap(root);
  const done = roadmap.phases.filter((phase) => ['done', 'skipped'].includes(phase.status)).length;
  const ready = roadmap.phases.filter((phase) => phaseIsReady(phase, roadmap.phases) && !requiresConfirmation(phase));
  const awaitingHuman = roadmap.phases.filter((phase) => !['done', 'skipped'].includes(phase.status) && requiresConfirmation(phase));
  const blocked = roadmap.phases.filter((phase) => phase.status === 'blocked');
  const current = roadmap.phases.filter((phase) => phase.status === 'in-progress');
  return {
    project_root: root,
    progress: { done, total: roadmap.phases.length, percent: roadmap.phases.length ? Math.round((done / roadmap.phases.length) * 100) : 0 },
    phases: roadmap.phases.map(({ id, title, status, priority, mode, dependsOn }) => ({ id, title, status, priority, mode, depends_on: dependsOn })),
    current: current.map((phase) => phase.id),
    ready: ready.map((phase) => phase.id),
    awaiting_human: awaitingHuman.map((phase) => phase.id),
    blocked: blocked.map((phase) => phase.id),
    active_wave: activeWave(root),
    latest_native_stage: latestNativeStage(root),
    pending: {
      expertise: countFiles(path.join(root, '.planning', 'expertise', '.pending')),
      seeds: countFiles(path.join(root, '.planning', 'seeds')),
    },
  };
}

function render(status) {
  const lines = [
    `RIFF status: ${path.basename(status.project_root)}`,
    `Progress: ${status.progress.done}/${status.progress.total} phases (${status.progress.percent}%)`,
  ];
  for (const phase of status.phases) lines.push(`${phase.id}\t${phase.status}\t${phase.priority}\t${phase.mode.join(',')}\t${phase.title}`);
  if (status.current.length) lines.push(`Current: ${status.current.join(', ')}`);
  if (status.ready.length) lines.push(`Ready: ${status.ready.join(', ')}`);
  if (status.awaiting_human.length) lines.push(`Awaiting human verification: ${status.awaiting_human.join(', ')}`);
  if (status.blocked.length) lines.push(`Blocked: ${status.blocked.join(', ')}`);
  if (status.active_wave) lines.push(`Active wave: ${status.active_wave.run} (${status.active_wave.state}; ${status.active_wave.stop_reason || 'running'})`);
  if (status.latest_native_stage) lines.push(`Latest native stage: ${status.latest_native_stage.phase} (${status.latest_native_stage.state})`);
  lines.push(`Pending: ${status.pending.expertise} expertise, ${status.pending.seeds} seeds`);
  if (status.blocked.length) lines.push('Next: inspect the blocked phase and its native artifacts.');
  else if (status.awaiting_human.length) lines.push(`Next: complete human verification for phase ${status.awaiting_human[0]}.`);
  else if (status.ready.length) lines.push(`Next: riff wave --autonomous --loop`);
  else lines.push('Next: roadmap complete. Review, then promote only with explicit confirmation.');
  return `${lines.join('\n')}\n`;
}

export function main(argv = process.argv.slice(2)) {
  let projectRoot = process.cwd();
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--project-root') projectRoot = argv[++index];
    else if (token === '--json') json = true;
    else if (token === '--help' || token === '-h') {
      process.stdout.write('Usage: riff status [--json] [--project-root <path>]\n');
      return;
    } else throw new Error(`unknown riff status option: ${token}`);
  }
  const status = projectStatus(projectRoot);
  process.stdout.write(json ? `${JSON.stringify(status, null, 2)}\n` : render(status));
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  try { main(); } catch (error) { process.stderr.write(`riff status: ${error.message}\n`); process.exitCode = 1; }
}

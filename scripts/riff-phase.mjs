#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite, loadRoadmap, resolveFrameworkRoot, resolveProjectRoot, slugify, updatePhaseStatus, validateRoadmap } from './lib/roadmap-workflow.mjs';

function fail(message) { throw new Error(message); }

function parse(argv) {
  const options = { command: argv[0], tasks: [], dependsOn: [] };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value || value.startsWith('--')) fail(`missing value for ${token}`);
      return value;
    };
    if (token === '--project-root') options.projectRoot = next();
    else if (token === '--id') options.id = next();
    else if (token === '--title') options.title = next();
    else if (token === '--goal') options.goal = next();
    else if (token === '--task') options.tasks.push(next());
    else if (token === '--priority') options.priority = next().toUpperCase();
    else if (token === '--mode') options.mode = next().toUpperCase();
    else if (token === '--depends-on') options.dependsOn.push(...next().split(',').map((value) => value.trim()).filter(Boolean));
    else if (token === '--provider-mode') options.providerMode = next().toLowerCase();
    else if (token === '--status') options.status = next().toLowerCase();
    else if (token === '--help' || token === '-h') options.help = true;
    else fail(`unknown riff phase option: ${token}`);
  }
  return options;
}

function quoted(value) { return JSON.stringify(String(value)); }

function nextId(phases) {
  const maximum = phases.reduce((value, phase) => Math.max(value, Number(phase.id) || 0), 0);
  return String(Math.floor(maximum) + 1);
}

function addPhase(projectRoot, frameworkRoot, options) {
  const roadmap = loadRoadmap(projectRoot);
  if (roadmap.format !== 'list') fail('riff phase add supports the current phases: list format only');
  const id = String(options.id || nextId(roadmap.phases));
  if (!/^\d+(?:\.\d+)?$/.test(id)) fail('phase id must be numeric');
  if (roadmap.phases.some((phase) => phase.id === id)) fail(`phase ${id} already exists`);
  const title = String(options.title || '').trim();
  if (!title) fail('riff phase add requires --title');
  const slug = slugify(title);
  const goal = String(options.goal || title).trim();
  const tasks = options.tasks.length ? options.tasks : [goal];
  const priority = options.priority || 'P2';
  const mode = options.mode || 'AFK';
  const providerMode = options.providerMode || 'production';
  if (!/^P[0-3]$/.test(priority)) fail('priority must be P0, P1, P2, or P3');
  if (!['AFK', 'HITL', 'TDD'].includes(mode)) fail('mode must be AFK, HITL, or TDD');
  if (!['production', 'sandbox'].includes(providerMode)) fail('provider mode must be production or sandbox');
  const entry = [
    `  - id: ${id}`,
    `    slug: ${slug}`,
    `    title: ${quoted(title)}`,
    '    status: todo',
    `    priority: ${priority}`,
    `    mode: ${mode}`,
    ...(providerMode === 'production' ? [] : [`    provider_mode: ${providerMode}`]),
    `    depends_on: [${options.dependsOn.join(', ')}]`,
    `    goal: ${quoted(goal)}`,
    '    tasks:',
    ...tasks.map((task) => `      - ${quoted(task)}`),
  ].join('\n');
  const original = roadmap.text;
  const updated = `${original.replace(/\s*$/, '\n')}${entry}\n`;
  atomicWrite(roadmap.file, updated);
  try { validateRoadmap(projectRoot, frameworkRoot); }
  catch (error) { atomicWrite(roadmap.file, original); throw error; }
  fs.mkdirSync(path.join(projectRoot, '.planning', 'phases', `${id.padStart(2, '0')}-${slug}`), { recursive: true });
  return { id, slug, title, status: 'todo' };
}

function usage() {
  return 'Usage:\n  riff phase list [--project-root <path>]\n  riff phase add --title <title> [--goal <goal>] [--task <task>]... [--depends-on <ids>]\n  riff phase set-status --id <id> --status <todo|in-progress|done|blocked|skipped>\n';
}

export function runPhaseCommand(argv = process.argv.slice(2)) {
  const options = parse(argv);
  if (options.help || !options.command) { process.stdout.write(usage()); return null; }
  const projectRoot = resolveProjectRoot(options.projectRoot || process.cwd());
  const frameworkRoot = resolveFrameworkRoot(projectRoot);
  if (options.command === 'list') {
    const roadmap = loadRoadmap(projectRoot);
    for (const phase of roadmap.phases) process.stdout.write(`${phase.id}\t${phase.status}\t${phase.priority}\t${phase.title}\n`);
    return roadmap.phases;
  }
  if (options.command === 'add') {
    const phase = addPhase(projectRoot, frameworkRoot, options);
    process.stdout.write(`Added phase ${phase.id}: ${phase.title} (${phase.status})\n`);
    return phase;
  }
  if (options.command === 'set-status') {
    if (!options.id || !options.status) fail('riff phase set-status requires --id and --status');
    const roadmap = loadRoadmap(projectRoot);
    const original = roadmap.text;
    updatePhaseStatus(roadmap, options.id, options.status);
    try { validateRoadmap(projectRoot, frameworkRoot); }
    catch (error) { atomicWrite(roadmap.file, original); throw error; }
    process.stdout.write(`Phase ${options.id} status: ${options.status}\n`);
    return { id: options.id, status: options.status };
  }
  fail(`unknown riff phase command: ${options.command}`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url).pathname)) {
  try { runPhaseCommand(); } catch (error) { process.stderr.write(`riff phase: ${error.message}\n`); process.exitCode = 1; }
}

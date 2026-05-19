#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, relative, basename, isAbsolute } from 'node:path';
import {
  updateGate,
  readGateEntries,
  initializeGateLedger,
  GATE_ORDER,
} from './lib/gates.mjs';

function usage() {
  console.error([
    'Usage:',
    '  node scripts/gates-update.mjs --phase <dir> --gate <name> --status <status> [--reason <text>] [--command <text>] [--exit-code <int>] [--artifact <filename>]',
    '  node scripts/gates-update.mjs --summarize <phase-dir> [--all]',
    '  node scripts/gates-update.mjs --init <phase-dir>',
    '',
    'Statuses: pending | running | pass | warn | fail | skipped',
  ].join('\n'));
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const name = key.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[name] = true;
    } else {
      args[name] = next;
      i++;
    }
  }
  return args;
}

function findProjectRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(`${dir}/ROADMAP.yaml`) || existsSync(`${dir}/.planning/config.json`)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadScope(projectRoot) {
  const configPath = `${projectRoot}/.planning/config.json`;
  if (existsSync(configPath)) {
    try {
      const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
      return cfg.scope === 'scratch' ? 'scratch' : 'production';
    } catch {
      return 'production';
    }
  }
  return 'production';
}

function resolvePhaseArg(arg) {
  return isAbsolute(arg) ? arg : resolve(process.cwd(), arg);
}

function phaseFromDir(absPhaseDir, projectRoot) {
  const dir = relative(projectRoot, absPhaseDir);
  const name = basename(absPhaseDir);
  const idMatch = /^(\d+)/.exec(name);
  return { id: idMatch ? parseInt(idMatch[1], 10) : name, dir };
}

const args = parseArgs(process.argv.slice(2));

if (args.help) usage();

if (typeof args.summarize === 'string') {
  const absPhaseDir = resolvePhaseArg(args.summarize);
  const projectRoot = findProjectRoot(absPhaseDir);
  if (!projectRoot) { console.error(`Cannot find project root from: ${absPhaseDir}`); process.exit(1); }
  const scope = loadScope(projectRoot);
  const phase = phaseFromDir(absPhaseDir, projectRoot);
  const entries = readGateEntries(projectRoot, phase.dir, scope);
  const lines = [];
  for (const gate of GATE_ORDER) {
    const entry = entries.get(gate);
    if (!entry) continue;
    if (!args.all && entry.status === 'pending') continue;
    lines.push(`${entry.gate}: ${entry.status}${entry.reason ? ` — ${entry.reason}` : ''}`);
  }
  process.stdout.write(lines.join('\n') + (lines.length ? '\n' : ''));
  process.exit(0);
}

if (typeof args.init === 'string') {
  const absPhaseDir = resolvePhaseArg(args.init);
  const projectRoot = findProjectRoot(absPhaseDir);
  if (!projectRoot) { console.error(`Cannot find project root from: ${absPhaseDir}`); process.exit(1); }
  const scope = loadScope(projectRoot);
  const phase = phaseFromDir(absPhaseDir, projectRoot);
  initializeGateLedger(projectRoot, phase, scope);
  console.log(JSON.stringify({ ok: true, phaseDir: phase.dir, scope }));
  process.exit(0);
}

const { phase: phaseArg, gate: gateArg, status: statusArg } = args;
if (!phaseArg || !gateArg || !statusArg) usage();

const absPhaseDir = resolvePhaseArg(phaseArg);
const projectRoot = findProjectRoot(absPhaseDir);
if (!projectRoot) { console.error(`Cannot find project root from: ${absPhaseDir}`); process.exit(1); }

const scope = loadScope(projectRoot);
const phase = phaseFromDir(absPhaseDir, projectRoot);

const entry = {
  gate: gateArg,
  status: statusArg,
  ...(typeof args.reason === 'string' ? { reason: args.reason } : {}),
  ...(typeof args.command === 'string' ? { command: args.command } : {}),
  ...(typeof args['exit-code'] === 'string' ? { exitCode: args['exit-code'] } : {}),
  ...(typeof args.artifact === 'string' ? { artifact: args.artifact } : {}),
};

const updatedEntries = updateGate(projectRoot, phase, scope, entry);
const updatedEntry = updatedEntries.get(gateArg);
console.log(JSON.stringify(updatedEntry ?? null));

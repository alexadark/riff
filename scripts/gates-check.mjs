#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { blockingGates, readGateEntries } from './lib/gates.mjs';

function usage() {
  console.error('Usage: node scripts/gates-check.mjs --finalize --phase <dir>');
  process.exit(1);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      args[key.slice(2)] = true;
    } else {
      args[key.slice(2)] = value;
      i++;
    }
  }
  return args;
}

function findProjectRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(`${dir}/ROADMAP.yaml`) || existsSync(`${dir}/.planning/config.json`)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadScope(projectRoot) {
  const configPath = `${projectRoot}/.planning/config.json`;
  if (!existsSync(configPath)) return 'production';
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'));
    return cfg.scope === 'scratch' ? 'scratch' : 'production';
  } catch {
    return 'production';
  }
}

function phaseFromDir(absPhaseDir, projectRoot) {
  const dir = relative(projectRoot, absPhaseDir).replaceAll('\\', '/');
  const name = basename(absPhaseDir);
  const idMatch = /^(\d+(?:\.\d+)?)/.exec(name);
  return { id: idMatch ? idMatch[1] : name, dir };
}

const args = parseArgs(process.argv.slice(2));
if (!args.finalize || !args.phase) usage();

const absPhaseDir = isAbsolute(args.phase) ? args.phase : resolve(process.cwd(), args.phase);
const projectRoot = findProjectRoot(absPhaseDir);
if (!projectRoot) {
  console.error(`Cannot find project root from: ${absPhaseDir}`);
  process.exit(1);
}

const scope = loadScope(projectRoot);
const phase = phaseFromDir(absPhaseDir, projectRoot);
const entries = readGateEntries(projectRoot, phase.dir, scope);
const blockers = blockingGates(entries, scope, { ignore: ['state'] });

if (blockers.length > 0) {
  console.error(`gates not satisfied for ${phase.dir}:`);
  for (const blocker of blockers) {
    console.error(`- ${blocker.gate}: ${blocker.status} — ${blocker.reason}`);
  }
  process.exit(1);
}

console.log(`gates satisfied for ${phase.dir} (${scope})`);

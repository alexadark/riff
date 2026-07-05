#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { updateGate } from './lib/gates.mjs';

const frameworkRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SEVERITY_BY_HOOK = {
  'idor-detector': 'HIGH',
  'route-auth-guard': 'HIGH',
  'input-validation-guard': 'MEDIUM',
  'boundary-check': 'LOW',
};

function usage() {
  console.error('Usage: node scripts/reconcile-gate.mjs --phase <dir> --base <ref> [--head <ref>] [--project-root <dir>]');
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

function parseFindings(stdout) {
  const findings = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith('FINDING|')) continue;
    const [, hook, file, message] = line.split('|');
    const severity = SEVERITY_BY_HOOK[hook] ?? 'LOW';
    findings.push({ hook, file, message, severity });
  }
  return findings;
}

const args = parseArgs(process.argv.slice(2));
if (!args.phase || !args.base) usage();

const absPhaseDir = isAbsolute(args.phase) ? args.phase : resolve(process.cwd(), args.phase);
const projectRoot = args['project-root']
  ? resolve(args['project-root'])
  : findProjectRoot(absPhaseDir);
if (!projectRoot) {
  console.error(`Cannot find project root from: ${absPhaseDir}`);
  process.exit(1);
}

const head = args.head || 'HEAD';
const scope = loadScope(projectRoot);
const phase = phaseFromDir(absPhaseDir, projectRoot);
const reconcileScript = `${frameworkRoot}/hooks/lib/reconcile-diff.sh`;
const command = `bash .riff/hooks/lib/reconcile-diff.sh ${args.base} ${head} ${projectRoot}`;

const result = spawnSync('bash', [reconcileScript, args.base, head, projectRoot], {
  cwd: projectRoot,
  encoding: 'utf8',
});
const stdout = result.stdout ?? '';
const stderr = result.stderr ?? result.error?.message ?? '';
const artifact = `${phase.dir}/HOOK-RECONCILE.md`;
const findings = parseFindings(stdout);
const hasHigh = findings.some((finding) => finding.severity === 'CRITICAL' || finding.severity === 'HIGH');
const status = result.status && result.status !== 0
  ? 'fail'
  : hasHigh
    ? 'fail'
    : findings.length > 0
      ? 'warn'
      : 'pass';
const reason = result.status && result.status !== 0
  ? `reconcile-diff exited ${result.status}`
  : findings.length > 0
    ? `${findings.length} hook finding(s); highest=${hasHigh ? 'HIGH' : findings[0].severity}`
    : 'no hook findings';

const lines = [
  '# Hook Reconcile',
  '',
  `Base: \`${args.base}\``,
  `Head: \`${head}\``,
  `Status: \`${status}\``,
  '',
  '## Raw Output',
  '',
  '```text',
  stdout.trim(),
  '```',
];
if (stderr.trim()) {
  lines.push('', '## Stderr', '', '```text', stderr.trim(), '```');
}
writeFileSync(resolve(projectRoot, artifact), `${lines.join('\n')}\n`, 'utf8');

updateGate(projectRoot, phase, scope, {
  gate: 'hook-reconcile',
  status,
  command,
  exitCode: result.status ?? 1,
  artifact,
  reason,
});

console.log(JSON.stringify({ ok: status !== 'fail', gate: 'hook-reconcile', status, findings }));
process.exit(status === 'fail' ? 1 : 0);

#!/usr/bin/env node
// Load-ramp runner for /riff:stress. Wraps `npx autocannon` (zero-install).
// Ramps concurrency across levels, captures latency/throughput/error rate per
// endpoint per level, and reports the breaking point.
//
// SAFETY: refuses any non-local target unless STRESS_ALLOW_REMOTE === target.
// Never aim this at production.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function fail(message, code = 2) {
  process.stderr.write(`stress-load: ${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const args = { levels: [10, 50, 100, 200, 500], duration: 15, paths: null, target: null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--target') args.target = next();
    else if (a === '--paths') args.paths = next();
    else if (a === '--levels') args.levels = next().split(',').map((n) => parseInt(n.trim(), 10)).filter(Boolean);
    else if (a === '--duration') args.duration = parseInt(next(), 10);
    else if (a === '--out') args.out = next();
  }
  return args;
}

// localhost / loopback / reserved test TLDs are allowed without confirmation.
function isLocalTarget(url) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.test') || host.endsWith('.local')) return true;
  return false;
}

function safetyGate(target) {
  if (isLocalTarget(target)) return;
  const allowed = process.env.STRESS_ALLOW_REMOTE;
  if (allowed && allowed === target) return;
  fail(
    `refusing non-local target "${target}". To attack a staging environment you own, ` +
      `set STRESS_ALLOW_REMOTE="${target}" and re-run. Never aim this at production.`,
    3,
  );
}

// Run autocannon once at a given concurrency, return its JSON result.
function runAutocannon(url, connections, duration, method, headers, body) {
  const cmd = ['-y', 'autocannon', '-j', '-c', String(connections), '-d', String(duration), '-m', method || 'GET'];
  for (const [k, v] of Object.entries(headers || {})) cmd.push('-H', `${k}=${v}`);
  if (body) cmd.push('-b', body);
  cmd.push(url);
  let out;
  try {
    out = execFileSync('npx', cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    fail(`autocannon failed for ${method} ${url} @${connections}: ${err.message}`, 4);
  }
  return JSON.parse(out);
}

// non-2xx + non-3xx + timeouts + errors, as a fraction of total requests.
function errorRate(r) {
  const total = r.requests?.total || 0;
  if (!total) return 1;
  const bad = (r.non2xx || 0) + (r.errors || 0) + (r.timeouts || 0);
  return bad / total;
}

// First level where error rate > 1%, p99 > 3x baseline, or throughput plateaus.
function breakingPoint(levels) {
  if (!levels.length) return null;
  const baselineP99 = levels[0].p99 || 1;
  let prevRps = 0;
  for (const lvl of levels) {
    if (lvl.errorRate > 0.01) return { level: lvl.connections, reason: `error rate ${(lvl.errorRate * 100).toFixed(1)}%` };
    if (lvl.p99 > baselineP99 * 3) return { level: lvl.connections, reason: `p99 ${lvl.p99}ms > 3x baseline ${baselineP99}ms` };
    if (prevRps && lvl.rps < prevRps * 1.05) return { level: lvl.connections, reason: `throughput plateaued at ~${Math.round(lvl.rps)} req/s` };
    prevRps = lvl.rps;
  }
  return null; // held clean across all levels
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.target) fail('--target is required');
  if (!args.paths) fail('--paths <file.json> is required');
  if (!existsSync(args.paths)) fail(`paths file not found: ${args.paths}`);

  safetyGate(args.target);

  const paths = JSON.parse(readFileSync(args.paths, 'utf8'));
  if (!Array.isArray(paths) || !paths.length) fail('--paths must be a non-empty JSON array of {path,method?,headers?,body?}');

  const base = args.target.replace(/\/$/, '');
  const report = { target: args.target, generatedLevels: args.levels, duration: args.duration, endpoints: [] };

  for (const p of paths) {
    const url = base + (p.path.startsWith('/') ? p.path : `/${p.path}`);
    const levels = [];
    for (const c of args.levels) {
      const r = runAutocannon(url, c, args.duration, p.method, p.headers, p.body);
      levels.push({
        connections: c,
        p50: r.latency?.p50 ?? null,
        p95: r.latency?.p97_5 ?? r.latency?.p95 ?? null,
        p99: r.latency?.p99 ?? null,
        rps: r.requests?.average ?? null,
        errorRate: errorRate(r),
      });
    }
    report.endpoints.push({
      path: p.path,
      method: p.method || 'GET',
      levels,
      breakingPoint: breakingPoint(levels),
    });
  }

  const json = JSON.stringify(report, null, 2);
  if (args.out) writeFileSync(args.out, json);
  process.stdout.write(json + '\n');
}

main();

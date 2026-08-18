import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { dispatchModel } from './model-dispatch.mjs';

const CHILD_FLAG = '--dispatch-child';
const MAX_REQUESTS = 8;
const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const MAX_RESULT_BYTES = 16 * 1024 * 1024;

function fail(message) { throw new Error(`parallel model dispatch ${message}`); }

function serializeError(error) {
  return { message: String(error?.message || error || 'unknown dispatch failure') };
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    process.stdin.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_INPUT_BYTES) {
        reject(new Error('parallel dispatch input exceeds its size limit'));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

async function childMain() {
  try {
    const request = JSON.parse(await readStdin());
    const result = dispatchModel(request);
    process.stdout.write(JSON.stringify({ ok: true, result }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: serializeError(error) }));
  }
}

function launchChild(request) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), CHILD_FLAG], {
      env: process.env,
      encoding: 'utf8',
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let overflowed = false;
    const collect = (target, chunk, key) => {
      if (key === 'stdout') stdoutBytes += chunk.length;
      else stderrBytes += chunk.length;
      if (stdoutBytes + stderrBytes > MAX_RESULT_BYTES) {
        overflowed = true;
        child.kill('SIGKILL');
        return;
      }
      target.push(chunk);
    };
    child.stdout.on('data', (chunk) => collect(stdout, chunk, 'stdout'));
    child.stderr.on('data', (chunk) => collect(stderr, chunk, 'stderr'));
    child.on('error', (error) => resolve({ ok: false, error: serializeError(error) }));
    child.on('close', (code, signal) => {
      if (overflowed) return resolve({ ok: false, error: { message: 'parallel dispatch child output exceeded its size limit' } });
      const text = Buffer.concat(stdout).toString('utf8');
      if (code !== 0 || signal) {
        const diagnostic = Buffer.concat(stderr).toString('utf8').trim();
        return resolve({ ok: false, error: { message: `parallel dispatch child ${signal ? `terminated by ${signal}` : `exited ${code}`}${diagnostic ? `: ${diagnostic}` : ''}` } });
      }
      try { return resolve(JSON.parse(text)); }
      catch { return resolve({ ok: false, error: { message: 'parallel dispatch child returned malformed output' } }); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

async function supervisorMain() {
  try {
    const requests = JSON.parse(await readStdin());
    if (!Array.isArray(requests) || requests.length < 2 || requests.length > MAX_REQUESTS) fail(`requires 2 through ${MAX_REQUESTS} requests`);
    const results = await Promise.all(requests.map(launchChild));
    process.stdout.write(JSON.stringify({ ok: true, results }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: serializeError(error) }));
  }
}

export function dispatchModelsInParallel(requests, { timeoutMs } = {}) {
  if (!Array.isArray(requests) || requests.length < 2 || requests.length > MAX_REQUESTS) fail(`requires 2 through ${MAX_REQUESTS} requests`);
  const input = JSON.stringify(requests);
  if (Buffer.byteLength(input) > MAX_INPUT_BYTES) fail('input exceeds its size limit');
  const childTimeout = Math.max(...requests.map((request) => Number(request.timeoutMs) || 15 * 60 * 1000));
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    input,
    env: process.env,
    encoding: 'utf8',
    shell: false,
    timeout: timeoutMs || childTimeout + 30_000,
    killSignal: 'SIGKILL',
    maxBuffer: MAX_RESULT_BYTES,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) fail(result.error.code === 'ETIMEDOUT' ? 'supervisor timed out' : `supervisor failed: ${result.error.message}`);
  if (result.signal) fail(`supervisor terminated by ${result.signal}`);
  if (result.status !== 0) fail(`supervisor exited ${result.status}: ${String(result.stderr || '').trim()}`);
  let envelope;
  try { envelope = JSON.parse(result.stdout); } catch { fail('supervisor returned malformed output'); }
  if (!envelope?.ok || !Array.isArray(envelope.results) || envelope.results.length !== requests.length) {
    fail(envelope?.error?.message || 'supervisor returned an invalid result');
  }
  const failure = envelope.results.find((entry) => !entry?.ok);
  if (failure) fail(failure.error?.message || 'worker dispatch failed');
  return envelope.results.map((entry) => entry.result);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === CHILD_FLAG) await childMain();
  else await supervisorMain();
}

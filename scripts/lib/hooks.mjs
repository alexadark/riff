import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { artifactPath, ensureDir, readJsonIfExists, toPosix, writeText } from './artifacts.mjs';
import { updateGate } from './gates.mjs';

const DEFAULT_TIMEOUT_MS = 120000;

function configuredHooks(root) {
  const config = readJsonIfExists(root, '.planning/config.json');
  if (config.exists && !config.error && Array.isArray(config.value?.hooks)) {
    return config.value.hooks.filter((hookPath) => typeof hookPath === 'string');
  }

  const examplesDir = path.join(root, 'hooks', 'examples');
  if (!existsSync(examplesDir)) return [];
  return readdirSync(examplesDir)
    .filter((file) => file.endsWith('.sh'))
    .sort()
    .map((file) => toPosix(path.join('hooks', 'examples', file)));
}

function statusFromExit(code) {
  if (code === 0) return 'pass';
  if (code === 2) return 'warn';
  return 'fail';
}

function commandForHook(hookPath) {
  return hookPath.endsWith('.sh') ? ['bash', hookPath] : [hookPath];
}

function gateForHook(hookPath) {
  const baseName = path.basename(hookPath, path.extname(hookPath));
  if (baseName === 'no-secrets') return 'no-secrets';
  if (baseName === 'smoke') return 'smoke';
  if (baseName === 'docs-check') return 'docs-check';
  return undefined;
}

export function runHooks({ root, phase, scope, gate = 'hooks' }) {
  const hookPaths = configuredHooks(root);
  const outputDir = artifactPath(phase.dir, 'hook-output');
  ensureDir(root, outputDir);

  if (hookPaths.length === 0) {
    updateGate(root, phase, scope, {
      gate,
      status: 'skipped',
      command: 'hooks',
      artifact: artifactPath(phase.dir, 'GATES.md'),
      reason: 'no hooks configured',
    });
    return {
      status: 'skipped',
      results: [],
    };
  }

  const results = hookPaths.map((hookPath) => {
    const [command, ...args] = commandForHook(hookPath);
    const id = path.basename(hookPath).replace(/[^a-zA-Z0-9._-]/g, '-');
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      timeout: DEFAULT_TIMEOUT_MS,
      env: {
        ...process.env,
        RIFF_PHASE_DIR: phase.dir,
        RIFF_SCOPE: scope,
        RIFF_GATE: gate,
        RIFF_REPO_ROOT: root,
      },
    });
    const exitCode = result.status ?? 1;
    const stdoutPath = artifactPath(outputDir, `${id}.stdout.txt`);
    const stderrPath = artifactPath(outputDir, `${id}.stderr.txt`);
    writeText(root, stdoutPath, result.stdout ?? '');
    writeText(root, stderrPath, result.stderr ?? result.error?.message ?? '');
    return {
      hook: hookPath,
      gate: gateForHook(hookPath),
      status: result.error ? 'fail' : statusFromExit(exitCode),
      exitCode,
      stdoutPath,
      stderrPath,
      error: result.error?.message,
    };
  });

  for (const result of results) {
    if (!result.gate) continue;
    updateGate(root, phase, scope, {
      gate: result.gate,
      status: result.status,
      command: result.hook,
      exitCode: result.exitCode,
      artifact: result.stdoutPath,
      reason: result.error || `${result.hook} completed with ${result.status}`,
    });
  }

  const status = results.some((result) => result.status === 'fail')
    ? 'fail'
    : results.some((result) => result.status === 'warn')
      ? 'warn'
      : 'pass';
  const exitCode = status === 'fail' ? 1 : status === 'warn' ? 2 : 0;
  const reason = results
    .map((result) => `${result.hook}:${result.status}:${result.exitCode}`)
    .join(', ');

  updateGate(root, phase, scope, {
    gate,
    status,
    command: hookPaths.join(' && '),
    exitCode,
    artifact: outputDir,
    reason,
  });

  return {
    status,
    results,
  };
}

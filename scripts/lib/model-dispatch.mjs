import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { claudeRuntimeEnvironment, claudeSettings } from './runtime-provider.mjs';

export const CODEX_DISPATCH_TIMEOUT_MS = 15 * 60 * 1000;
export const CODEX_DISPATCH_MAX_BUFFER = 1024 * 1024;
export const CODEX_DIAGNOSTIC_MAX_CHARS = 4096;
const GIT_NULL_DEVICE = process.platform === 'win32' ? 'NUL' : '/dev/null';
function fail(message) { throw new Error(message); }

export function gitEnvironment() { return { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_NULL_DEVICE, GIT_CONFIG_SYSTEM: GIT_NULL_DEVICE, GIT_EXTERNAL_DIFF: '', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' }; }
export function isolatedGitEnvironment(base = {}) { return { ...base, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: GIT_NULL_DEVICE, GIT_CONFIG_SYSTEM: GIT_NULL_DEVICE, GIT_EXTERNAL_DIFF: '', GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' }; }
export function diagnosticExcerpt(value) { const normalized = String(value || '').replace(/\r\n?/g, '\n').replace(/[^\x09\x0A\x0D\x20-\x7E]/g, '�').trim(); return !normalized ? '' : normalized.length > CODEX_DIAGNOSTIC_MAX_CHARS ? `${normalized.slice(0, CODEX_DIAGNOSTIC_MAX_CHARS)}…[truncated]` : normalized; }
export function pathWithin(root, target) { const a = path.resolve(root); const b = path.resolve(target); return b === a || b.startsWith(`${a}${path.sep}`); }
export function permissionProfile({ extendsName, readPaths = [], deniedPaths = [], tmpdirMode, slashTmpMode }) { const absoluteReadPaths = [...new Set(readPaths.filter((value) => value && path.isAbsolute(value)).map((value) => path.resolve(value)))]; const absoluteDeniedPaths = [...new Set(deniedPaths.filter((value) => value && path.isAbsolute(value)).map((value) => path.resolve(value)))]; for (const readPath of absoluteReadPaths) if (absoluteDeniedPaths.some((deniedPath) => pathWithin(deniedPath, readPath))) fail(`permission profile read root is denied: ${readPath}`); const entries = [...(tmpdirMode ? [`\":tmpdir\" = \"${tmpdirMode}\"`] : []), ...(slashTmpMode ? [`\":slash_tmp\" = \"${slashTmpMode}\"`] : []), ...absoluteReadPaths.map((value) => `${JSON.stringify(value)} = "read"`), ...absoluteDeniedPaths.map((value) => `${JSON.stringify(value)} = "deny"`)]; return { absoluteReadPaths, absoluteDeniedPaths, value: `permissions.riff_runtime={ extends = "${extendsName}", filesystem = { ${entries.join(', ')} } }` }; }
function dispatchFailure(route, message, stderr) { const diagnostic = diagnosticExcerpt(stderr); return `${route.provider === 'claude' ? 'Claude' : 'Codex'} dispatch failed for ${route.role}: ${message}${diagnostic ? `: ${diagnostic}` : ''}`; }
export function dispatchModel({ root, addDir, readPaths = [], protectedPaths = [], binary, route, prompt, roleSpecPathForPrompt, outputSchema, timeoutMs = CODEX_DISPATCH_TIMEOUT_MS, maxBuffer = CODEX_DISPATCH_MAX_BUFFER, env: dispatchEnv = {}, shellPath, spawn = spawnSync }) {
  if (route.sandbox === 'workspace-write' && !addDir) fail('worker dispatch requires exactly one staged workspace add-dir');
  if (route.sandbox !== 'workspace-write' && addDir) fail(`${route.role} dispatch must not add a project directory`);
  const absoluteReadPaths = [...new Set(readPaths.filter((value) => value && path.isAbsolute(value)).map((value) => path.resolve(value)))];
  if (route.sandbox !== 'workspace-write' && !absoluteReadPaths.length) fail(`${route.role} dispatch requires explicit read roots`);
  const credentialPaths = Object.entries(process.env).filter(([name, value]) => value && path.isAbsolute(value) && /(?:CREDENTIAL|SECRET|TOKEN|API[_-]?KEY|PASSWORD).*?(?:PATH|FILE|SENTINEL)|(?:PATH|FILE|SENTINEL).*?(?:CREDENTIAL|SECRET|TOKEN|API[_-]?KEY|PASSWORD)/i.test(name)).map(([, value]) => path.resolve(value));
  const deniedPaths = [...new Set([...protectedPaths, ...credentialPaths].filter((value) => value && path.isAbsolute(value)).map((value) => path.resolve(value)))];
  let argv; let result;
  if (route.provider === 'claude') {
    const settings = claudeSettings({ deniedPaths: [...new Set([...deniedPaths, os.userInfo().homedir, os.tmpdir(), '/tmp'])], readPaths, root, writeRoot: addDir });
    const instructions = roleSpecPathForPrompt && route.roleSpecPath ? String(route.developerInstructions).split(route.roleSpecPath).join(roleSpecPathForPrompt) : route.developerInstructions;
    argv = ['--model', route.model, '--effort', route.effort, '--output-format', 'text', ...(outputSchema ? ['--json-schema', JSON.stringify(outputSchema)] : []), '--permission-mode', 'dontAsk', '--tools', Array.isArray(route.tools) ? route.tools.join(',') : 'Read,Glob,Grep', '--settings', JSON.stringify(settings), '--mcp-config', JSON.stringify({ mcpServers: {} }), '--strict-mcp-config', '--safe-mode', '--disable-slash-commands', '--no-session-persistence', '--append-system-prompt', instructions, ...(addDir ? ['--add-dir', addDir] : []), '-p', prompt];
    result = spawn(binary, argv, { cwd: root, env: isolatedGitEnvironment(claudeRuntimeEnvironment({ ...dispatchEnv, PATH: shellPath || dispatchEnv.PATH || process.env.PATH || '/usr/bin:/bin' })), encoding: 'utf8', shell: false, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
  } else {
    const profile = permissionProfile({ extendsName: route.sandbox === 'workspace-write' ? ':workspace' : ':read-only', readPaths: absoluteReadPaths, deniedPaths, slashTmpMode: 'deny' });
    const envConfigs = ['shell_environment_policy.inherit="none"', `shell_environment_policy.set.PATH=${JSON.stringify(shellPath || process.env.PATH || '/usr/bin:/bin')}`, 'shell_environment_policy.set.CI="1"', 'shell_environment_policy.set.GIT_OPTIONAL_LOCKS="0"', ...['LANG', 'LC_ALL'].filter((name) => process.env[name]).map((name) => `shell_environment_policy.set.${name}=${JSON.stringify(process.env[name])}`)].flatMap((value) => ['-c', value]);
    argv = ['--ask-for-approval', 'never', 'exec', '--strict-config', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--disable', 'multi_agent', '--model', route.model, '--config', `model_reasoning_effort="${route.effort}"`, ...(route.serviceTier ? ['-c', `service_tier="${route.serviceTier}"`] : []), '-c', `developer_instructions=${JSON.stringify(route.developerInstructions)}`, '-c', profile.value, '-c', 'default_permissions="riff_runtime"', '-c', 'allow_login_shell=false', ...envConfigs, ...(addDir ? ['--add-dir', addDir] : []), '-C', root, prompt];
    result = spawn(binary, argv, { cwd: root, env: { ...gitEnvironment(), ...dispatchEnv }, encoding: 'utf8', shell: false, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer, stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const provider = route.provider === 'claude' ? 'Claude' : 'Codex';
  if (result.error) { if (result.error.code === 'ETIMEDOUT') fail(`${provider} dispatch timed out for ${route.role}`); if (result.error.code === 'ENOBUFS') fail(`${provider} dispatch output overflowed for ${route.role}`); fail(dispatchFailure(route, result.error.message, result.stderr)); }
  if (result.signal) fail(dispatchFailure(route, `terminated by ${result.signal}`, result.stderr));
  if (result.status === null || result.status === undefined) fail(dispatchFailure(route, 'produced no exit status', result.stderr));
  if (String(result.stdout || '').length > maxBuffer || String(result.stderr || '').length > maxBuffer) fail(`${provider} dispatch output overflowed for ${route.role}`);
  if (result.status !== 0) fail(dispatchFailure(route, `exit code ${result.status}`, result.stderr));
  return { argv, stdout: result.stdout || '', stderr: result.stderr || '' };
}

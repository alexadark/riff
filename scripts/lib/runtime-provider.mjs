import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

const PROVIDERS = new Set(['codex', 'claude']);
const PROFILE_CANDIDATES = Object.freeze([
  ({ projectRoot }) => path.join(projectRoot, '.planning', 'profile.yaml'),
  ({ frameworkRoot }) => path.join(frameworkRoot, 'profile.yaml'),
  ({ frameworkRoot }) => path.join(frameworkRoot, 'templates', 'profile.default.yaml'),
]);

export const CLAUDE_ROUTE_MATRIX = Object.freeze({
  controller: {
    routine: { model: 'sonnet', effort: 'medium', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' },
    architecture: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' },
  },
  planner: {
    routine: { model: 'sonnet', effort: 'high', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' },
    architecture: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' },
  },
  worker: {
    inventory: { model: 'sonnet', effort: 'low', tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'], sandbox: 'workspace-write' },
    repeatable: { model: 'sonnet', effort: 'high', tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'], sandbox: 'workspace-write' },
    bounded: { model: 'sonnet', effort: 'high', tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'], sandbox: 'workspace-write' },
  },
  reviewer: {
    routine: { model: 'sonnet', effort: 'high', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' },
    critical: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' },
    escalation: { model: 'opus', effort: 'max', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' },
  },
  debugger: { fixed: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' } },
  'security-reviewer': { fixed: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' } },
  'red-teamer': { fixed: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' } },
  'load-tester': { fixed: { model: 'sonnet', effort: 'high', tools: ['Read', 'Glob', 'Grep'], sandbox: 'read-only' } },
});

function fail(message) { throw new Error(message); }

export function assertProvider(value) {
  const provider = String(value || '').trim().toLowerCase();
  if (!PROVIDERS.has(provider)) fail(`invalid runtime provider: ${value}. Expected codex or claude`);
  return provider;
}

function existingRegularFile(file) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`runtime profile must be a non-symlink regular file: ${file}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function resolveRuntimeProfile({ projectRoot, frameworkRoot, provider: override } = {}) {
  if (!projectRoot || !frameworkRoot) fail('runtime profile resolution requires projectRoot and frameworkRoot');
  const project = path.resolve(projectRoot);
  const framework = path.resolve(frameworkRoot);
  const profilePath = PROFILE_CANDIDATES.map((candidate) => candidate({ projectRoot: project, frameworkRoot: framework })).find(existingRegularFile);
  if (!profilePath) fail('no runtime profile found');
  let profile;
  try { profile = yaml.load(fs.readFileSync(profilePath, 'utf8')) || {}; }
  catch (error) { fail(`runtime profile is invalid YAML: ${error.message}`); }
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) fail('runtime profile must contain a YAML mapping');
  const configured = profile.runtime?.provider === undefined ? 'codex' : profile.runtime.provider;
  const configuredProvider = assertProvider(configured);
  const provider = override === undefined ? configuredProvider : assertProvider(override);
  let source;
  if (profilePath === path.join(project, '.planning', 'profile.yaml')) source = 'project:.planning/profile.yaml';
  else if (profilePath === path.join(framework, 'profile.yaml')) source = 'framework:profile.yaml';
  else source = 'framework:templates/profile.default.yaml';
  return {
    provider,
    configuredProvider,
    profilePath: source,
    profileSourcePath: profilePath,
    explicitOverride: override !== undefined,
    profile,
  };
}

function resolveExecutable(binary, envName, defaultName, inheritedPath = process.env.PATH || '') {
  const configured = String(binary || process.env[envName] || defaultName).trim();
  if (!configured) fail(`${defaultName[0].toUpperCase()}${defaultName.slice(1)} binary is missing`);
  const candidates = path.isAbsolute(configured) || /[\\/]/.test(configured)
    ? [path.isAbsolute(configured) ? configured : path.resolve(configured)]
    : String(inheritedPath || '').split(path.delimiter).map((entry) => path.resolve(entry || '.', configured));
  for (const candidate of [...new Set(candidates)]) {
    let resolved;
    try { resolved = fs.realpathSync(candidate); } catch { continue; }
    let stat;
    try { stat = fs.statSync(resolved); } catch { continue; }
    if (!stat.isFile()) continue;
    try { fs.accessSync(resolved, fs.constants.X_OK); } catch { continue; }
    return resolved;
  }
  fail(`${defaultName[0].toUpperCase()}${defaultName.slice(1)} binary is missing or not executable: ${configured}`);
}

export function resolveClaudeBinary(binary, inheritedPath = process.env.PATH || '') {
  return resolveExecutable(binary, 'RIFF_CLAUDE_BIN', 'claude', inheritedPath);
}

export function resolveCodexBinaryFromProvider(binary, inheritedPath = process.env.PATH || '') {
  return resolveExecutable(binary, 'RIFF_CODEX_BIN', 'codex', inheritedPath);
}

function canonicalRoleSpec(frameworkRoot, semanticRole, config) {
  const relative = config.semantic_spec;
  if (!relative || path.isAbsolute(relative) || path.normalize(relative).startsWith('..')) fail(`Claude role ${semanticRole} has an invalid semantic_spec`);
  const roleSpecPath = path.resolve(frameworkRoot, relative);
  if (!roleSpecPath.startsWith(`${path.resolve(frameworkRoot)}${path.sep}`)) fail(`Claude role ${semanticRole} semantic_spec escapes framework root`);
  let stat;
  try { stat = fs.lstatSync(roleSpecPath); } catch (error) { fail(`Claude role ${semanticRole} semantic_spec is missing: ${error.message}`); }
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(roleSpecPath) !== roleSpecPath) fail(`Claude role ${semanticRole} semantic_spec must be a non-symlink file`);
  return roleSpecPath;
}

function claudeToolPath(pathname) {
  const absolute = path.resolve(pathname);
  return `//${absolute.replace(/^\/+/, '')}`;
}

function pathWithin(root, target) {
  const parent = path.resolve(root);
  const child = path.resolve(target);
  return parent === child || child.startsWith(`${parent}${path.sep}`);
}

function loadClaudeMap(frameworkRoot) {
  const file = path.join(frameworkRoot, 'agents', 'claude.yaml');
  let mapping;
  try { mapping = yaml.load(fs.readFileSync(file, 'utf8')); }
  catch (error) { fail(`Claude adapter mapping is invalid: ${error.message}`); }
  if (!mapping || typeof mapping !== 'object' || !mapping.roles) fail('Claude adapter mapping must declare roles');
  return { file, mapping };
}

export function loadClaudeRoutes(frameworkRoot) {
  const framework = path.resolve(frameworkRoot);
  const { file, mapping } = loadClaudeMap(framework);
  const routes = {};
  for (const [semanticRole, variants] of Object.entries(CLAUDE_ROUTE_MATRIX)) {
    const nativeSection = mapping.native_roles?.[semanticRole] ? 'native_roles' : 'roles';
    const roleConfig = mapping[nativeSection]?.[semanticRole];
    if (!roleConfig || typeof roleConfig !== 'object') fail(`Claude adapter mapping is missing native role ${semanticRole}`);
    const roleSpecPath = canonicalRoleSpec(framework, semanticRole, roleConfig);
    routes[semanticRole] = {};
    for (const [routeClass, expected] of Object.entries(variants)) {
      const configured = roleConfig.variants?.[routeClass];
      if (!configured || typeof configured !== 'object') fail(`Claude adapter mapping is missing ${semanticRole}:${routeClass}`);
      for (const field of ['model', 'effort']) if (configured[field] !== expected[field]) fail(`Claude route ${semanticRole}:${routeClass} ${field} must be ${expected[field]}`);
      const tools = Array.isArray(configured.tools) ? configured.tools : expected.tools;
      if (JSON.stringify(tools) !== JSON.stringify(expected.tools)) fail(`Claude route ${semanticRole}:${routeClass} tools are not the declared closed list`);
      const routePath = `${path.relative(framework, file).replaceAll(path.sep, '/') }#${nativeSection}.${semanticRole}.variants.${routeClass}`;
      routes[semanticRole][routeClass] = {
        provider: 'claude',
        semanticRole,
        role: semanticRole,
        routeClass,
        model: expected.model,
        effort: expected.effort,
        sandbox: expected.sandbox,
        tools,
        permissionMode: 'dontAsk',
        disableSlashCommands: true,
        strictMcpConfig: true,
        noSessionPersistence: true,
        developerInstructions: `Apply the following canonical RIFF role specification as the complete role contract. Runtime settings are enforced by this adapter. Do not discover or load repository instructions as a replacement.\n\n--- canonical role specification ---\n${fs.readFileSync(roleSpecPath, 'utf8').trim()}\n--- end canonical role specification ---`,
        roleSpecPath,
        routePath: file,
        adapter: routePath,
      };
    }
  }
  return routes;
}

export function providerAdapterIdentity(route, frameworkRoot) {
  if (route?.adapter) return route.adapter;
  const relative = path.relative(path.resolve(frameworkRoot), route.routePath).replaceAll(path.sep, '/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) fail(`runtime route adapter escapes framework root: ${relative}`);
  return relative;
}

export function claudeSettings({ deniedPaths = [], protectedPaths = [], readPaths = [], root, writeRoot }) {
  const denied = [...new Set([...deniedPaths, ...protectedPaths].filter((value) => value && path.isAbsolute(value)).map((value) => path.resolve(value)))];
  const denyReads = denied.map((value) => `Read(${claudeToolPath(value)}/**)`);
  const allowedReads = [...new Set([
    ...(root && path.isAbsolute(root) ? [root] : []),
    ...readPaths,
  ].filter((value) => value && path.isAbsolute(value)).map((value) => path.resolve(value)))].filter((value) => !denied.some((parent) => pathWithin(parent, value)));
  const allow = allowedReads.map((value) => `Read(${claudeToolPath(value)}/**)`);
  if (writeRoot && path.isAbsolute(writeRoot) && !denied.some((parent) => pathWithin(parent, writeRoot))) {
    const writable = `${claudeToolPath(writeRoot)}/**`;
    allow.push(`Read(${writable})`, `Write(${writable})`, `Edit(${writable})`);
  }
  return {
    permissions: {
      defaultMode: 'dontAsk',
      allow: [...new Set(allow)],
      deny: denyReads,
    },
    mcpServers: {},
  };
}

export function claudeRuntimeEnvironment(runtimeEnv = {}) {
  const env = { ...runtimeEnv };
  // Claude safe mode disables user/project customization while preserving the
  // normal auth/keychain lookup. Keep only the non-secret process identity and
  // temporary-directory variables required by the macOS keychain-backed CLI.
  // No config directory override is injected.
  for (const name of ['HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && /^(?:ANTHROPIC_|CLAUDE_CODE_USE_|AWS_|GOOGLE_|CLOUD_ML_|AZURE_|FOUNDRY_)/.test(name)) {
      env[name] = value;
    }
  }
  delete env.CLAUDECODE;
  delete env.CLAUDE_CODE_ENTRYPOINT;
  return env;
}

export function routeMatrix() { return CLAUDE_ROUTE_MATRIX; }

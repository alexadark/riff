#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { ROUTE_PORTFOLIO, validateRouteSource } from './lib/runtime-routes.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const CANONICAL_ROLES = Object.freeze([
  'planner',
  'worker',
  'reviewer',
  'debugger',
  'security-reviewer',
  'red-teamer',
  'load-tester',
]);

const ROLE_SPECS = Object.freeze(Object.fromEntries(CANONICAL_ROLES.map((role) => [role, `agents/roles/${role}.md`])));
const CLAUDE_ALIASES = Object.freeze({
  executor: { role: 'worker', assignment: 'implement' },
  simplifier: { role: 'worker', assignment: 'simplify' },
  'debugger-max': { role: 'debugger', intensity: 'max' },
  'adversarial-reviewer': { role: 'reviewer', mode: 'code' },
  'plan-adversarial-reviewer': { role: 'reviewer', mode: 'plan' },
  'architecture-adversarial-reviewer': { role: 'reviewer', mode: 'architecture' },
  'roadmap-adversarial-reviewer': { role: 'reviewer', mode: 'roadmap' },
  'incident-adversarial-reviewer': { role: 'reviewer', mode: 'incident' },
  'deep-auditor': { role: 'reviewer', mode: 'milestone' },
});

const CLAUDE_PRIMARY = Object.freeze({
  planner: { mode: 'planner' },
  worker: { assignment: 'implement' },
  reviewer: { mode: 'code' },
  debugger: { intensity: 'normal' },
  'security-reviewer': { mode: 'diff' },
  'red-teamer': { mode: 'static' },
  'load-tester': { mode: 'static' },
});

const CLAUDE_NATIVE_ROUTES = Object.freeze({
  controller: {
    semantic_spec: 'protocols/RIFF-NEXT.md',
    variants: {
      routine: { model: 'sonnet', effort: 'medium', tools: ['Read', 'Glob', 'Grep'] },
      architecture: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'] },
    },
  },
  planner: {
    semantic_spec: ROLE_SPECS.planner,
    variants: {
      routine: { model: 'sonnet', effort: 'high', tools: ['Read', 'Glob', 'Grep'] },
      architecture: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'] },
    },
  },
  worker: {
    semantic_spec: ROLE_SPECS.worker,
    variants: {
      inventory: { model: 'sonnet', effort: 'low', tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'] },
      repeatable: { model: 'sonnet', effort: 'high', tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'] },
      bounded: { model: 'sonnet', effort: 'high', tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'] },
    },
  },
  reviewer: {
    semantic_spec: ROLE_SPECS.reviewer,
    variants: {
      routine: { model: 'sonnet', effort: 'high', tools: ['Read', 'Glob', 'Grep'] },
      critical: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'] },
      escalation: { model: 'opus', effort: 'max', tools: ['Read', 'Glob', 'Grep'] },
    },
  },
  debugger: { semantic_spec: ROLE_SPECS.debugger, variants: { fixed: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'] } } },
  'security-reviewer': { semantic_spec: ROLE_SPECS['security-reviewer'], variants: { fixed: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'] } } },
  'red-teamer': { semantic_spec: ROLE_SPECS['red-teamer'], variants: { fixed: { model: 'opus', effort: 'xhigh', tools: ['Read', 'Glob', 'Grep'] } } },
  'load-tester': { semantic_spec: ROLE_SPECS['load-tester'], variants: { fixed: { model: 'sonnet', effort: 'high', tools: ['Read', 'Glob', 'Grep'] } } },
});

const TOP_LEVEL_AGENTS = Object.freeze([
  ...CANONICAL_ROLES,
  ...Object.keys(CLAUDE_ALIASES),
]);

const ACTIVE_SKILLS = Object.freeze([
  'dashboard',
  'deep-audit',
  'finish',
  'improve',
  'incident',
  'incident-review',
  'map',
  'next',
  'phase',
  'promote',
  'resync',
  'start',
  'status',
  'wave',
]);

const ROLE_REQUIREMENTS = Object.freeze({
  planner: ['confidence', 'assumptions', 'dependencies', 'waves', 'acceptance criteria', 'provider_mode', 'improver', 'allowed_paths', 'owned paths', 'stdout_includes', 'exit_code', 'test traceability', 'input class', 'edge case', 'preservation constraint', 'explicit test case', 'alphanumeric', 'digits', 'observed and stable', 'test-reporter formatting', '`exit_code` only'],
  worker: ['implement', 'fix', 'simplify', 'allowed paths', 'tdd', 'documentation', 'scope: scratch', 'summary'],
  reviewer: ['code', 'plan', 'architecture', 'roadmap', 'incident', 'milestone', 'fresh context', 'read-only', 'plan sha-256', 'summary sha-256', 'worker delta sha-256', 'base snapshot sha-256', 'head snapshot sha-256', 'path:line'],
  debugger: ['normal', 'high', 'max', 'falsifiable', 'evidence', 'debug', 'bounded fix assignment'],
  'security-reviewer': ['scratch', 'diff', 'full', 'owasp', 'auth', 'idor', 'input', 'error', 'secrets', 'transactions', 'tenant isolation', 'security'],
  'red-teamer': ['auth', 'injection', 'idor', 'ratelimit', 'config', 'non-production', 'redirect', 'destructive', 'bounded', 'proof', 'findings', 'repository-read-only', 'report-only', 'never write repository files', 'stdout', 'artifact response', 'active network access', 'disposable runtime scratch', 'orchestrator'],
  'load-tester': ['static', 'active', 'approved', 'ramp', 'breaking point', 'invent measurements', 'scale', 'repository-read-only', 'report-only', 'never write repository files', 'stdout', 'artifact response', 'active network access', 'disposable runtime scratch', 'orchestrator'],
});

function finding(message, file = '') { return { message, file }; }

function pathInside(rootPath, candidate) {
  let rootReal;
  try { rootReal = fs.realpathSync(rootPath); } catch { rootReal = path.resolve(rootPath); }
  const absolute = path.resolve(rootReal, candidate);
  if (!(absolute === rootReal || absolute.startsWith(`${rootReal}${path.sep}`))) return false;
  let candidateReal;
  try { candidateReal = fs.realpathSync(absolute); } catch { return false; }
  return candidateReal === rootReal || candidateReal.startsWith(`${rootReal}${path.sep}`);
}

function existingPath(projectRoot, candidate) {
  const absolute = path.resolve(projectRoot, candidate);
  return pathInside(projectRoot, candidate) && fs.existsSync(absolute);
}

function readYaml(file) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')) || {}; } catch { return undefined; }
}

function frontmatter(text) {
  if (!/^---\s*\r?\n/.test(text)) return undefined;
  const match = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!match) return undefined;
  try { return yaml.load(match[1]) || {}; } catch { return undefined; }
}

function bodyAfterFrontmatter(text) {
  const match = text.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/);
  return match ? text.slice(match[0].length).trim() : text.trim();
}

function referencedPaths(skillText) {
  const results = new Set();
  const pattern = /`([^`]+)`|(?:^|[\s(])((?:\.riff|scripts|agents|protocols|references|templates|skills|hooks)\/[A-Za-z0-9._/-]+)/g;
  for (const match of skillText.matchAll(pattern)) {
    const values = match[2] ? [match[2]] : (match[1] || '').split(/\s+/);
    for (const rawValue of values) {
      const value = rawValue.trim().replace(/[),.;:]+$/, '');
      if (!value || value.includes('<') || value.startsWith('http://') || value.startsWith('https://')) continue;
      if (/^(?:[A-Za-z0-9_-]+\s+)?(?:--|\/)/.test(value)) continue;
      if (value.startsWith('.riff/')) results.add(value.slice('.riff/'.length));
      else if (/^(?:scripts|agents|protocols|references|templates|skills|hooks)\//.test(value)) results.add(value);
    }
  }
  return [...results];
}

function checkManifest(projectRoot, findings) {
  const manifestPath = path.join(projectRoot, '.codex-plugin', 'plugin.json');
  if (!fs.existsSync(manifestPath)) {
    findings.push(finding('missing .codex-plugin/plugin.json', '.codex-plugin/plugin.json'));
    return;
  }
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch {
    findings.push(finding('plugin manifest is not valid JSON', path.relative(projectRoot, manifestPath)));
    return;
  }
  const required = [
    ['name', manifest.name], ['version', manifest.version], ['description', manifest.description], ['skills', manifest.skills],
    ['author.name', manifest.author?.name], ['interface.displayName', manifest.interface?.displayName],
    ['interface.shortDescription', manifest.interface?.shortDescription], ['interface.longDescription', manifest.interface?.longDescription],
    ['interface.developerName', manifest.interface?.developerName], ['interface.category', manifest.interface?.category],
  ];
  for (const [field, value] of required) if (typeof value !== 'string' || !value.trim()) findings.push(finding(`plugin manifest field ${field} is empty`, path.relative(projectRoot, manifestPath)));
  if (manifest.name !== 'riff') findings.push(finding('plugin manifest name must be riff', path.relative(projectRoot, manifestPath)));
  if (manifest.skills !== './skills/') findings.push(finding('plugin manifest skills must be ./skills/', path.relative(projectRoot, manifestPath)));
  if (!Array.isArray(manifest.interface?.capabilities) || manifest.interface.capabilities.length === 0) findings.push(finding('plugin manifest interface.capabilities must be non-empty', path.relative(projectRoot, manifestPath)));
  if ((Array.isArray(manifest.interface?.defaultPrompt) && manifest.interface.defaultPrompt.length === 0) || (typeof manifest.interface?.defaultPrompt === 'string' && !manifest.interface.defaultPrompt.trim()) || (!Array.isArray(manifest.interface?.defaultPrompt) && typeof manifest.interface?.defaultPrompt !== 'string')) findings.push(finding('plugin manifest interface.defaultPrompt is empty', path.relative(projectRoot, manifestPath)));
  if (!existingPath(projectRoot, 'skills')) findings.push(finding('plugin manifest skills inventory path is missing or escapes project', path.relative(projectRoot, manifestPath)));
}

function checkSkills(projectRoot, findings) {
  const skillsDir = path.join(projectRoot, 'skills');
  if (!fs.existsSync(skillsDir)) { findings.push(finding('skills directory is missing', 'skills')); return; }
  const skillDirectories = fs.readdirSync(skillsDir)
    .filter((name) => fs.lstatSync(path.join(skillsDir, name)).isDirectory())
    .sort();
  const activeSkillSet = new Set(ACTIVE_SKILLS);
  for (const name of ACTIVE_SKILLS) {
    if (!skillDirectories.includes(name)) findings.push(finding(`missing active skill directory: ${name}`, path.join('skills', name)));
  }
  for (const name of skillDirectories) {
    if (!activeSkillSet.has(name)) findings.push(finding(`undeclared top-level skill directory: ${name}`, path.join('skills', name)));
  }
  for (const name of skillDirectories) {
    const dir = path.join(skillsDir, name);
    if (!fs.lstatSync(dir).isDirectory()) continue;
    const skillFile = path.join(dir, 'SKILL.md');
    if (!fs.existsSync(skillFile)) { findings.push(finding(`skill directory has no SKILL.md: ${name}`, path.relative(projectRoot, dir))); continue; }
    const text = fs.readFileSync(skillFile, 'utf8');
    const metadata = frontmatter(text);
    if (!metadata || metadata.name !== name) findings.push(finding(`skill YAML name must match directory '${name}'`, path.relative(projectRoot, skillFile)));
    if (!metadata || typeof metadata.description !== 'string' || !metadata.description.trim()) findings.push(finding('skill YAML description is empty', path.relative(projectRoot, skillFile)));
    for (const referenced of referencedPaths(text)) {
      if (!existingPath(projectRoot, referenced)) findings.push(finding(`skill references missing or escaping local path: ${referenced}`, path.relative(projectRoot, skillFile)));
    }
    const openai = path.join(dir, 'agents', 'openai.yaml');
    if (!fs.existsSync(openai)) { findings.push(finding(`skill requires agents/openai.yaml: ${name}`, path.relative(projectRoot, dir))); continue; }
    const config = readYaml(openai);
    if (!config) { findings.push(finding('agents/openai.yaml is not valid YAML', path.relative(projectRoot, openai))); continue; }
    if (!new RegExp(`\\$riff:${name}\\b`).test(config.interface?.default_prompt || '')) findings.push(finding(`openai.yaml default prompt must reference $riff:${name}`, path.relative(projectRoot, openai)));
    if (config.policy?.allow_implicit_invocation !== false) findings.push(finding('policy.allow_implicit_invocation must be false', path.relative(projectRoot, openai)));
  }
}

function checkCanonicalRoles(projectRoot, findings) {
  const rolesDir = path.join(projectRoot, 'agents', 'roles');
  if (!fs.existsSync(rolesDir)) { findings.push(finding('canonical role directory is missing', 'agents/roles')); return; }
  const roleFiles = fs.readdirSync(rolesDir).filter((entry) => entry.endsWith('.md')).sort();
  const expected = [...CANONICAL_ROLES].sort().map((role) => `${role}.md`);
  for (const name of expected) if (!roleFiles.includes(name)) findings.push(finding(`missing canonical role: ${name}`, 'agents/roles'));
  for (const name of roleFiles) if (!expected.includes(name)) findings.push(finding(`undeclared canonical role: ${name}`, path.relative(projectRoot, path.join(rolesDir, name))));
  const forbiddenIdentifiers = /\b(?:gpt-\d[\w.-]*|claude|codex|sonnet|opus|haiku|terra|luna|fable)\b/i;
  const forbiddenWords = /\b(?:provider|model|effort|tools?|permission|delegation)\b/i;
  for (const role of CANONICAL_ROLES) {
    const file = path.join(rolesDir, `${role}.md`);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    const withoutProviderMode = text.replaceAll('provider_mode', '');
    if (forbiddenIdentifiers.test(text)) findings.push(finding('canonical role contains a runtime identifier', path.relative(projectRoot, file)));
    if (forbiddenWords.test(withoutProviderMode)) findings.push(finding('canonical role contains runtime selection terms', path.relative(projectRoot, file)));
    for (const required of ROLE_REQUIREMENTS[role]) if (!text.toLowerCase().includes(required.toLowerCase())) findings.push(finding(`canonical role is missing required semantic contract: ${required}`, path.relative(projectRoot, file)));
  }
}

function checkClaudeAdapter(projectRoot, findings, fileName, role, adapterPath) {
  const file = path.join(projectRoot, adapterPath);
  if (!fs.existsSync(file)) { findings.push(finding(`missing Claude adapter: ${adapterPath}`, adapterPath)); return; }
  const text = fs.readFileSync(file, 'utf8');
  const metadata = frontmatter(text);
  if (!metadata) { findings.push(finding('Claude adapter requires valid YAML frontmatter', adapterPath)); return; }
  if (metadata.name !== fileName) findings.push(finding(`Claude adapter name must be ${fileName}`, adapterPath));
  if (metadata.model !== 'inherit') findings.push(finding('Claude adapter model must be inherit', adapterPath));
  if (typeof metadata.tools !== 'string' && !Array.isArray(metadata.tools)) findings.push(finding('Claude adapter must declare runtime tools in frontmatter', adapterPath));
  const tools = Array.isArray(metadata.tools) ? metadata.tools.join(',') : String(metadata.tools || '');
  if (/\bAgent\b/i.test(tools)) findings.push(finding('Claude adapter tools must not include Agent', adapterPath));
  if (typeof metadata.permissionMode !== 'string' || !metadata.permissionMode.trim()) findings.push(finding('Claude adapter must declare permissionMode in frontmatter', adapterPath));
  if (['red-teamer', 'load-tester'].includes(role)) {
    if (metadata.permissionMode !== 'default') findings.push(finding('report-only Claude adapters must use permissionMode default', adapterPath));
    if (/\b(?:Write|Edit)\b/i.test(tools)) findings.push(finding('report-only Claude adapters must not include Write or Edit tools', adapterPath));
  }
  const body = bodyAfterFrontmatter(text);
  const expectedPrimary = `.riff/agents/roles/${role}.md`;
  const expectedFallback = `agents/roles/${role}.md`;
  if (!body.includes(expectedPrimary) || !body.includes(expectedFallback)) findings.push(finding('Claude adapter must resolve .riff role path with self-repo fallback', adapterPath));
  if (body.split(/\r?\n/).filter((line) => line.trim()).length > 3 || body.length > 500) findings.push(finding('Claude adapter body is not thin', adapterPath));
  if (/^##\s+/m.test(body)) findings.push(finding('Claude adapter must not duplicate role procedure', adapterPath));
}

function checkMappings(projectRoot, findings) {
  const openaiPath = path.join(projectRoot, 'agents', 'openai.yaml');
  const claudePath = path.join(projectRoot, 'agents', 'claude.yaml');
  for (const file of [openaiPath, claudePath]) if (!fs.existsSync(file)) findings.push(finding(`missing runtime mapping: ${path.relative(projectRoot, file)}`, path.relative(projectRoot, file)));
  const openai = readYaml(openaiPath);
  if (!openai) findings.push(finding('agents/openai.yaml is not valid YAML', 'agents/openai.yaml'));
  else {
    const expected = ['controller', ...CANONICAL_ROLES];
    const actual = Object.keys(openai.roles || {}).sort();
    if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) findings.push(finding('agents/openai.yaml must map controller and exactly seven roles', 'agents/openai.yaml'));
    if (/\b(?:model|effort|sandbox)\s*:/i.test(fs.readFileSync(openaiPath, 'utf8'))) findings.push(finding('agents/openai.yaml must not duplicate runtime settings', 'agents/openai.yaml'));
    for (const role of expected) {
      const entry = openai.roles?.[role];
      const expectedSpec = role === 'controller' ? 'protocols/RIFF-NEXT.md' : ROLE_SPECS[role];
      const expectedVariants = Object.fromEntries(ROUTE_PORTFOLIO
        .filter((route) => route.semanticRole === role)
        .map((route) => [route.routeClass, `agents/codex/${route.file}`]));
      if (!entry || entry.semantic_spec !== expectedSpec || JSON.stringify(entry.variants || {}) !== JSON.stringify(expectedVariants)) findings.push(finding(`agents/openai.yaml route mismatch for ${role}`, 'agents/openai.yaml'));
      if (entry && (!existingPath(projectRoot, entry.semantic_spec) || Object.values(entry.variants || {}).some((variant) => !existingPath(projectRoot, variant)))) findings.push(finding(`agents/openai.yaml route path missing for ${role}`, 'agents/openai.yaml'));
    }
  }
  const claude = readYaml(claudePath);
  if (!claude) { findings.push(finding('agents/claude.yaml is not valid YAML', 'agents/claude.yaml')); return; }
  const primaryKeys = Object.keys(claude.roles || {}).sort();
  if (JSON.stringify(primaryKeys) !== JSON.stringify([...CANONICAL_ROLES].sort())) findings.push(finding('agents/claude.yaml must map exactly seven primary roles', 'agents/claude.yaml'));
  const aliasKeys = Object.keys(claude.aliases || {}).sort();
  if (JSON.stringify(aliasKeys) !== JSON.stringify(Object.keys(CLAUDE_ALIASES).sort())) findings.push(finding('agents/claude.yaml alias set is incomplete or has undeclared aliases', 'agents/claude.yaml'));
  for (const role of CANONICAL_ROLES) {
    const entry = claude.roles?.[role];
    const expected = CLAUDE_PRIMARY[role];
    const adapter = `agents/${role}.md`;
    if (!entry || entry.semantic_spec !== ROLE_SPECS[role] || entry.adapter !== adapter) findings.push(finding(`agents/claude.yaml route mismatch for ${role}`, 'agents/claude.yaml'));
    for (const [key, value] of Object.entries(expected)) if (entry?.[key] !== value) findings.push(finding(`agents/claude.yaml ${role} must set ${key}: ${value}`, 'agents/claude.yaml'));
    if (entry && (!existingPath(projectRoot, entry.semantic_spec) || !existingPath(projectRoot, entry.adapter))) findings.push(finding(`agents/claude.yaml route path missing for ${role}`, 'agents/claude.yaml'));
  }
  const nativeRoles = {
    controller: claude.native_roles?.controller,
    ...claude.roles,
  };
  if (JSON.stringify(Object.keys(nativeRoles).sort()) !== JSON.stringify(Object.keys(CLAUDE_NATIVE_ROUTES).sort())) {
    findings.push(finding('agents/claude.yaml native route set must map controller and exactly seven roles', 'agents/claude.yaml'));
  }
  for (const [role, expected] of Object.entries(CLAUDE_NATIVE_ROUTES)) {
    const entry = nativeRoles[role];
    if (!entry || entry.semantic_spec !== expected.semantic_spec) {
      findings.push(finding(`agents/claude.yaml native semantic route mismatch for ${role}`, 'agents/claude.yaml'));
      continue;
    }
    if (JSON.stringify(entry.variants || {}) !== JSON.stringify(expected.variants)) {
      findings.push(finding(`agents/claude.yaml native variant matrix mismatch for ${role}`, 'agents/claude.yaml'));
    }
    if (!existingPath(projectRoot, entry.semantic_spec)) findings.push(finding(`agents/claude.yaml native semantic path missing for ${role}`, 'agents/claude.yaml'));
  }
  for (const [alias, expected] of Object.entries(CLAUDE_ALIASES)) {
    const entry = claude.aliases?.[alias];
    const spec = ROLE_SPECS[expected.role];
    const adapter = `agents/${alias}.md`;
    if (!entry || entry.role !== expected.role || entry.semantic_spec !== spec || entry.adapter !== adapter) findings.push(finding(`agents/claude.yaml alias mismatch for ${alias}`, 'agents/claude.yaml'));
    for (const [key, value] of Object.entries(expected)) if (key !== 'role' && entry?.[key] !== value) findings.push(finding(`agents/claude.yaml alias ${alias} must set ${key}: ${value}`, 'agents/claude.yaml'));
    if (entry && (!existingPath(projectRoot, entry.semantic_spec) || !existingPath(projectRoot, entry.adapter))) findings.push(finding(`agents/claude.yaml alias path missing for ${alias}`, 'agents/claude.yaml'));
  }
}

function checkTopLevelAgents(projectRoot, findings) {
  const agentsDir = path.join(projectRoot, 'agents');
  if (!fs.existsSync(agentsDir)) { findings.push(finding('agents directory is missing', 'agents')); return; }
  const files = fs.readdirSync(agentsDir).filter((name) => name.endsWith('.md')).sort();
  const expected = TOP_LEVEL_AGENTS.map((name) => `${name}.md`).sort();
  for (const name of expected) if (!files.includes(name)) findings.push(finding(`missing top-level agent adapter: ${name}`, 'agents'));
  for (const name of files) if (!expected.includes(name)) findings.push(finding(`undeclared top-level agent: ${name}`, path.relative(projectRoot, path.join(agentsDir, name))));
  for (const role of CANONICAL_ROLES) checkClaudeAdapter(projectRoot, findings, role, role, `agents/${role}.md`);
  for (const [alias, expectedRole] of Object.entries(CLAUDE_ALIASES)) checkClaudeAdapter(projectRoot, findings, alias, expectedRole.role, `agents/${alias}.md`);
  for (const retired of ['scope-checker.md', 'improver.md']) if (fs.existsSync(path.join(agentsDir, retired))) findings.push(finding(`retired agent must be absent: ${retired}`, `agents/${retired}`));
}

function checkRoutes(projectRoot, findings) {
  let frameworkRoot;
  try { frameworkRoot = fs.realpathSync(projectRoot); } catch { frameworkRoot = projectRoot; }
  const routesDir = path.join(frameworkRoot, 'agents', 'codex');
  if (!fs.existsSync(routesDir)) { findings.push(finding('agents/codex is missing', 'agents/codex')); return; }
  try {
    const stat = fs.lstatSync(routesDir);
    if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(routesDir) !== routesDir) {
      findings.push(finding('agents/codex must be a real lexical directory', 'agents/codex'));
      return;
    }
  } catch { findings.push(finding('agents/codex is unreadable', 'agents/codex')); return; }
  const expectedFiles = ROUTE_PORTFOLIO.map((route) => route.file).sort();
  const routeFiles = fs.readdirSync(routesDir).filter((name) => name.endsWith('.toml')).sort();
  for (const name of expectedFiles) if (!routeFiles.includes(name)) findings.push(finding(`missing exact runtime route: ${name}`, 'agents/codex'));
  for (const name of routeFiles) {
    const file = path.join(routesDir, name);
    const expected = ROUTE_PORTFOLIO.find((candidate) => candidate.file === name);
    if (!expected) { findings.push(finding(`${name}: unknown runtime route`, path.relative(frameworkRoot, file))); continue; }
    const route = validateRouteSource({ file, frameworkRoot });
    for (const error of route.errors) findings.push(finding(`${name}: ${error}`, path.relative(frameworkRoot, file)));
  }
}

function checkDefaultProfile(projectRoot, findings) {
  const profile = readYaml(path.join(projectRoot, 'templates', 'profile.default.yaml'));
  if (!profile) {
    findings.push(finding('templates/profile.default.yaml is not valid YAML', 'templates/profile.default.yaml'));
    return;
  }
  if (profile.runtime?.provider !== 'codex') {
    findings.push(finding('default profile runtime.provider must be codex', 'templates/profile.default.yaml'));
  }
}

export function runArtifactChecks({ projectRoot = root } = {}) {
  const findings = [];
  checkManifest(projectRoot, findings);
  checkSkills(projectRoot, findings);
  checkCanonicalRoles(projectRoot, findings);
  checkTopLevelAgents(projectRoot, findings);
  checkMappings(projectRoot, findings);
  checkRoutes(projectRoot, findings);
  checkDefaultProfile(projectRoot, findings);
  return findings;
}

export function main(argv = process.argv.slice(2)) {
  const index = argv.indexOf('--project-root');
  const projectRoot = path.resolve(index >= 0 ? argv[index + 1] : root);
  const findings = runArtifactChecks({ projectRoot });
  if (!findings.length) { process.stdout.write('artifact-check: PASS\n'); return 0; }
  for (const result of findings) process.stdout.write(`ERROR ${result.file}: ${result.message}\n`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main());

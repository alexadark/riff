import fs from 'node:fs';
import path from 'node:path';

export const ROUTE_PORTFOLIO = Object.freeze([
  { file: 'controller-routine.toml', semanticRole: 'controller', routeClass: 'routine', model: 'gpt-5.6-sol', effort: 'medium', sandbox: 'read-only', roleSpec: 'protocols/RIFF-NEXT.md' },
  { file: 'controller-architecture.toml', semanticRole: 'controller', routeClass: 'architecture', model: 'gpt-5.6-sol', effort: 'xhigh', sandbox: 'read-only', roleSpec: 'protocols/RIFF-NEXT.md' },
  { file: 'planner-routine.toml', semanticRole: 'planner', routeClass: 'routine', model: 'gpt-5.6-sol', effort: 'medium', sandbox: 'read-only', roleSpec: 'agents/roles/planner.md' },
  { file: 'planner-architecture.toml', semanticRole: 'planner', routeClass: 'architecture', model: 'gpt-5.6-sol', effort: 'xhigh', sandbox: 'read-only', roleSpec: 'agents/roles/planner.md' },
  { file: 'worker-inventory.toml', semanticRole: 'worker', routeClass: 'inventory', model: 'gpt-5.6-luna', effort: 'low', serviceTier: 'priority', sandbox: 'workspace-write', roleSpec: 'agents/roles/worker.md' },
  { file: 'worker-repeatable.toml', semanticRole: 'worker', routeClass: 'repeatable', model: 'gpt-5.6-luna', effort: 'xhigh', serviceTier: 'priority', sandbox: 'workspace-write', roleSpec: 'agents/roles/worker.md' },
  { file: 'worker-bounded.toml', semanticRole: 'worker', routeClass: 'bounded', model: 'gpt-5.6-terra', effort: 'high', sandbox: 'workspace-write', roleSpec: 'agents/roles/worker.md' },
  { file: 'reviewer-routine.toml', semanticRole: 'reviewer', routeClass: 'routine', model: 'gpt-5.6-sol', effort: 'medium', sandbox: 'read-only', roleSpec: 'agents/roles/reviewer.md' },
  { file: 'reviewer-critical.toml', semanticRole: 'reviewer', routeClass: 'critical', model: 'gpt-5.6-sol', effort: 'xhigh', sandbox: 'read-only', roleSpec: 'agents/roles/reviewer.md' },
  { file: 'reviewer-escalation.toml', semanticRole: 'reviewer', routeClass: 'escalation', model: 'gpt-5.6-sol', effort: 'max', sandbox: 'read-only', roleSpec: 'agents/roles/reviewer.md' },
  { file: 'debugger.toml', semanticRole: 'debugger', routeClass: 'fixed', model: 'gpt-5.6-sol', effort: 'xhigh', sandbox: 'read-only', roleSpec: 'agents/roles/debugger.md' },
  { file: 'security-reviewer.toml', semanticRole: 'security-reviewer', routeClass: 'fixed', model: 'gpt-5.6-sol', effort: 'xhigh', sandbox: 'read-only', roleSpec: 'agents/roles/security-reviewer.md' },
  { file: 'red-teamer.toml', semanticRole: 'red-teamer', routeClass: 'fixed', model: 'gpt-5.6-sol', effort: 'xhigh', sandbox: 'read-only', roleSpec: 'agents/roles/red-teamer.md' },
  { file: 'load-tester.toml', semanticRole: 'load-tester', routeClass: 'fixed', model: 'gpt-5.6-luna', effort: 'xhigh', serviceTier: 'priority', sandbox: 'read-only', roleSpec: 'agents/roles/load-tester.md' },
]);

export const ROUTE_BY_FILE = Object.freeze(Object.fromEntries(ROUTE_PORTFOLIO.map((route) => [route.file, route])));
export function routeKey(semanticRole, routeClass) { return `${semanticRole}:${routeClass}`; }
export const ROUTE_BY_KEY = Object.freeze(Object.fromEntries(ROUTE_PORTFOLIO.map((route) => [routeKey(route.semanticRole, route.routeClass), route])));

const SCALAR_FIELDS = new Set(['name', 'description', 'semantic_role', 'route_class', 'model', 'model_reasoning_effort', 'service_tier', 'sandbox_mode', 'role_spec_path']);
const REQUIRED_FIELDS = Object.freeze([...SCALAR_FIELDS].filter((field) => field !== 'service_tier').concat('developer_instructions'));

function decodeQuotedScalar(raw) {
  if (!/^"(?:[^"\\\n\r]|\\(?:["\\bfnrt]|u[0-9a-fA-F]{4}))*"$/.test(raw)) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

/** Parse the deliberately tiny TOML grammar accepted by RIFF runtime adapters. */
export function parseRouteText(source) {
  const text = String(source);
  const lines = text.split(/\n/).map((line) => line.endsWith('\r') ? line.slice(0, -1) : line);
  const values = {};
  const errors = [];
  const seen = new Set();
  let cursor = 0;
  let featuresSeen = false;
  const addField = (key, value) => {
    if (seen.has(key)) errors.push(`duplicate top-level field: ${key}`);
    else { seen.add(key); values[key] = value; }
  };
  const blank = (line) => line === '';

  while (cursor < lines.length && blank(lines[cursor])) cursor += 1;
  while (cursor < lines.length && lines[cursor] !== '[features]') {
    const line = lines[cursor];
    if (blank(line)) { cursor += 1; continue; }
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*) = (.*)$/);
    if (!assignment) { errors.push(`invalid top-level syntax at line ${cursor + 1}`); cursor += 1; continue; }
    const [, key, raw] = assignment;
    if (key === 'developer_instructions') {
      if (raw !== '"""') { errors.push('developer_instructions must use an exact triple-double-quoted block'); cursor += 1; continue; }
      const body = [];
      cursor += 1;
      while (cursor < lines.length && lines[cursor] !== '"""') { body.push(lines[cursor]); cursor += 1; }
      if (cursor >= lines.length) { errors.push('developer_instructions block is unterminated'); break; }
      addField(key, body.join('\n'));
      cursor += 1;
      continue;
    }
    if (!SCALAR_FIELDS.has(key)) {
      errors.push(`unknown top-level field: ${key}`);
      cursor += 1;
      continue;
    }
    const value = decodeQuotedScalar(raw);
    if (value === undefined) errors.push(`top-level field ${key} must use an exact double-quoted scalar`);
    else addField(key, value);
    cursor += 1;
  }

  if (cursor >= lines.length || lines[cursor] !== '[features]') errors.push('must contain the exact [features] table');
  else {
    featuresSeen = true;
    cursor += 1;
    let featureSeen = false;
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (blank(line)) { cursor += 1; continue; }
      if (line === 'multi_agent = false') {
        if (featureSeen) errors.push('duplicate features field: multi_agent');
        featureSeen = true;
      } else if (/^\[.*\]$/.test(line)) errors.push(`unknown table: ${line}`);
      else errors.push(`invalid [features] syntax at line ${cursor + 1}`);
      cursor += 1;
    }
    if (!featureSeen) errors.push('must contain literal [features] multi_agent = false');
  }
  if (featuresSeen && cursor < lines.length) errors.push('trailing route content');
  for (const field of REQUIRED_FIELDS) if (!seen.has(field)) errors.push(`missing required top-level field: ${field}`);
  if (/\b(?:haiku|fallback)\b/i.test(text)) errors.push('contains a forbidden Haiku or fallback reference');
  const instructions = values.developer_instructions || '';
  if (!instructions || !/role_spec_path/.test(instructions) || !/absolute(?: filesystem)? path/i.test(instructions)) errors.push('developer_instructions must require an absolute role_spec_path');
  return { values, errors, instructions };
}

function realLexicalFile(file) {
  const lexical = path.resolve(file);
  const stat = fs.lstatSync(lexical);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('must be a non-symlink regular file');
  if (fs.realpathSync(lexical) !== lexical) throw new Error('must remain at its lexical path');
  return lexical;
}

function realLexicalDirectory(directory) {
  const lexical = path.resolve(directory);
  const stat = fs.lstatSync(lexical);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('must be a non-symlink directory');
  if (fs.realpathSync(lexical) !== lexical) throw new Error('must remain at its lexical path');
  return lexical;
}

function contained(root, candidate) {
  return candidate.startsWith(`${root}${path.sep}`);
}

export function validateRouteSource({ file, frameworkRoot }) {
  const expected = ROUTE_BY_FILE[path.basename(file)];
  if (!expected) return { errors: ['is not a declared runtime route'] };
  const errors = [];
  let root;
  let routePath;
  try {
    root = fs.realpathSync(path.resolve(frameworkRoot));
    if (!fs.lstatSync(root).isDirectory()) throw new Error('framework root must be a directory');
    realLexicalDirectory(path.join(root, 'agents'));
    const routesDir = realLexicalDirectory(path.join(root, 'agents', 'codex'));
    if (path.basename(file) !== expected.file) throw new Error('must use its declared adapter filename');
    routePath = realLexicalFile(path.join(routesDir, expected.file));
  } catch (error) {
    return { expected, errors: [`runtime route boundary ${error.message}`] };
  }
  let parsed;
  try { parsed = parseRouteText(fs.readFileSync(routePath, 'utf8')); }
  catch (error) { return { expected, errors: [`runtime route read failed: ${error.message}`] }; }
  errors.push(...parsed.errors);
  const { values } = parsed;
  for (const [key, actual, required] of [
    ['semantic_role', values.semantic_role, expected.semanticRole],
    ['route_class', values.route_class, expected.routeClass],
    ['model', values.model, expected.model],
    ['model_reasoning_effort', values.model_reasoning_effort, expected.effort],
    ['sandbox_mode', values.sandbox_mode, expected.sandbox],
  ]) if (actual !== required) errors.push(`${key} must be ${required}`);
  if (expected.serviceTier) {
    if (values.service_tier !== expected.serviceTier) errors.push(`service_tier must be ${expected.serviceTier}`);
  } else if (Object.hasOwn(values, 'service_tier')) {
    errors.push('service_tier is only allowed for Luna routes');
  }
  if (!values.role_spec_path || path.isAbsolute(values.role_spec_path)) errors.push('source role_spec_path must be a portable relative path');
  else if (path.normalize(values.role_spec_path) !== expected.roleSpec) errors.push(`role_spec_path must be ${expected.roleSpec}`);
  let roleSpecPath;
  try {
    roleSpecPath = path.resolve(root, values.role_spec_path || '');
    if (!contained(root, roleSpecPath)) throw new Error('escapes framework root');
    realLexicalFile(roleSpecPath);
  } catch (error) { errors.push(`role_spec_path is missing, symlinked, or escapes framework root: ${error.message}`); }
  return { expected, parsed, roleSpecPath, errors };
}

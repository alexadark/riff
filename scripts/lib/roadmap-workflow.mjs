import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import yaml from 'js-yaml';

function fail(message) { throw new Error(message); }

export function atomicWrite(file, content) {
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`refusing to replace non-regular artifact: ${file}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temporary = path.join(directory, `.${path.basename(file)}.tmp-${process.pid}-${Date.now()}`);
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try {
    fs.writeFileSync(descriptor, content);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  fs.renameSync(temporary, file);
}

export function resolveProjectRoot(candidate = process.cwd()) {
  try {
    return fs.realpathSync(execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: path.resolve(candidate), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    }).trim());
  } catch {
    fail('RIFF wave requires a Git project root');
  }
}

export function resolveFrameworkRoot(projectRoot) {
  const link = path.join(projectRoot, '.riff');
  let stat;
  try { stat = fs.lstatSync(link); } catch { fail('RIFF wave requires the project .riff symlink; run riff init first'); }
  if (!stat.isSymbolicLink()) fail('project .riff must be a framework symlink');
  const frameworkRoot = fs.realpathSync(link);
  if (!fs.statSync(frameworkRoot).isDirectory()) fail('project .riff does not resolve to a framework directory');
  return frameworkRoot;
}

function scalar(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function list(value) {
  if (Array.isArray(value)) return value.map(scalar).filter(Boolean);
  const text = scalar(value);
  if (!text) return [];
  return text.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export function slugify(value) {
  const slug = scalar(value).toLowerCase().normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'phase';
}

function normalizedPhase(raw, index, format, key) {
  const id = format === 'mapping' ? key.replace(/^phase-/, '') : scalar(raw.id);
  const title = scalar(raw.title || raw.name || raw.description || `Phase ${id}`);
  return {
    id,
    slug: scalar(raw.slug) || slugify(title),
    title,
    status: scalar(raw.status || 'todo').toLowerCase() === 'complete' ? 'done' : scalar(raw.status || 'todo').toLowerCase(),
    priority: scalar(raw.priority || 'P2'),
    mode: Array.isArray(raw.mode) ? raw.mode.map(scalar) : [scalar(raw.mode || 'AFK')],
    dependsOn: list(raw.depends_on),
    goal: scalar(raw.goal || raw.description || title),
    tasks: list(raw.tasks),
    constraints: list(raw.constraints),
    tags: list(raw.tags),
    providerMode: scalar(raw.provider_mode || 'production').toLowerCase(),
    hitlReason: scalar(raw.hitl_reason || raw.human_verification || ''),
    confirmationRequired: raw.confirmation_required === true,
    index,
    raw,
  };
}

export function loadRoadmap(projectRoot) {
  const file = path.join(projectRoot, 'ROADMAP.yaml');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { fail('ROADMAP.yaml is missing; run RIFF start before launching a wave'); }
  let parsed;
  try { parsed = yaml.load(text); } catch (error) { fail(`ROADMAP.yaml is invalid YAML: ${error.message}`); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) fail('ROADMAP.yaml must contain a YAML mapping');
  if (Array.isArray(parsed.phases)) {
    const phases = parsed.phases.map((phase, index) => normalizedPhase(phase || {}, index, 'list'));
    if (!phases.length) fail('ROADMAP.yaml contains no phases');
    return { file, text, parsed, format: 'list', phases };
  }
  const entries = Object.entries(parsed).filter(([key, value]) => /^phase-[0-9]+(?:\.[0-9]+)?$/.test(key) && value && typeof value === 'object');
  if (!entries.length) fail('ROADMAP.yaml contains no supported phases');
  return {
    file, text, parsed, format: 'mapping',
    phases: entries.map(([key, value], index) => normalizedPhase(value, index, 'mapping', key)),
  };
}

export function validateRoadmap(projectRoot, frameworkRoot) {
  const validator = path.join(frameworkRoot, 'lib', 'validate-roadmap.sh');
  const result = spawnSync('bash', [validator, path.join(projectRoot, 'ROADMAP.yaml')], {
    cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) fail(`ROADMAP.yaml validation failed: ${(result.stderr || result.stdout || '').trim()}`);
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

export function updatePhaseStatus(roadmap, phaseId, status) {
  if (!['todo', 'in-progress', 'done', 'blocked', 'skipped'].includes(status)) fail(`invalid roadmap phase status: ${status}`);
  const lines = roadmap.text.split('\n');
  let start = -1;
  let end = lines.length;
  if (roadmap.format === 'list') {
    for (let index = 0; index < lines.length; index += 1) {
      const match = lines[index].match(/^\s*-\s+id:\s*([^#]+?)(?:\s+#.*)?$/);
      if (match && unquote(match[1]) === String(phaseId)) { start = index; break; }
    }
    if (start >= 0) {
      for (let index = start + 1; index < lines.length; index += 1) {
        if (/^\s*-\s+id:/.test(lines[index])) { end = index; break; }
      }
    }
  } else {
    start = lines.findIndex((line) => line.trim() === `phase-${phaseId}:`);
    if (start >= 0) {
      for (let index = start + 1; index < lines.length; index += 1) {
        if (/^[A-Za-z0-9_-]+:\s*/.test(lines[index])) { end = index; break; }
      }
    }
  }
  if (start < 0) fail(`phase ${phaseId} is missing from ROADMAP.yaml`);
  const statusIndex = lines.slice(start + 1, end).findIndex((line) => /^\s+status:\s*/.test(line));
  if (statusIndex < 0) fail(`phase ${phaseId} has no status field in ROADMAP.yaml`);
  const lineIndex = start + 1 + statusIndex;
  const indent = lines[lineIndex].match(/^\s*/)?.[0] || '    ';
  const comment = lines[lineIndex].match(/\s+#.*$/)?.[0] || '';
  lines[lineIndex] = `${indent}status: ${status}${comment}`;
  const text = lines.join('\n');
  atomicWrite(roadmap.file, text);
  roadmap.text = text;
  const phase = roadmap.phases.find((entry) => entry.id === String(phaseId));
  if (phase) phase.status = status;
}

export function phaseKey(phase) { return `${phase.id}-${phase.slug}`; }

export function phaseTask(phase) {
  const sentence = (value) => value.replace(/[.\s]+$/g, '');
  const parts = [`${sentence(phase.goal || phase.title)}.`];
  if (phase.tasks.length) parts.push(`Complete these phase tasks: ${phase.tasks.map(sentence).join('; ')}.`);
  if (phase.constraints.length) parts.push(`Preserve these constraints: ${phase.constraints.map(sentence).join('; ')}.`);
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export function requiresConfirmation(phase) {
  const modes = phase.mode.map((value) => value.toUpperCase());
  const tags = phase.tags.map((value) => value.toLowerCase());
  const text = `${phase.title} ${phase.goal} ${phase.tasks.join(' ')} ${phase.hitlReason || ''}`.toLowerCase();
  const actionText = [phase.title, phase.goal, ...phase.tasks].join('\n').toLowerCase();
  const explicitHumanVerification = tags.some((tag) => [
    'visual-verification', 'functional-verification', 'manual-verification', 'human-verification',
  ].includes(tag));
  const realWorldVerification = /\b(?:visual acceptance|manual browser|human functional|functional verification|physical device|real payment checkout|real (?:oauth|sso|mfa|2fa)|(?:oauth|sso|mfa|2fa) (?:browser|flow verification)|dns cutover)\b/.test(text);
  const destructiveBoundary = tags.some((tag) => ['destructive', 'promotion', 'deploy', 'production-cutover'].includes(tag))
    || /\b(?:irreversible|production (?:deploy|deployment|cutover)|dns cutover|promot(?:e|ion))\b/.test(text)
    || /\b(?:delete|remove|destroy|wipe|drop)\b[^.\n]{0,120}\b(?:production|customer records?|database records?)\b/.test(actionText)
    || /\bdeploy\s+(?:the\s+)?(?:application|app|service|release)\s+(?:to|into)\s+(?:staging|production)\b/.test(actionText)
    || /\bpublish\s+(?:the\s+)?(?:release|application|app|package)(?:\s+(?:to|for)\b|[.!;:]|$)/m.test(actionText);
  const securityOnly = tags.length > 0
    && tags.every((tag) => ['security', 'security_critical', 'auth', 'authorization', 'authentication', 'payment-security'].includes(tag))
    && !explicitHumanVerification && !realWorldVerification && !destructiveBoundary;
  // Honor legacy HITL by default. The only automatic exception is a phase
  // explicitly tagged as security-only implementation with no real-world,
  // destructive, visual, or functional boundary.
  return phase.confirmationRequired || destructiveBoundary || explicitHumanVerification || realWorldVerification
    || (modes.includes('HITL') && !securityOnly);
}

export function phaseVerificationMetadata(phase) {
  return {
    id: phase.id,
    slug: phase.slug,
    title: phase.title,
    priority: phase.priority,
    mode: phase.mode,
    depends_on: phase.dependsOn,
    goal: phase.goal,
    tasks: phase.tasks,
    constraints: phase.constraints,
    tags: phase.tags,
    provider_mode: phase.providerMode,
    hitl_reason: phase.hitlReason,
    confirmation_required: phase.confirmationRequired,
  };
}

export function phaseVerificationMetadataSha256(phase) {
  return createHash('sha256').update(JSON.stringify(phaseVerificationMetadata(phase))).digest('hex');
}

export function phaseIsReady(phase, phases, completedThisRun = new Set()) {
  if (!['todo', 'in-progress'].includes(phase.status)) return false;
  return phase.dependsOn.every((dependency) => {
    if (completedThisRun.has(String(dependency))) return true;
    const target = phases.find((candidate) => candidate.id === String(dependency));
    return target && ['done', 'skipped'].includes(target.status);
  });
}

export function selectReadyPhases(roadmap, { requestedIds, completedThisRun = new Set() } = {}) {
  const requested = requestedIds?.length ? new Set(requestedIds.map(String)) : null;
  return roadmap.phases.filter((phase) => (!requested || requested.has(phase.id))
    && phaseIsReady(phase, roadmap.phases, completedThisRun)
    && !requiresConfirmation(phase));
}

// Confirmation eligibility is intentionally separate from ordinary readiness.
// The wave runner may admit one receipt-backed phase without making all HITL
// work generally autonomous.
export function selectReadyConfirmationPhases(roadmap, { requestedIds, completedThisRun = new Set() } = {}) {
  const requested = requestedIds?.length ? new Set(requestedIds.map(String)) : null;
  return roadmap.phases.filter((phase) => (!requested || requested.has(phase.id))
    && phaseIsReady(phase, roadmap.phases, completedThisRun)
    && requiresConfirmation(phase));
}

export function remainingPhases(roadmap, requestedIds) {
  const requested = requestedIds?.length ? new Set(requestedIds.map(String)) : null;
  return roadmap.phases.filter((phase) => (!requested || requested.has(phase.id))
    && !['done', 'skipped'].includes(phase.status));
}

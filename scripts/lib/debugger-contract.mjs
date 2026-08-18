import path from 'node:path';

export const DEBUGGER_HEADERS = Object.freeze(['Status', 'Identity', 'Failure Classification', 'Hypotheses', 'Evidence', 'Root Cause', 'Fix Assignment', 'Validation', 'Unresolved Risk']);

function isRecord(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

export function safeDebuggerAssignmentPath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256
    && !path.isAbsolute(value) && !value.includes('\\') && !value.includes('\0')
    && value === value.trim() && value !== '.' && !value.split('/').some((part) => !part || part === '.' || part === '..')
    && value !== '.git' && value !== '.planning'
    && !value.startsWith('.git/') && !value.startsWith('.planning/');
}

function nonemptyBoundedStrings(value, maximum = 100) {
  return Array.isArray(value) && value.length > 0 && value.length <= maximum
    && value.every((entry) => typeof entry === 'string' && entry.trim() === entry && entry.length > 0 && entry.length <= 1000);
}

function hasAbsolutePathLeak(value) { return /(?:^|[\s"'`])(?:\/|[A-Za-z]:[\\/])/m.test(String(value)); }

export function parseDebuggerReport(text, { phase, run, intensity = 'high' }) {
  if (!['normal', 'high', 'max'].includes(intensity)) return { valid: false };
  if (typeof text !== 'string' || text.length === 0 || text.length > 200_000 || hasAbsolutePathLeak(text)) return { valid: false };
  const parts = [...text.matchAll(/^## ([^\n]+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)];
  if (parts.length !== DEBUGGER_HEADERS.length || JSON.stringify(parts.map((entry) => entry[1])) !== JSON.stringify(DEBUGGER_HEADERS)) return { valid: false };
  if (text.replace(/^## [^\n]+\n[\s\S]*?(?=^## |(?![\s\S]))/gm, '').trim()) return { valid: false };
  const body = Object.fromEntries(parts.map((entry) => [entry[1], entry[2].trim()]));
  if (!['DIAGNOSED', 'UNRESOLVED'].includes(body.Status)) return { valid: false };
  for (const heading of ['Failure Classification', 'Hypotheses', 'Evidence', 'Root Cause', 'Validation', 'Unresolved Risk']) {
    if (!body[heading] || body[heading].length > 50_000) return { valid: false };
  }
  let identity;
  try { identity = JSON.parse(body.Identity); } catch { return { valid: false }; }
  if (!isRecord(identity) || JSON.stringify(Object.keys(identity).sort()) !== JSON.stringify(['intensity', 'phase', 'run'])
    || identity.phase !== phase || identity.run !== run || identity.intensity !== intensity) return { valid: false };
  let assignment;
  try { assignment = JSON.parse(body['Fix Assignment']); } catch { return { valid: false }; }
  if (!isRecord(assignment) || JSON.stringify(Object.keys(assignment).sort()) !== JSON.stringify(['acceptance_criteria', 'allowed_paths', 'checks'])) return { valid: false };
  if (!nonemptyBoundedStrings(assignment.allowed_paths) || !assignment.allowed_paths.every(safeDebuggerAssignmentPath)
    || new Set(assignment.allowed_paths).size !== assignment.allowed_paths.length
    || !nonemptyBoundedStrings(assignment.acceptance_criteria) || !nonemptyBoundedStrings(assignment.checks)) return { valid: false };
  return { valid: true, status: body.Status, assignment };
}

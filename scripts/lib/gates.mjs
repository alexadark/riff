import { artifactPath, readIfExists, writeText } from './artifacts.mjs';

export const GATE_STATUSES = ['pending', 'running', 'pass', 'warn', 'fail', 'skipped'];

export const GATE_ORDER = [
  'plan-review',
  'execute',
  'scope-check',
  'code-review',
  'security-review',
  'docs-check',
  'fallow',
  'hooks',
  'hook-reconcile',
  'dashboard',
  'dashboard-explain',
  'summary',
  'state',
  'r1-r4',
  'no-secrets',
  'smoke',
];

const SCRATCH_REQUIRED = new Set(['r1-r4', 'no-secrets', 'smoke', 'summary', 'state']);

function productionRequired(gate) {
  return gate !== 'dashboard-explain';
}

function requiredForScope(gate, scope) {
  if (scope === 'scratch') return SCRATCH_REQUIRED.has(gate);
  return productionRequired(gate);
}

function defaultEntry(gate, scope) {
  const required = requiredForScope(gate, scope);
  const skippedByDefault = !required;
  return {
    gate,
    status: skippedByDefault ? 'skipped' : 'pending',
    required,
    command: '',
    exitCode: '',
    artifact: '',
    updatedAt: '',
    reason: skippedByDefault ? (scope === 'scratch' ? 'skipped by scratch scope' : 'optional') : '',
  };
}

function escapeCell(value) {
  return String(value ?? '')
    .replaceAll('\n', ' ')
    .replaceAll('|', '\\|')
    .trim();
}

function unescapeCell(value) {
  return value.replaceAll('\\|', '|').trim();
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split(/(?<!\\)\|/)
    .map((cell) => unescapeCell(cell));
}

function normalizeEntry(entry, scope) {
  if (!GATE_ORDER.includes(entry.gate)) {
    throw new Error(`Unknown gate: ${entry.gate}`);
  }
  if (!GATE_STATUSES.includes(entry.status)) {
    throw new Error(`Invalid status for ${entry.gate}: ${entry.status}`);
  }
  return {
    ...defaultEntry(entry.gate, scope),
    ...entry,
    required: entry.required ?? requiredForScope(entry.gate, scope),
  };
}

export function readGateEntries(root, phaseDir, scope) {
  const gatesPath = artifactPath(phaseDir, 'GATES.md');
  const artifact = readIfExists(root, gatesPath);
  const entries = new Map(GATE_ORDER.map((gate) => [gate, defaultEntry(gate, scope)]));

  if (!artifact.exists) {
    return entries;
  }

  for (const line of artifact.text.split('\n')) {
    if (!line.startsWith('|')) continue;
    if (line.includes('---') || line.includes('Gate |')) continue;
    const [gate, status, required, command, exitCode, artifactPathValue, updatedAt, reason] = splitRow(line);
    if (!GATE_ORDER.includes(gate) || !GATE_STATUSES.includes(status)) continue;
    entries.set(gate, normalizeEntry({
      gate,
      status,
      required: required === 'yes',
      command,
      exitCode,
      artifact: artifactPathValue,
      updatedAt,
      reason,
    }, scope));
  }

  return entries;
}

export function renderGateLedger({ phaseId, scope, entries }) {
  const orderedEntries = GATE_ORDER.map((gate) => entries.get(gate) ?? defaultEntry(gate, scope));
  const rows = orderedEntries.map((entry) => {
    return [
      entry.gate,
      entry.status,
      entry.required ? 'yes' : 'no',
      entry.command,
      entry.exitCode,
      entry.artifact,
      entry.updatedAt,
      entry.reason,
    ].map(escapeCell).join(' | ');
  });

  return `# Gates Log - Phase ${phaseId}

Scope: \`${scope}\`

Statuses: \`pending\`, \`running\`, \`pass\`, \`warn\`, \`fail\`, \`skipped\`.

Production finalization is blocked by required gates that are \`pending\`, \`running\`, \`fail\`, or \`skipped\`, except \`state\` while the finalizer is running.
Scratch finalization is blocked by unresolved R1-R4, no-secrets, smoke, summary, or state gates.

| Gate | Status | Required | Command | Exit Code | Artifact | Updated At | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map((row) => `| ${row} |`).join('\n')}
`;
}

export function writeGateLedger(root, phase, scope, entries) {
  writeText(root, artifactPath(phase.dir, 'GATES.md'), renderGateLedger({
    phaseId: phase.id,
    scope,
    entries,
  }));
}

export function initializeGateLedger(root, phase, scope) {
  const entries = readGateEntries(root, phase.dir, scope);
  writeGateLedger(root, phase, scope, entries);
  return entries;
}

export function updateGate(root, phase, scope, entry) {
  const entries = readGateEntries(root, phase.dir, scope);
  entries.set(entry.gate, normalizeEntry({
    updatedAt: new Date().toISOString(),
    ...entry,
  }, scope));
  writeGateLedger(root, phase, scope, entries);
  return entries;
}

export function blockingGates(entries, scope, options = {}) {
  const ignored = new Set(options.ignore ?? []);
  const blockers = [];
  for (const gate of GATE_ORDER) {
    if (ignored.has(gate)) continue;
    const entry = entries.get(gate) ?? defaultEntry(gate, scope);
    if (!entry.required) continue;
    if (entry.status === 'pending' || entry.status === 'running' || entry.status === 'fail' || entry.status === 'skipped') {
      blockers.push({
        gate,
        status: entry.status,
        reason: entry.reason || 'required gate is not resolved',
      });
    }
  }
  return blockers;
}

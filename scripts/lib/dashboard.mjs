import { artifactPath, readIfExists, readJsonIfExists, writeJson } from './artifacts.mjs';
import { readGateEntries, updateGate } from './gates.mjs';

const SOURCE_FILES = [
  'ROADMAP.yaml',
  '.planning/config.json',
  'STATE.md',
  'PLAN.md',
  'PLAN-REVIEW.md',
  'SUMMARY.md',
  'SCOPE-CHECK.json',
  'REVIEW.md',
  'SECURITY.md',
  'DOCS-CHECK.md',
  'GATES.md',
  'HANDOFF.md',
];

function phaseSourcePath(phaseDir, file) {
  if (file.startsWith('.') || file === 'ROADMAP.yaml' || file === 'STATE.md') return file;
  return artifactPath(phaseDir, file);
}

function artifactStatus(root, phaseDir, file) {
  const sourcePath = phaseSourcePath(phaseDir, file);
  const artifact = readIfExists(root, sourcePath);
  return {
    path: sourcePath,
    exists: artifact.exists,
    bytes: artifact.text.length,
  };
}

function extractVerdict(text) {
  const match = text.match(/\b(PASS|FAIL|REVISE|SKIPPED)\b/);
  return match ? match[1] : 'unknown';
}

function readVerdict(root, phaseDir, file) {
  const artifact = readIfExists(root, artifactPath(phaseDir, file));
  if (!artifact.exists) return 'missing';
  return extractVerdict(artifact.text);
}

function readRoadmapPhase(root, phaseId) {
  const roadmap = readIfExists(root, 'ROADMAP.yaml');
  if (!roadmap.exists) return undefined;
  const escaped = phaseId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = roadmap.text.match(new RegExp(`id:\\s*["']?${escaped}["']?[\\s\\S]{0,500}`));
  return match ? match[0].split('\n').slice(0, 8).join('\n') : undefined;
}

export function buildDashboardMetadata({ root, phase, scope, gateOverrides = [] }) {
  const gateEntries = readGateEntries(root, phase.dir, scope);
  for (const entry of gateOverrides) {
    gateEntries.set(entry.gate, entry);
  }
  const config = readJsonIfExists(root, '.planning/config.json');
  const sourceArtifacts = SOURCE_FILES.map((file) => artifactStatus(root, phase.dir, file));
  const blockers = [...gateEntries.values()]
    .filter((entry) => entry.required && ['pending', 'running', 'fail', 'skipped'].includes(entry.status))
    .map((entry) => ({
      gate: entry.gate,
      status: entry.status,
      reason: entry.reason,
    }));

  return {
    phaseId: phase.id,
    phaseDir: phase.dir,
    generatedAt: new Date().toISOString(),
    generator: 'scripts/lib/dashboard.mjs',
    scope,
    configStatus: config.error ? 'invalid' : config.exists ? 'present' : 'missing',
    roadmapExcerpt: readRoadmapPhase(root, phase.id),
    sourceArtifacts,
    gates: Object.fromEntries([...gateEntries.entries()].map(([gate, entry]) => [gate, {
      status: entry.status,
      required: entry.required,
      artifact: entry.artifact,
      reason: entry.reason,
    }])),
    smokeStatus: gateEntries.get('smoke')?.status ?? 'pending',
    reviewVerdict: readVerdict(root, phase.dir, 'REVIEW.md'),
    securityVerdict: readVerdict(root, phase.dir, 'SECURITY.md'),
    documentationStatus: gateEntries.get('docs-check')?.status ?? 'pending',
    blockingStatus: blockers.length === 0 ? 'clear' : 'blocked',
    blockers,
    nextAction: blockers.length === 0 ? 'finalize' : `resolve ${blockers[0].gate}`,
  };
}

export function writeDashboardMetadata({ root, phase, scope }) {
  const outputPath = artifactPath(phase.dir, 'dashboard-metadata.json');
  const currentDashboardEntry = readGateEntries(root, phase.dir, scope).get('dashboard');
  const dashboardEntry = {
    gate: 'dashboard',
    status: 'pass',
    required: currentDashboardEntry?.required,
    command: 'dashboard-metadata',
    exitCode: 0,
    artifact: outputPath,
    updatedAt: new Date().toISOString(),
    reason: 'dashboard metadata generated from artifacts',
  };
  const metadata = buildDashboardMetadata({
    root,
    phase,
    scope,
    gateOverrides: [dashboardEntry],
  });
  try {
    writeJson(root, outputPath, metadata);
  } catch (error) {
    updateGate(root, phase, scope, {
      gate: 'dashboard',
      status: 'fail',
      command: 'dashboard-metadata',
      exitCode: 1,
      artifact: outputPath,
      reason: error.message,
    });
    throw error;
  }
  updateGate(root, phase, scope, dashboardEntry);
  return {
    outputPath,
    metadata,
  };
}

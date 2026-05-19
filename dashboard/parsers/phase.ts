import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { phaseDir, type RoadmapPhase } from "./roadmap.ts";

export interface GateEntry {
  gate: string;
  status: string;
  required: boolean;
  command: string;
  exitCode: string;
  artifact: string;
  updatedAt: string;
  reason: string;
}

export interface PhaseFiles {
  plan: string | null;
  summary: string | null;
  verification: string | null;
  gates: string | null;
  refactor: string | null;
  plan_review: string | null;
  explain: string | null;
  explain_post: string | null;
}

const DURATION_REGEX = /(?:\*\*Duration\*\*|Duration)\s*:\s*(.+)$/im;

export function parseGatesContent(content: string): GateEntry[] {
  const entries: GateEntry[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    if (line.includes('---') || line.includes('Gate |')) continue;
    const cells = line
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((cell) => cell.replaceAll('\\|', '|').trim());
    const [gate, status, required, command, exitCode, artifact, updatedAt, reason] = cells;
    if (!gate || !status) continue;
    entries.push({
      gate: gate,
      status: status,
      required: required === 'yes',
      command: command ?? '',
      exitCode: exitCode ?? '',
      artifact: artifact ?? '',
      updatedAt: updatedAt ?? '',
      reason: reason ?? '',
    });
  }
  return entries;
}

/**
 * Extract the duration value from SUMMARY.md (looks for `Duration:` or `**Duration**:`).
 * Returns null if no match. Placeholder values like `{{DURATION}}` are returned as-is.
 */
export function extractDuration(summaryContent: string): string | null {
  const match = DURATION_REGEX.exec(summaryContent);
  if (!match) return null;
  const value = (match[1] ?? "").trim();
  return value || null;
}

function safeRead(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return readFileSync(path, "utf8");
  } catch (err) {
    console.warn(`[phase] failed to read ${path}:`, (err as Error).message);
    return null;
  }
}

function listDirSafe(path: string): string[] {
  try {
    if (!existsSync(path)) return [];
    return readdirSync(path);
  } catch {
    return [];
  }
}

/**
 * Find the first file matching a basename, accommodating numbered prefixes.
 * E.g. `findFile(dir, "PLAN.md")` matches `PLAN.md` or `65-pitchbook-adapter-01-PLAN.md`.
 */
function findFile(dir: string, basename: string): string | null {
  const direct = join(dir, basename);
  if (existsSync(direct)) return direct;
  // Fall back to suffix match (case-insensitive on basename portion).
  const lowered = basename.toLowerCase();
  for (const entry of listDirSafe(dir)) {
    if (entry.toLowerCase().endsWith(lowered)) {
      return join(dir, entry);
    }
  }
  return null;
}

/**
 * Resolve all known artefact paths for a phase. Missing files return null.
 */
export function resolvePhaseFiles(
  projectRoot: string,
  phase: Pick<RoadmapPhase, "id" | "slug">,
  level: string,
): PhaseFiles {
  const dir = phaseDir(projectRoot, phase);
  return {
    plan: findFile(dir, "PLAN.md"),
    summary: findFile(dir, "SUMMARY.md"),
    verification: findFile(dir, "VERIFICATION.md"),
    gates: findFile(dir, "GATES.md"),
    refactor: findFile(dir, "REFACTOR.md"),
    plan_review: findFile(dir, "PLAN-REVIEW.md"),
    explain: findFile(dir, `EXPLAIN.${level}.md`),
    explain_post: findFile(dir, `EXPLAIN-POST.${level}.md`),
  };
}

/**
 * List all available EXPLAIN levels (pre-exec) for a phase based on filenames present.
 */
export function availableExplainLevels(projectRoot: string, phase: Pick<RoadmapPhase, "id" | "slug">): string[] {
  const dir = phaseDir(projectRoot, phase);
  const levels = new Set<string>();
  for (const entry of listDirSafe(dir)) {
    const match = /^EXPLAIN\.([a-z0-9_-]+)\.md$/i.exec(entry);
    if (match && match[1]) levels.add(match[1].toLowerCase());
  }
  return [...levels].sort();
}

export function readGates(path: string | null): GateEntry[] {
  if (!path) return [];
  const content = safeRead(path);
  if (!content) return [];
  return parseGatesContent(content);
}

export { safeRead };

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

export type PhaseStatus = "todo" | "in-progress" | "done" | "blocked" | "skipped";
export type PhasePriority = "P0" | "P1" | "P2" | "P3";

export interface RoadmapPhase {
  id: number;
  slug: string;
  title: string;
  status: PhaseStatus;
  priority: PhasePriority;
  description: string;
  depends_on: number[];
}

export interface Roadmap {
  name: string;
  description: string;
  phases: RoadmapPhase[];
}

const STATUS_ALIASES: Record<string, PhaseStatus> = {
  todo: "todo",
  pending: "todo",
  planned: "todo",
  "in-progress": "in-progress",
  in_progress: "in-progress",
  inprogress: "in-progress",
  wip: "in-progress",
  active: "in-progress",
  done: "done",
  complete: "done",
  completed: "done",
  shipped: "done",
  blocked: "blocked",
  skipped: "skipped",
  rejected: "skipped",
  cancelled: "skipped",
  canceled: "skipped",
};

const PRIORITY_ALIASES: Record<string, PhasePriority> = {
  p0: "P0",
  p1: "P1",
  p2: "P2",
  p3: "P3",
  critical: "P0",
  high: "P0",
  medium: "P1",
  normal: "P2",
  low: "P3",
};

function normalizeStatus(value: unknown): PhaseStatus {
  if (typeof value !== "string") return "todo";
  return STATUS_ALIASES[value.toLowerCase().trim()] ?? "todo";
}

function normalizePriority(value: unknown): PhasePriority {
  if (typeof value !== "string") return "P2";
  return PRIORITY_ALIASES[value.toLowerCase().trim()] ?? "P2";
}

function toNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "number" ? v : Number(v)))
    .filter((v) => Number.isFinite(v));
}

function isSlugLike(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function humanize(slug: string): string {
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "phase";
}

function findFolderSlug(projectRoot: string, id: number): string | null {
  const dir = join(projectRoot, ".planning", "phases");
  if (!existsSync(dir)) return null;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }
  const prefix = `${id}-`;
  const match = entries.find((e) => e.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function resolvePhase(
  projectRoot: string,
  id: number,
  entry: Record<string, unknown>,
): RoadmapPhase | null {
  if (!Number.isFinite(id)) return null;

  const folderSlug = findFolderSlug(projectRoot, id);
  const rawSlug = typeof entry.slug === "string" ? entry.slug : "";
  const rawName = typeof entry.name === "string" ? entry.name : "";
  const rawTitle = typeof entry.title === "string" ? entry.title : "";

  let slug = "";
  let title = "";

  if (folderSlug) {
    slug = folderSlug;
  } else if (rawSlug && isSlugLike(rawSlug)) {
    slug = rawSlug;
  } else if (rawName && isSlugLike(rawName)) {
    slug = rawName;
  } else if (rawName) {
    slug = slugify(rawName);
  } else if (rawTitle) {
    slug = slugify(rawTitle);
  } else {
    slug = `phase-${id}`;
  }

  if (rawTitle) {
    title = rawTitle;
  } else if (rawName && !isSlugLike(rawName)) {
    title = rawName;
  } else {
    title = humanize(slug);
  }

  const description =
    typeof entry.description === "string" ? entry.description :
    typeof entry.rationale === "string" ? entry.rationale : "";

  return {
    id,
    slug,
    title,
    status: normalizeStatus(entry.status),
    priority: normalizePriority(entry.priority),
    description,
    depends_on: toNumberArray(entry.depends_on),
  };
}

/**
 * Parse ROADMAP.yaml from a project root. Handles three known formats:
 *   1. `phases: [{ id, slug, title, ... }]` — canonical RIFF template
 *   2. `phases: [{ id, name, ... }]` — brownfield with `name` as slug-like
 *   3. Top-level `phase-N: { name, ... }` keys — legacy /riff:map output
 */
export function parseRoadmap(projectRoot: string): Roadmap | null {
  const path = join(projectRoot, "ROADMAP.yaml");
  if (!existsSync(path)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    console.warn(`[roadmap] failed to read ${path}:`, (err as Error).message);
    return null;
  }

  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    console.warn(`[roadmap] YAML parse error in ${path}:`, (err as Error).message);
    return null;
  }

  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;

  const phases: RoadmapPhase[] = [];

  // Format 1 + 2: phases: [...] array
  if (Array.isArray(obj.phases)) {
    for (const entry of obj.phases) {
      if (!entry || typeof entry !== "object") continue;
      const p = entry as Record<string, unknown>;
      const id = typeof p.id === "number" ? p.id : Number(p.id);
      const phase = resolvePhase(projectRoot, id, p);
      if (phase) phases.push(phase);
    }
  }

  // Format 3: top-level phase-N keys (only if no phases array was found)
  if (phases.length === 0) {
    for (const [key, value] of Object.entries(obj)) {
      const match = /^phase-(\d+)$/i.exec(key);
      if (!match) continue;
      if (!value || typeof value !== "object") continue;
      const id = Number(match[1]);
      const phase = resolvePhase(projectRoot, id, value as Record<string, unknown>);
      if (phase) phases.push(phase);
    }
    phases.sort((a, b) => a.id - b.id);
  }

  return {
    name: typeof obj.name === "string" ? obj.name : "",
    description: typeof obj.description === "string" ? obj.description : "",
    phases,
  };
}

/**
 * Find the absolute folder for a phase under .planning/phases/.
 * The folder is named `${id}-${slug}`. Returns null if not present.
 */
export function phaseDir(projectRoot: string, phase: Pick<RoadmapPhase, "id" | "slug">): string {
  return join(projectRoot, ".planning", "phases", `${phase.id}-${phase.slug}`);
}

export function phaseDirExists(projectRoot: string, phase: Pick<RoadmapPhase, "id" | "slug">): boolean {
  return existsSync(phaseDir(projectRoot, phase));
}

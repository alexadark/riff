import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, dirname } from "node:path";
import YAML from "yaml";
import { resolveProfile, type Profile, type ProfileSource } from "../lib/resolveProfile.ts";

export type { Profile } from "../lib/resolveProfile.ts";

export type DashboardLevel = "technical" | "simple" | "eli5";
export type DashboardLanguage = "en" | "fr" | "other";

export interface DashboardConfig {
  level: DashboardLevel;
  language: DashboardLanguage;
  projects: string[];
}

export interface ProjectConfig {
  level: DashboardLevel;
  language: DashboardLanguage;
  source: ProfileSource;
}

/**
 * Walk up from `startDir` until a directory containing `marker` is found.
 * Returns absolute path to the matched directory, or null if not found.
 */
export function findFrameworkRoot(startDir: string, marker = "profile.yaml.example"): string | null {
  let current = startDir;
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(current, marker))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

function isLevel(value: unknown): value is DashboardLevel {
  return value === "technical" || value === "simple" || value === "eli5";
}

function isLanguage(value: unknown): value is DashboardLanguage {
  return value === "en" || value === "fr" || value === "other";
}

function normalizeProjects(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() && isAbsolute(entry)) {
      out.push(entry.trim());
    }
  }
  return [...new Set(out)];
}

/**
 * Derive level + language from a Profile, honoring the canonical and legacy keys.
 *
 * Level resolution order:   style.explanation_level → dashboard.level (legacy)
 * Language resolution order: user.narrative_language → dashboard.language (legacy) → user.conversational_language ("fr"|"en" only)
 *
 * Unrecognized values are dropped (treated as absent) so the next tier wins. If
 * nothing valid is found, returns `null` for that field — the caller substitutes
 * the neutre baseline.
 */
function pickLevelAndLanguage(profile: Profile): { level: DashboardLevel | null; language: DashboardLanguage | null } {
  const styleSection = profile.style ?? {};
  const userSection = profile.user ?? {};
  const dashSection = profile.dashboard ?? {};

  const levelCandidates: unknown[] = [styleSection.explanation_level, dashSection.level];
  let level: DashboardLevel | null = null;
  for (const candidate of levelCandidates) {
    if (isLevel(candidate)) {
      level = candidate;
      break;
    }
  }

  // conversational_language is treated as a language hint only when it is "fr" or "en".
  // Other ISO codes (de, pt, es, …) are not yet mapped to "other"; the field passes
  // through and the safety net substitutes "en". Phase 7 task 3 lifts that limitation.
  const languageCandidates: unknown[] = [
    userSection.narrative_language,
    dashSection.language,
    userSection.conversational_language === "fr" || userSection.conversational_language === "en"
      ? userSection.conversational_language
      : undefined,
  ];
  let language: DashboardLanguage | null = null;
  for (const candidate of languageCandidates) {
    if (isLanguage(candidate)) {
      language = candidate;
      break;
    }
  }

  return { level, language };
}

/**
 * Load the framework-wide dashboard config + the registry of projects.
 *
 * Resolution chain (via resolveProfile, no projectRoot supplied):
 *   1. <frameworkRoot>/profile.yaml         — user's framework profile
 *   2. <frameworkRoot>/templates/profile.neutre.yaml — canonical baseline
 *
 * The registry (`dashboard.projects`) is framework-scoped by design: per-project
 * overrides do not carry their own registry. For per-project level/language
 * resolution, use `resolveProjectConfig` instead.
 *
 * The "?? simple" / "?? en" fallbacks are a broken-install safety net: in a
 * healthy install, neutre.yaml supplies those values via the resolver chain.
 */
export function loadProfile(frameworkRoot: string): { profile: Profile; config: DashboardConfig } {
  const resolved = resolveProfile({ frameworkRoot });
  const profile = resolved.profile;
  const { level, language } = pickLevelAndLanguage(profile);
  const projects = normalizeProjects(profile.dashboard?.projects);

  const config: DashboardConfig = {
    level: level ?? "simple",
    language: language ?? "en",
    projects,
  };

  return { profile, config };
}

/**
 * Resolve the dashboard-relevant config for a single project, honoring
 * `<projectRoot>/.planning/profile.yaml` overrides via the full resolveProfile
 * chain. Used when rendering project-scoped output (phase narratives).
 *
 * Does NOT include the registry — that is framework-scoped only.
 *
 * Per the resolution contract, no field-by-field merge: a partial project
 * profile fully replaces the framework profile. Missing keys fall through to
 * the literal safety net below.
 */
export function resolveProjectConfig(projectRoot: string, frameworkRoot: string): ProjectConfig {
  const resolved = resolveProfile({ projectRoot, frameworkRoot });
  const { level, language } = pickLevelAndLanguage(resolved.profile);

  return {
    level: level ?? "simple",
    language: language ?? "en",
    source: resolved.source,
  };
}

/**
 * Derive a stable slug from a project path. Uses the basename, lowercased.
 */
export function slugFromPath(path: string): string {
  return basename(path).toLowerCase();
}

export interface RegistryEntry {
  slug: string;
  root: string;
  exists: boolean;
}

/**
 * Validate the registry from a config and disambiguate duplicate basenames.
 * Paths that do not exist on disk are included with `exists: false` so the
 * UI can offer to remove them; nothing is auto-pruned.
 */
export function resolveRegistry(projects: string[]): RegistryEntry[] {
  const slugCounts = new Map<string, number>();
  const entries: RegistryEntry[] = [];

  for (const path of projects) {
    const baseSlug = slugFromPath(path);
    const count = (slugCounts.get(baseSlug) ?? 0) + 1;
    slugCounts.set(baseSlug, count);
    const slug = count === 1 ? baseSlug : `${baseSlug}-${count}`;
    entries.push({ slug, root: path, exists: existsSync(path) });
  }

  return entries;
}

/**
 * Append a project path to the registry in profile.yaml. Creates profile.yaml
 * by copying profile.yaml.example if it does not exist. Idempotent: if the
 * path is already in the registry, this is a no-op.
 *
 * Returns the resolved RegistryEntry list after the operation.
 */
export function addProject(frameworkRoot: string, projectPath: string): RegistryEntry[] {
  if (!isAbsolute(projectPath)) {
    throw new Error(`addProject: path must be absolute, got "${projectPath}"`);
  }

  const userPath = join(frameworkRoot, "profile.yaml");
  const examplePath = join(frameworkRoot, "profile.yaml.example");

  if (!existsSync(userPath)) {
    if (!existsSync(examplePath)) {
      throw new Error(`addProject: neither profile.yaml nor profile.yaml.example found at ${frameworkRoot}`);
    }
    writeFileSync(userPath, readFileSync(examplePath, "utf8"), "utf8");
  }

  const raw = readFileSync(userPath, "utf8");
  const doc = YAML.parseDocument(raw);
  const dashboard = doc.get("dashboard") as YAML.YAMLMap | undefined;
  if (!dashboard) {
    doc.set("dashboard", doc.createNode({ projects: [projectPath] }));
  } else {
    const existing = dashboard.get("projects");
    let list: string[] = [];
    if (existing instanceof YAML.YAMLSeq) {
      list = existing.items
        .map((item) => (YAML.isScalar(item) ? String(item.value) : null))
        .filter((v): v is string => typeof v === "string");
    } else if (Array.isArray(existing)) {
      list = (existing as unknown[]).filter((v): v is string => typeof v === "string");
    }
    if (!list.includes(projectPath)) {
      list.push(projectPath);
    }
    dashboard.set("projects", doc.createNode(list));
  }

  writeFileSync(userPath, doc.toString(), "utf8");
  const { config } = loadProfile(frameworkRoot);
  return resolveRegistry(config.projects);
}

/**
 * Remove a project from the registry by slug or by absolute path.
 * Returns the resolved RegistryEntry list after the operation.
 */
export function removeProject(frameworkRoot: string, slugOrPath: string): RegistryEntry[] {
  const userPath = join(frameworkRoot, "profile.yaml");
  if (!existsSync(userPath)) {
    return [];
  }

  const raw = readFileSync(userPath, "utf8");
  const doc = YAML.parseDocument(raw);
  const dashboard = doc.get("dashboard") as YAML.YAMLMap | undefined;
  if (!dashboard) return [];

  const existing = dashboard.get("projects");
  let list: string[] = [];
  if (existing instanceof YAML.YAMLSeq) {
    list = existing.items
      .map((item) => (YAML.isScalar(item) ? String(item.value) : null))
      .filter((v): v is string => typeof v === "string");
  }

  const before = list.length;
  list = list.filter((path) => {
    if (path === slugOrPath) return false;
    if (slugFromPath(path) === slugOrPath.toLowerCase()) return false;
    return true;
  });

  if (list.length !== before) {
    dashboard.set("projects", doc.createNode(list));
    writeFileSync(userPath, doc.toString(), "utf8");
  }

  const { config } = loadProfile(frameworkRoot);
  return resolveRegistry(config.projects);
}

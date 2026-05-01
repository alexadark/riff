import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join, dirname } from "node:path";
import YAML from "yaml";

export type DashboardLevel = "technical" | "simple" | "eli5";
export type DashboardLanguage = "en" | "fr" | "other";

export interface DashboardConfig {
  level: DashboardLevel;
  language: DashboardLanguage;
  projects: string[];
}

export interface Profile {
  user?: {
    conversational_language?: string;
    artifact_language?: string;
    [key: string]: unknown;
  };
  style?: {
    explanation_level?: string;
    terminal_explanation_level?: string;
    [key: string]: unknown;
  };
  dashboard?: Partial<DashboardConfig>;
  [key: string]: unknown;
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

function safeReadYaml(path: string): Profile | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Profile;
    }
    return null;
  } catch (err) {
    console.warn(`[profile] failed to parse ${path}:`, (err as Error).message);
    return null;
  }
}

function normalizeLevel(value: unknown): DashboardLevel {
  if (value === "technical" || value === "simple" || value === "eli5") return value;
  return "simple";
}

function normalizeLanguage(value: unknown): DashboardLanguage {
  if (value === "en" || value === "fr" || value === "other") return value;
  return "en";
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
 * Resolve dashboard config from the framework profile.
 *
 * Order of precedence:
 *   1. profile.yaml at framework_root (user-edited).
 *   2. profile.yaml.example at framework_root (committed defaults).
 *   3. Hardcoded fallback: { level: "simple", language: "en", projects: [] }.
 *
 * The `projects` array always comes from profile.yaml only (never from the
 * example), since it is machine-specific and per-user.
 */
export function loadProfile(frameworkRoot: string): { profile: Profile; config: DashboardConfig } {
  const userPath = join(frameworkRoot, "profile.yaml");
  const examplePath = join(frameworkRoot, "profile.yaml.example");

  const userProfile = safeReadYaml(userPath);
  const exampleProfile = safeReadYaml(examplePath);
  const profile = userProfile ?? exampleProfile ?? {};

  const dashSection = profile.dashboard ?? {};
  const styleSection = profile.style ?? {};
  const convoLang = profile.user?.conversational_language;
  const fallbackLang: DashboardLanguage = convoLang === "fr" ? "fr" : "en";

  // Registry comes only from the user profile, never the example.
  const projects = normalizeProjects(userProfile?.dashboard?.projects);

  // Level resolution order: style.explanation_level (canonical) → dashboard.level (legacy) → "simple".
  const rawLevel = styleSection.explanation_level ?? dashSection.level;

  const config: DashboardConfig = {
    level: normalizeLevel(rawLevel),
    language: dashSection.language === undefined ? fallbackLang : normalizeLanguage(dashSection.language),
    projects,
  };

  return { profile, config };
}

/**
 * Derive a stable slug from a project path. Uses the basename, lowercased.
 * Two projects with the same basename are disambiguated by the caller (see
 * resolveRegistry below).
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
    doc.set(
      "dashboard",
      doc.createNode({ level: "simple", language: "en", projects: [projectPath] }),
    );
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

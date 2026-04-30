import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import YAML from "yaml";

export type DashboardLevel = "technical" | "simple" | "eli5";
export type DashboardLanguage = "en" | "fr" | "other";

export interface DashboardConfig {
  level: DashboardLevel;
  language: DashboardLanguage;
}

export interface Profile {
  user?: {
    conversational_language?: string;
    artifact_language?: string;
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
  // Safety bound: 20 levels max.
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

/**
 * Resolve dashboard config from the framework profile.
 *
 * Order of precedence:
 *   1. profile.yaml at framework_root (user-edited).
 *   2. profile.yaml.example at framework_root (committed defaults).
 *   3. Hardcoded fallback: { level: "simple", language: "en" } (or "fr" if user.conversational_language=fr).
 */
export function loadProfile(frameworkRoot: string): { profile: Profile; config: DashboardConfig } {
  const userPath = join(frameworkRoot, "profile.yaml");
  const examplePath = join(frameworkRoot, "profile.yaml.example");

  const profile = safeReadYaml(userPath) ?? safeReadYaml(examplePath) ?? {};

  const dashSection = profile.dashboard ?? {};
  const convoLang = profile.user?.conversational_language;
  const fallbackLang: DashboardLanguage = convoLang === "fr" ? "fr" : "en";

  const config: DashboardConfig = {
    level: normalizeLevel(dashSection.level),
    language: dashSection.language === undefined ? fallbackLang : normalizeLanguage(dashSection.language),
  };

  return { profile, config };
}

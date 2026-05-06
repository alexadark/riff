import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import YAML from "yaml";

/**
 * Loose Profile shape. Keys mirror profile.yaml.example. All sections
 * optional so the type accepts partial overrides and the neutre fallback.
 */
export interface Profile {
  user?: {
    conversational_language?: string;
    artifact_language?: string;
    narrative_language?: string;
    [key: string]: unknown;
  };
  style?: {
    explanation_level?: string;
    terminal_explanation_level?: string;
    [key: string]: unknown;
  };
  dashboard?: {
    projects?: unknown;
    level?: string;
    language?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export type ProfileSource = "project" | "framework" | "neutre";

export interface ResolveOptions {
  /** Absolute path to a project root. When provided, .planning/profile.yaml is checked first. */
  projectRoot?: string;
  /** Absolute path to the framework root (the directory containing profile.yaml.example). */
  frameworkRoot: string;
}

export interface ResolvedProfile {
  profile: Profile;
  source: ProfileSource;
  /** Absolute path of the file that supplied the profile, or null if the resolver fell back to an empty object. */
  path: string | null;
}

function readYaml(path: string): Profile | null {
  try {
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const parsed = YAML.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Profile;
    }
    return null;
  } catch (err) {
    console.warn(`[resolve-profile] failed to parse ${path}:`, (err as Error).message);
    return null;
  }
}

/**
 * Resolve the profile for a given project, full-replace style.
 *
 * Chain (first hit wins, no field-by-field merge):
 *   1. <projectRoot>/.planning/profile.yaml  — when projectRoot is provided
 *   2. <frameworkRoot>/profile.yaml          — global default
 *   3. <frameworkRoot>/templates/profile.neutre.yaml — canonical baseline
 *
 * If none of the three files parse to an object, returns an empty profile
 * with source "neutre" and path null. Callers should treat that as a
 * broken install (the neutre template ships with the framework).
 *
 * Mirrors the behavior of lib/resolve-profile.sh — both helpers must
 * produce identical merged output for identical inputs.
 */
export function resolveProfile(opts: ResolveOptions): ResolvedProfile {
  const { projectRoot, frameworkRoot } = opts;

  if (projectRoot) {
    const projectPath = join(projectRoot, ".planning", "profile.yaml");
    const projectProfile = readYaml(projectPath);
    if (projectProfile) {
      console.log(`[resolve-profile] source: project (${projectPath})`);
      return { profile: projectProfile, source: "project", path: projectPath };
    }
  }

  const frameworkPath = join(frameworkRoot, "profile.yaml");
  const frameworkProfile = readYaml(frameworkPath);
  if (frameworkProfile) {
    console.log(`[resolve-profile] source: framework (${frameworkPath})`);
    return { profile: frameworkProfile, source: "framework", path: frameworkPath };
  }

  const neutrePath = join(frameworkRoot, "templates", "profile.neutre.yaml");
  const neutreProfile = readYaml(neutrePath);
  if (neutreProfile) {
    console.log(`[resolve-profile] source: neutre (${neutrePath})`);
    return { profile: neutreProfile, source: "neutre", path: neutrePath };
  }

  console.warn("[resolve-profile] no profile found — returning empty object");
  return { profile: {}, source: "neutre", path: null };
}

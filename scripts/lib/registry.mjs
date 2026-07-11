// Project registry resolution, shared by riff-pending.mjs and
// riff-conductor.mjs: profile.yaml -> dashboard.projects, with a --registry
// file override for tests and inode-based dedup (the profile may list the
// same project twice under different path casings; on a case-insensitive
// filesystem both resolve to one inode).
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

function stripComment(line) {
  return line.replace(/\s+#.*$/, '').trimEnd();
}

function unquote(value) {
  return value.trim().replace(/^["']|["']$/g, '');
}

/** The active profile: user profile.yaml, else the default template. */
export function profileFile(frameworkRoot) {
  const userProfile = path.join(frameworkRoot, 'profile.yaml');
  if (existsSync(userProfile)) return userProfile;
  return path.join(frameworkRoot, 'templates/profile.default.yaml');
}

/** Parse the `dashboard: projects:` list out of profile.yaml text. */
export function parseDashboardProjects(text) {
  const lines = text.split(/\r?\n/);
  let dashboardIndent;
  let projectsIndent;
  const projects = [];

  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    const trimmed = line.trim();

    if (dashboardIndent === undefined) {
      if (/^dashboard:\s*$/.test(trimmed)) dashboardIndent = indent;
      continue;
    }

    if (indent <= dashboardIndent && /^[A-Za-z_][A-Za-z0-9_]*:/.test(trimmed)) break;

    if (projectsIndent === undefined) {
      const match = trimmed.match(/^projects:\s*(\[\])?\s*$/);
      if (match) {
        projectsIndent = indent;
        if (match[1]) break;
      }
      continue;
    }

    if (indent <= projectsIndent && /^[A-Za-z_][A-Za-z0-9_]*:/.test(trimmed)) break;
    if (indent <= projectsIndent) continue;

    const match = trimmed.match(/^-\s+(.+?)\s*$/);
    if (match) projects.push(unquote(match[1]));
  }

  return projects;
}

/** One project path per line; blank lines and `#` comments ignored. */
export function parseRegistryFile(file, { onWarn } = {}) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    onWarn?.(`could not read ${file}: ${error.message}`);
    return [];
  }
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));
}

/**
 * Collapse registry entries that point at the same directory (same
 * dev:inode). Missing directories keep their raw path as the key so the
 * caller can still warn about them.
 */
export function dedupeByInode(paths) {
  const seen = new Set();
  const unique = [];
  for (const projectPath of paths) {
    let key = projectPath;
    try {
      const stats = statSync(projectPath);
      key = `${stats.dev}:${stats.ino}`;
    } catch {
      // missing dirs keep their raw path as key; callers warn about them
    }
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(projectPath);
  }
  return unique;
}

/**
 * Resolve the project registry: explicit registry file when given, else the
 * dashboard.projects list of the active profile. Deduped by inode.
 */
export function registryProjects({ frameworkRoot, registry, onWarn } = {}) {
  if (registry) return dedupeByInode(parseRegistryFile(registry, { onWarn }));
  let text;
  const file = profileFile(frameworkRoot);
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    onWarn?.(`could not read ${file}: ${error.message}`);
    return [];
  }
  return dedupeByInode(parseDashboardProjects(text));
}

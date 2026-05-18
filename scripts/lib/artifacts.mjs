import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export function toPosix(filePath) {
  return filePath.split(path.sep).join('/');
}

export function normalizePhase(input) {
  const normalized = input.replace(/\/$/, '');
  if (normalized.includes('/')) {
    return {
      id: path.basename(normalized),
      dir: toPosix(normalized),
    };
  }
  return {
    id: normalized,
    dir: toPosix(path.join('.planning', 'phases', normalized)),
  };
}

export function absolutePath(root, relativePath) {
  return path.resolve(root, relativePath);
}

export function readText(root, relativePath) {
  return readFileSync(absolutePath(root, relativePath), 'utf8');
}

export function readIfExists(root, relativePath) {
  const filePath = absolutePath(root, relativePath);
  if (!existsSync(filePath)) {
    return {
      exists: false,
      text: '',
    };
  }
  return {
    exists: true,
    text: readFileSync(filePath, 'utf8'),
  };
}

export function readJsonIfExists(root, relativePath) {
  const artifact = readIfExists(root, relativePath);
  if (!artifact.exists) {
    return {
      exists: false,
      value: undefined,
      error: undefined,
    };
  }
  try {
    return {
      exists: true,
      value: JSON.parse(artifact.text),
      error: undefined,
    };
  } catch (error) {
    return {
      exists: true,
      value: undefined,
      error,
    };
  }
}

export function ensureDir(root, relativePath) {
  mkdirSync(absolutePath(root, relativePath), { recursive: true });
}

export function writeText(root, relativePath, text) {
  const filePath = absolutePath(root, relativePath);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

export function writeJson(root, relativePath, value) {
  writeText(root, relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

export function detectScope(root, explicitScope) {
  if (explicitScope) return explicitScope;
  const config = readJsonIfExists(root, '.planning/config.json');
  if (!config.exists || config.error) return 'production';
  return config.value?.scope === 'scratch' ? 'scratch' : 'production';
}

export function artifactPath(phaseDir, fileName) {
  return toPosix(path.join(phaseDir, fileName));
}

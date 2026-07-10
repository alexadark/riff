#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const ciMode = argv.includes('--ci') || process.env.CI === 'true';

const FINDING_LEVELS = {
  error: 'error',
  warn: 'warn',
};

const findings = [];

function addFinding(level, file, line, message) {
  findings.push({ level, file, line, message });
}

function rel(file) {
  return path.relative(frameworkRoot, file).replaceAll(path.sep, '/');
}

function readText(file) {
  return readFileSync(path.join(frameworkRoot, file), 'utf8');
}

function listTrackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], {
      cwd: frameworkRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).split('\n').filter(Boolean);
  } catch {
    const ignoredDirs = new Set(['.git', 'node_modules', 'dashboard/node_modules']);
    const files = [];
    function walk(dir) {
      for (const entry of readdirSync(path.join(frameworkRoot, dir), { withFileTypes: true })) {
        const child = dir ? `${dir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          if (!ignoredDirs.has(child) && !ignoredDirs.has(entry.name)) walk(child);
        } else {
          files.push(child);
        }
      }
    }
    walk('');
    return files;
  }
}

function normalizeDocPath(raw) {
  return raw
    .replace(/^\.riff\//, '')
    .replace(/^\.\//, '')
    .replace(/^(\.\.\/)+/, '')
    .replace(/[)\],.;:]+$/g, '');
}

function targetExists(rawPath) {
  const normalized = normalizeDocPath(rawPath);
  const abs = path.join(frameworkRoot, normalized);
  if (existsSync(abs)) return true;
  const parsed = path.parse(abs);
  if (!parsed.ext && existsSync(parsed.dir)) {
    return readdirSync(parsed.dir).some((entry) => entry.startsWith(`${parsed.name}.`));
  }
  return false;
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length;
}

function markdownFiles(files) {
  return files.filter((file) => file.endsWith('.md'));
}

function headingSlug(value) {
  return value
    .toLowerCase()
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

const headingCache = new Map();
function headingsFor(file) {
  const normalized = normalizeDocPath(file);
  if (headingCache.has(normalized)) return headingCache.get(normalized);
  if (!targetExists(normalized)) return new Set();
  const headings = new Set();
  for (const line of readText(normalized).split(/\r?\n/)) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) headings.add(headingSlug(match[2]));
  }
  headingCache.set(normalized, headings);
  return headings;
}

function sectionExists(file, section) {
  const sectionSlug = headingSlug(section);
  if (!sectionSlug) return true;
  const headings = headingsFor(file);
  if (headings.has(sectionSlug)) return true;
  for (const heading of headings) {
    if (heading.includes(sectionSlug) || sectionSlug.includes(heading)) return true;
  }
  return false;
}

function extractFrameworkPaths(line) {
  const pathPattern = /(?:\.riff\/|\.\.\/|\.[/])?(?:protocols\/[A-Za-z0-9._/-]+\.md|references\/[A-Za-z0-9._/-]+\.md|agents\/[A-Za-z0-9._/-]+\.md|templates\/[A-Za-z0-9._/-]+(?:\.md|\.ya?ml|\.json|\.ts|\.tsx|\.mjs|\.sh)?)/g;
  return [...line.matchAll(pathPattern)].map((match) => ({
    raw: match[0],
    index: match.index ?? 0,
  }));
}

function extractMarkdownPaths(line) {
  const pathPattern = /(?:\.riff\/|\.\.\/|\.[/])?[A-Za-z0-9._/-]+\.md/g;
  return [...line.matchAll(pathPattern)].map((match) => ({
    raw: match[0],
    index: match.index ?? 0,
  }));
}

function checkScriptCitations(files) {
  const projectContext = /^(commands|protocols)\//;
  for (const file of markdownFiles(files)) {
    const text = readText(file);
    const citationPattern = /(?:\.riff\/)?scripts\/[A-Za-z0-9._-]+\.(?:mjs|sh)\b/g;
    for (const match of text.matchAll(citationPattern)) {
      const rawPath = match[0];
      const line = lineNumber(text, match.index ?? 0);
      const normalized = normalizeDocPath(rawPath);
      if (!existsSync(path.join(frameworkRoot, normalized))) {
        addFinding(FINDING_LEVELS.error, file, line, `Missing script path: ${rawPath}`);
      }
      if ((projectContext.test(file) || file === 'CLAUDE.md') && !rawPath.startsWith('.riff/')) {
        addFinding(FINDING_LEVELS.error, file, line, `Project-context script path must use .riff/ prefix: ${rawPath}`);
      }
    }
  }
}

function checkFrameworkPathCitations(files) {
  for (const file of markdownFiles(files)) {
    const lines = readText(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const citation of extractFrameworkPaths(line)) {
        const precedingText = line.slice(0, citation.index);
        if (/\.claude\//.test(precedingText) || /\.claude\//.test(citation.raw)) continue;
        if (!targetExists(citation.raw)) {
          addFinding(FINDING_LEVELS.error, file, index + 1, `Missing referenced path: ${citation.raw}`);
        }
      }
    });
  }
}

function sectionTextAfterMarker(line, markerIndex) {
  const raw = line.slice(markerIndex + 1).trim();
  const withoutLink = raw
    .replace(/^\[[^\]]+\]\([^)]+\)\s*/, '')
    .replace(/^`([^`]+)`/, '$1');
  return withoutLink
    .split(/\s+(?:and|or)\s+`?[\w./-]+\.(?:md|yaml|json)`?\s+§\s+/i)[0]
    .split(/\s+[A-Za-z0-9._/-]+\.md\s+§\s+/i)[0]
    // Cut trailing prose bleed: a heading anchor ends at the first clause break.
    .replace(/\s*[—|].*$/, '') // em-dash / pipe clause
    .replace(/\s*\(.*$/, '') // parenthetical bleed
    .replace(/\)\s.*$/, '') // prose after a closing paren
    .replace(/`.*$/, '') // trailing backtick prose
    .replace(/[,;:]\s.*$/, '') // comma / semicolon / colon clause
    .replace(/\.(?=\s|$).*$/, '') // sentence bleed (period at a word boundary)
    .replace(/\s+(?:below|above)\b.*$/i, '')
    .replace(/\s+(?:if|when|so|to|from|with|that|and)\b.*$/i, '')
    .replace(/[).:|]+$/g, '')
    .trim();
}

function checkSectionReferences(files) {
  for (const file of markdownFiles(files)) {
    const lines = readText(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      let searchFrom = 0;
      while (true) {
        const markerIndex = line.indexOf('§', searchFrom);
        if (markerIndex === -1) break;
        searchFrom = markerIndex + 1;

        // A `§` right after a non-markdown file (profile.yaml § wave.executor) is a
        // config-key path, not a doc heading. Only markdown files have § sections.
        if (/[A-Za-z0-9._/-]+\.(?:ya?ml|json)\s*$/.test(line.slice(0, markerIndex))) continue;

        const section = sectionTextAfterMarker(line, markerIndex);
        if (!section) continue;
        const candidatePaths = extractMarkdownPaths(line.slice(0, markerIndex));
        const target = candidatePaths.length > 0
          ? candidatePaths[candidatePaths.length - 1].raw
          : file;
        if (!targetExists(target)) continue;
        if (!sectionExists(target, section)) {
          addFinding(FINDING_LEVELS.warn, file, index + 1, `Section not found: ${normalizeDocPath(target)} § ${section}`);
        }
      }
    });
  }
}

function flattenYamlLikeFields(text) {
  const fields = new Set();
  const stack = [];
  for (const rawLine of text.split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith('#')) continue;
    const match = rawLine.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*):/);
    if (!match) continue;
    const indent = match[1].length;
    const key = match[2];
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack.length ? `${stack[stack.length - 1].path}.` : '';
    const field = `${parent}${key}`;
    fields.add(field);
    stack.push({ indent, path: field });
  }
  return fields;
}

function knownProfileFields() {
  const schema = readText('references/PROFILE-SCHEMA.md');
  const schemaBlock = schema.match(/```yaml\n([\s\S]*?)```/)?.[1] ?? '';
  const schemaFields = flattenYamlLikeFields(schemaBlock);
  const defaultFields = flattenYamlLikeFields(readText('templates/profile.default.yaml'));
  return { schemaFields, defaultFields };
}

function checkProfileReads(files) {
  const { schemaFields, defaultFields } = knownProfileFields();
  const runtimeFiles = files.filter((file) => /^(commands|protocols)\//.test(file) && file.endsWith('.md') && file !== 'commands/onboard.md');
  const fieldPattern = /`(?:profile\.)?([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)`|profile\.([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+)/g;
  for (const file of runtimeFiles) {
    const lines = readText(file).split(/\r?\n/);
    lines.forEach((line, index) => {
      if (!/profile\.yaml|profile\./.test(line)) return;
      for (const match of line.matchAll(fieldPattern)) {
        const field = match[1] ?? match[2];
        if (!field || field === 'profile.yaml') continue;
        if (field.startsWith('planning.') || field.startsWith('riff.')) continue;
        if (field.startsWith('dashboard.')) continue;
        if (/\.(md|yaml|yml|mjs|sh|js|ts|json)$/.test(field)) continue;
        if (!schemaFields.has(field)) {
          addFinding(FINDING_LEVELS.error, file, index + 1, `Profile field missing from references/PROFILE-SCHEMA.md: ${field}`);
        }
        if (!defaultFields.has(field)) {
          addFinding(FINDING_LEVELS.error, file, index + 1, `Profile field missing from templates/profile.default.yaml: ${field}`);
        }
      }
    });
  }
}

function yamlScalar(text, section, key) {
  let inSection = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, '');
    if (new RegExp(`^${section}:\\s*$`).test(line)) {
      inSection = true;
      continue;
    }
    if (inSection && /^[A-Za-z_][A-Za-z0-9_]*:/.test(line)) return undefined;
    const match = inSection ? line.match(new RegExp(`^\\s+${key}:\\s*([^#]+?)\\s*$`)) : undefined;
    if (match) return match[1].replace(/^["']|["']$/g, '').trim();
  }
  return undefined;
}

function commandFrontmatterModel(file) {
  const lines = readText(file).split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return undefined;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === '---') break;
    const match = line.match(/^model:\s*([^\s#]+)/);
    if (match) return match[1].trim();
  }
  return undefined;
}

function checkCommandModelMirrors() {
  const profileFile = existsSync(path.join(frameworkRoot, 'profile.yaml'))
    ? 'profile.yaml'
    : 'templates/profile.default.yaml';
  const reasoningModel = yamlScalar(readText(profileFile), 'models', 'reasoning');
  if (!reasoningModel) return;

  for (const file of ['commands/next.md', 'commands/start.md', 'commands/wave.md']) {
    if (!targetExists(file)) continue;
    const frontmatterModel = commandFrontmatterModel(file);
    if (frontmatterModel && frontmatterModel !== reasoningModel) {
      addFinding(
        FINDING_LEVELS.warn,
        file,
        4,
        `Command model frontmatter '${frontmatterModel}' differs from ${profileFile} models.reasoning '${reasoningModel}'`,
      );
    }
  }
}

function main() {
  const files = listTrackedFiles()
    .filter((file) => existsSync(path.join(frameworkRoot, file)))
    .filter((file) => {
      try {
        return statSync(path.join(frameworkRoot, file)).isFile();
      } catch {
        return false;
      }
    });

  checkScriptCitations(files);
  checkFrameworkPathCitations(files);
  checkSectionReferences(files);
  checkProfileReads(files);
  checkCommandModelMirrors();

  const errors = findings.filter((finding) => finding.level === FINDING_LEVELS.error);
  if (findings.length === 0) {
    process.stdout.write('riff doctor: PASS\n');
    return;
  }

  process.stdout.write(`riff doctor: ${errors.length} error(s), ${findings.length - errors.length} warning(s)\n`);
  for (const finding of findings) {
    process.stdout.write(`${finding.level.toUpperCase()} ${finding.file}:${finding.line}: ${finding.message}\n`);
  }

  if (ciMode && errors.length > 0) {
    process.exit(1);
  }
}

main();

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Markdown artifact parsing lives here so scope-check and the native runner
 * cannot silently disagree about PLAN, SUMMARY, or REVIEW semantics.
 */

export function linesWithNumbers(text) {
  return String(text ?? '').split(/\r?\n/).map((textLine, index) => ({ text: textLine, line: index + 1 }));
}

export function headingLevel(line) {
  const match = String(line).match(/^(#{1,6})\s+/);
  return match ? match[1].length : 0;
}

export function stripMarkdown(value) {
  return String(value ?? '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\[[ xX]\]\s*/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .trim();
}

const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'be', 'by', 'do', 'for', 'from', 'in', 'into',
  'is', 'it', 'of', 'on', 'or', 'per', 'the', 'to', 'with', 'task', 'phase',
  'add', 'update', 'create', 'remove', 'fix', 'wire', 'ensure', 'implement',
]);

export function normalize(value) {
  return stripMarkdown(value)
    .toLowerCase()
    .replace(/^task\s*[\w.-]*\s*:?\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function tokens(value) {
  return normalize(value).split(' ').filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

export function section(lines, headingPattern) {
  const start = lines.findIndex(({ text }) => headingPattern.test(text));
  if (start === -1) return { exists: false, lines: [] };
  const level = headingLevel(lines[start].text);
  const body = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const currentLevel = headingLevel(lines[index].text);
    if (currentLevel > 0 && currentLevel <= level) break;
    body.push(lines[index]);
  }
  return { exists: true, lines: body };
}

function groupHeaderTaskIds(headingText) {
  if (!/^\s*wave\s*\d/i.test(stripMarkdown(headingText))) return null;
  const ids = stripMarkdown(headingText).match(/\b\d{1,3}-\d{1,3}[a-z]?\b/gi) || [];
  return ids.map((id) => id.toLowerCase());
}

export function parsePlannedTasks(planText) {
  const lines = linesWithNumbers(planText);
  const taskSection = section(lines, /^##\s+Tasks\b/i);
  let source;
  let wholeDoc = false;
  if (taskSection.exists) {
    source = taskSection.lines;
  } else {
    const waveSection = section(lines, /^##\s+(Waves?|Steps)\s*$/i);
    if (waveSection.exists) source = waveSection.lines;
    else { source = lines; wholeDoc = true; }
  }
  const tasks = [];
  for (const entry of source) {
    const heading = entry.text.match(/^#{2,6}\s+(.+?)\s*$/);
    if (heading) {
      const groupIds = groupHeaderTaskIds(heading[1]);
      if (groupIds) {
        for (const id of groupIds) {
          const normalizedId = normalize(id);
          if (normalizedId) tasks.push({ id: normalizedId, source_line: entry.line });
        }
        continue;
      }
      if (headingLevel(entry.text) < 3) continue;
      const id = normalize(heading[1]);
      if (id) tasks.push({ id, source_line: entry.line });
      continue;
    }
    if (wholeDoc) continue;
    const boldTask = entry.text.match(/^\s*\*\*\s*(\d{1,3}-\d{1,3}[a-z]?\b.*?)\s*\*\*\s*$/);
    if (boldTask) {
      const id = normalize(boldTask[1]);
      if (id) tasks.push({ id, source_line: entry.line });
      continue;
    }
    const checked = entry.text.match(/^\s*[-*]\s+\[[ xX]\]\s+(.+?)\s*$/);
    if (checked) {
      const id = normalize(checked[1]);
      if (id) tasks.push({ id, source_line: entry.line });
      continue;
    }
    const numbered = entry.text.match(/^\s*\d+[.)]\s+(.+?)\s*$/);
    if (numbered) {
      const id = normalize(numbered[1]);
      if (id) tasks.push({ id, source_line: entry.line });
    }
  }
  const seen = new Set();
  const deduped = tasks.filter((task) => {
    if (seen.has(task.id)) return false;
    seen.add(task.id);
    return true;
  });
  return deduped.filter((task) => {
    if (!/^\d{1,3} \d{1,3}[a-z]?$/.test(task.id)) return true;
    const prefix = `${task.id} `;
    return !deduped.some((other) => other !== task && other.id.startsWith(prefix));
  });
}

function skipJsonWhitespace(text, index) {
  let cursor = index;
  while (cursor < text.length && /\s/.test(text[cursor])) cursor += 1;
  return cursor;
}

function scanJsonString(text, start) {
  if (text[start] !== '"') return undefined;
  let cursor = start + 1;
  let escaped = false;
  while (cursor < text.length) {
    const character = text[cursor];
    if (escaped) {
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '"') {
      const raw = text.slice(start, cursor + 1);
      try { return { end: cursor + 1, value: JSON.parse(raw) }; } catch { return undefined; }
    }
    cursor += 1;
  }
  return undefined;
}

function scanJsonValueEnd(text, start) {
  if (text[start] === '"') return scanJsonString(text, start)?.end;
  if (text[start] !== '{' && text[start] !== '[') {
    let cursor = start;
    while (cursor < text.length && !/[\s,}]/.test(text[cursor])) cursor += 1;
    return cursor > start ? cursor : undefined;
  }
  const stack = [text[start] === '{' ? '}' : ']'];
  let cursor = start + 1;
  while (cursor < text.length && stack.length) {
    const character = text[cursor];
    if (character === '"') {
      const string = scanJsonString(text, cursor);
      if (!string) return undefined;
      cursor = string.end;
      continue;
    }
    if (character === '{') stack.push('}');
    else if (character === '[') stack.push(']');
    else if (character === '}' || character === ']') {
      if (stack.at(-1) !== character) return undefined;
      stack.pop();
    }
    cursor += 1;
  }
  return stack.length === 0 ? cursor : undefined;
}

function hasDuplicateTopLevelJsonKeys(text) {
  let cursor = skipJsonWhitespace(text, 0);
  if (text[cursor] !== '{') return false;
  cursor = skipJsonWhitespace(text, cursor + 1);
  const seen = new Set();
  while (cursor < text.length && text[cursor] !== '}') {
    const key = scanJsonString(text, cursor);
    if (!key) return false;
    if (seen.has(key.value)) return true;
    seen.add(key.value);
    cursor = skipJsonWhitespace(text, key.end);
    if (text[cursor] !== ':') return false;
    cursor = skipJsonWhitespace(text, cursor + 1);
    const valueEnd = scanJsonValueEnd(text, cursor);
    if (valueEnd === undefined) return false;
    cursor = skipJsonWhitespace(text, valueEnd);
    if (text[cursor] === ',') cursor = skipJsonWhitespace(text, cursor + 1);
    else if (text[cursor] !== '}') return false;
  }
  return false;
}

function topLevelJsonValueText(text, propertyName) {
  let cursor = skipJsonWhitespace(text, 0);
  if (text[cursor] !== '{') return undefined;
  cursor = skipJsonWhitespace(text, cursor + 1);
  while (cursor < text.length && text[cursor] !== '}') {
    const key = scanJsonString(text, cursor);
    if (!key) return undefined;
    cursor = skipJsonWhitespace(text, key.end);
    if (text[cursor] !== ':') return undefined;
    const valueStart = skipJsonWhitespace(text, cursor + 1);
    const valueEnd = scanJsonValueEnd(text, valueStart);
    if (valueEnd === undefined) return undefined;
    if (key.value === propertyName) return text.slice(valueStart, valueEnd);
    cursor = skipJsonWhitespace(text, valueEnd);
    if (text[cursor] === ',') cursor = skipJsonWhitespace(text, cursor + 1);
    else if (text[cursor] !== '}') return undefined;
  }
  return undefined;
}

const NATIVE_TASK_HEADING = /^### Task ([1-9][0-9]*): ([^\s].*?)\s*$/;
const NATIVE_RESERVED_SECTION_PATTERNS = Object.freeze({
  Tasks: /^##\s+Tasks\s*$/i,
  Waves: /^##\s+Waves\s*$/i,
  Identity: /^##\s+Identity\s*$/i,
  Boundaries: /^##\s+Boundaries\s*$/i,
  Smoke: /^##\s+Smoke\s*$/i,
});
const NATIVE_META_TASK_PATTERNS = Object.freeze([
  /\b(?:riff\s+)?gates?\b/i,
  /\bscope[-\s]+checks?\b/i,
  /\b(?:base|head|worktree)\b.{0,32}\bsnapshots?\b/i,
  /\b(?:capture|compare|create|record|refresh|take)\b.{0,32}\bsnapshots?\b/i,
  /\bsmoke\s+orchestrat(?:e|ed|es|ing|ion)\b/i,
  /\borchestrat(?:e|ed|es|ing|ion)\b.{0,32}\bsmoke\b/i,
  /\b(?:summary\s*\/\s*review|review\s*\/\s*summary)\b/i,
  /\b(?:complete|completion|finish|finali[sz]e|finali[sz]ation)\b.{0,48}\b(?:summary|review)\b/i,
  /\b(?:summary|review)\b.{0,48}\b(?:complete|completion|finish|finali[sz]e|finali[sz]ation)\b/i,
  /\bpromot(?:e|ed|es|ing|ion)\b/i,
  /\b(?:runner|orchestrator)\s+(?:owned\s+)?(?:state|artifact|metadata)\b/i,
  /(?:^|[^A-Za-z0-9_])\.planning\b/i,
]);
const NATIVE_PROMPT_INJECTION_PATTERNS = Object.freeze([
  { label: 'ignore previous instructions', pattern: /\bignore\s+(?:all\s+)?previous\s+instructions?\b/i },
  { label: 'return verdict instruction', pattern: /\breturn\s+(?:exactly\s+)?(?:PROCEED|REVISE|PASS|FAIL)\b/i },
  { label: 'reviewer role instruction', pattern: /\breviewer\s+must\b/i },
  { label: 'assistant role instruction', pattern: /\bassistant\s+must\b/i },
]);

function normalizeDeclaredPath(value) {
  const normalized = String(value ?? '').replaceAll('\\', '/').trim().replace(/^\.\//, '').replace(/\/+$/, '');
  if (!normalized || normalized === '.') return undefined;
  return normalized;
}

function pathWithinBoundary(candidate, boundary) {
  const item = normalizeDeclaredPath(candidate);
  const allowed = normalizeDeclaredPath(boundary);
  if (!item || !allowed || path.isAbsolute(item) || path.isAbsolute(allowed)
    || item.split('/').includes('..') || allowed.split('/').includes('..')) return false;
  return item === allowed || item.startsWith(`${allowed}/`);
}

function taskOwnedPaths(body, allowedPaths) {
  const lines = String(body ?? '').split(/\r?\n/);
  const declarations = lines.map((line, index) => ({ line: index + 1, match: line.match(/^Owned paths:\s*(\[[^\n]*\])\s*$/) })).filter(({ match }) => match);
  if (declarations.length !== 1) {
    return { paths: [], errors: ['must contain exactly one `Owned paths: ["path"]` declaration'] };
  }
  let decoded;
  try { decoded = JSON.parse(declarations[0].match[1]); } catch { decoded = undefined; }
  if (!Array.isArray(decoded) || decoded.length === 0 || decoded.some((value) => typeof value !== 'string')) {
    return { paths: [], errors: ['has a malformed Owned paths JSON array'] };
  }
  const paths = decoded.map(normalizeDeclaredPath);
  const errors = [];
  if (paths.some((candidate) => !candidate || path.isAbsolute(candidate) || candidate.split('/').includes('..'))) {
    errors.push('has an invalid Owned paths entry');
  }
  if (new Set(paths).size !== paths.length) errors.push('has duplicate Owned paths entries');
  for (const candidate of paths.filter(Boolean)) {
    if (!allowedPaths.some((allowed) => pathWithinBoundary(candidate, allowed))) {
      errors.push(`owns a path outside allowed_paths: ${candidate}`);
    }
  }
  return { paths: errors.length ? [] : [...paths].sort((left, right) => left.localeCompare(right)), errors };
}

function taskPathOverlap(left, right) {
  return left.some((candidate) => right.some((other) => pathWithinBoundary(candidate, other) || pathWithinBoundary(other, candidate)));
}

function isNativeMetaTask(task) {
  const content = `${task.title}\n${task.body || ''}`;
  return NATIVE_META_TASK_PATTERNS.some((pattern) => pattern.test(content));
}

function nativeReservedSectionErrors(planText) {
  const lines = linesWithNumbers(planText);
  const errors = [];
  for (const [name, pattern] of Object.entries(NATIVE_RESERVED_SECTION_PATTERNS)) {
    const count = lines.filter(({ text }) => pattern.test(text)).length;
    if (count !== 1) errors.push(`PLAN.md requires exactly one ## ${name} section, found ${count}`);
  }
  return errors;
}

function nativePromptInjectionErrors(planText) {
  const errors = [];
  for (const entry of linesWithNumbers(planText)) {
    for (const { label, pattern } of NATIVE_PROMPT_INJECTION_PATTERNS) {
      if (pattern.test(entry.text)) errors.push(`PLAN.md contains prompt injection text (${label}) at line ${entry.line}`);
    }
  }
  return errors;
}

function parseNativeTaskShape(planText, { enforceProductScope = false } = {}) {
  const lines = linesWithNumbers(planText);
  const taskSection = section(lines, /^##\s+Tasks\s*$/i);
  const errors = [];
  if (!taskSection.exists) {
    errors.push('PLAN.md requires an exact non-empty ## Tasks section');
    return { sectionExists: false, exact: false, tasks: [], errors };
  }
  const tasks = [];
  for (const entry of taskSection.lines) {
    if (headingLevel(entry.text) === 0) continue;
    const match = entry.text.match(NATIVE_TASK_HEADING);
    if (!match) {
      errors.push(`PLAN.md task heading at line ${entry.line} must be exactly ### Task N: <non-empty actionable title>`);
      continue;
    }
    const number = Number(match[1]);
    const title = match[2].trim();
    if (!title || !/[A-Za-z0-9]/.test(title)) {
      errors.push(`PLAN.md task heading at line ${entry.line} must have a non-empty actionable title`);
      continue;
    }
    tasks.push({
      id: normalize(title),
      number,
      title,
      label: `Task ${number}: ${title}`,
      source_line: entry.line,
      body: '',
    });
  }
  if (tasks.length === 0) errors.push('PLAN.md ## Tasks must contain at least one task heading');
  tasks.forEach((task, index) => {
    const expected = index + 1;
    if (task.number !== expected) errors.push(`PLAN.md task headings must be numbered consecutively from 1, found ${task.number} at position ${expected}`);
  });
  for (const task of tasks) {
    const headingIndex = taskSection.lines.findIndex(({ line }) => line === task.source_line);
    const body = [];
    for (let index = headingIndex + 1; index < taskSection.lines.length; index += 1) {
      const level = headingLevel(taskSection.lines[index].text);
      if (level > 0 && level <= 3) break;
      body.push(taskSection.lines[index].text);
    }
    task.body = body.join('\n').trim();
  }
  if (enforceProductScope) {
    const boundaries = parseBoundaries(planText);
    const declaredPaths = boundaries.allowed_paths.map(normalizeDeclaredPath).filter(Boolean);
    for (const task of tasks) {
      const ownership = taskOwnedPaths(task.body, declaredPaths);
      task.declared_paths = ownership.paths;
      errors.push(...ownership.errors.map((error) => `PLAN.md task at line ${task.source_line} ${error}`));
      if (isNativeMetaTask(task)) {
        errors.push(`PLAN.md task at line ${task.source_line} is dedicated to RIFF orchestration rather than a product result`);
      }
    }
  } else {
    tasks.forEach((task) => { task.declared_paths = []; });
  }
  return { sectionExists: true, exact: errors.length === 0 && tasks.length > 0, tasks, errors };
}

export function parseNativeWaves(planText, tasks = []) {
  const lines = linesWithNumbers(planText);
  const waveSection = section(lines, /^##\s+Waves\s*$/i);
  const errors = [];
  if (!waveSection.exists) return { sectionExists: false, exact: false, waves: [], errors: ['PLAN.md requires an exact non-empty ## Waves section'] };
  const known = new Map(tasks.map((task) => [task.number, task]));
  const claimed = new Set();
  const waves = [];
  for (const entry of waveSection.lines) {
    if (!entry.text.trim()) continue;
    const match = entry.text.match(/^- Wave ([1-9][0-9]*): (Task|Tasks) ([1-9][0-9]*(?:, [1-9][0-9]*)*)\.$/);
    if (!match) { errors.push(`PLAN.md wave at line ${entry.line} must be exactly - Wave N: Task X. or - Wave N: Tasks X, Y.`); continue; }
    const taskNumbers = match[3].split(', ').map(Number);
    if ((match[2] === 'Task') !== (taskNumbers.length === 1)) errors.push(`PLAN.md wave at line ${entry.line} has an invalid Task or Tasks form`);
    const waveTasks = [];
    for (const number of taskNumbers) {
      if (!known.has(number)) errors.push(`PLAN.md wave at line ${entry.line} references unknown Task ${number}`);
      else if (claimed.has(number)) errors.push(`PLAN.md wave at line ${entry.line} repeats Task ${number}`);
      else { claimed.add(number); waveTasks.push(known.get(number)); }
    }
    waves.push({ number: Number(match[1]), task_numbers: taskNumbers, tasks: waveTasks, source_line: entry.line });
  }
  if (!waves.length) errors.push('PLAN.md ## Waves must contain at least one wave');
  waves.forEach((wave, index) => { if (wave.number !== index + 1) errors.push(`PLAN.md waves must be numbered consecutively from 1, found ${wave.number} at position ${index + 1}`); });
  for (const wave of waves) {
    for (let index = 0; index < wave.tasks.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < wave.tasks.length; otherIndex += 1) {
        if (taskPathOverlap(wave.tasks[index].declared_paths || [], wave.tasks[otherIndex].declared_paths || [])) {
          errors.push(`PLAN.md Wave ${wave.number} tasks ${wave.tasks[index].number} and ${wave.tasks[otherIndex].number} have overlapping declared product paths`);
        }
      }
    }
  }
  for (const task of tasks) if (!claimed.has(task.number)) errors.push(`PLAN.md waves omit Task ${task.number}`);
  return { sectionExists: true, exact: errors.length === 0, waves, errors };
}

/** Controller output is one JSON object and nothing else. */
export function parseControllerOutput(output) {
  const text = String(output ?? '').trim();
  if (hasDuplicateTopLevelJsonKeys(text)) throw new Error('controller output has duplicate top-level keys');
  const routingText = topLevelJsonValueText(text, 'routing');
  if (routingText && hasDuplicateTopLevelJsonKeys(routingText)) throw new Error('controller routing has duplicate keys');
  let value;
  try { value = JSON.parse(text); } catch { throw new Error('controller output must be exactly one JSON object'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('controller output must be a JSON object');
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['constraints', 'reason', 'routing', 'verdict'])) throw new Error('controller output has unexpected keys');
  if (!['PROCEED', 'BLOCKED'].includes(value.verdict)) throw new Error('controller verdict must be exactly PROCEED or BLOCKED');
  if (!Array.isArray(value.constraints) || value.constraints.some((item) => typeof item !== 'string' || !item.trim())) throw new Error('controller constraints must be an array of non-empty strings');
  if (typeof value.reason !== 'string' || !value.reason.trim()) throw new Error('controller reason must be non-empty');
  if (!value.routing || typeof value.routing !== 'object' || Array.isArray(value.routing)) throw new Error('controller routing must be an object');
  const routingKeys = Object.keys(value.routing).sort();
  if (JSON.stringify(routingKeys) !== JSON.stringify(['execution', 'planning', 'review'])) throw new Error('controller routing has unexpected keys');
  if (!['routine', 'architecture'].includes(value.routing.planning)) throw new Error('controller routing planning must be routine or architecture');
  if (!['repeatable', 'bounded'].includes(value.routing.execution)) throw new Error('controller routing execution must be repeatable or bounded');
  if (!['routine', 'critical'].includes(value.routing.review)) throw new Error('controller routing review must be routine or critical');
  return { verdict: value.verdict, constraints: value.constraints, reason: value.reason, routing: value.routing };
}

function parseJsonValue(raw) {
  try { return JSON.parse(raw); } catch { return undefined; }
}

function canonicalSmokeIdentity(smoke) {
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
    }
    return value;
  };
  return JSON.stringify(canonicalize({ argv: smoke.argv, expect: smoke.expect }));
}

function smokeEntry(value, sourceLine, { nativeStrict = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (!Array.isArray(value.argv) || value.argv.length === 0 || value.argv.some((arg) => typeof arg !== 'string')) return undefined;
  const keys = Object.keys(value);
  if (nativeStrict && keys.some((key) => !['argv', 'expect'].includes(key))) return undefined;
  if (nativeStrict) {
    const expect = value.expect;
    if (!expect || typeof expect !== 'object' || Array.isArray(expect)) return undefined;
    const expectKeys = Object.keys(expect);
    if (expectKeys.some((key) => !['exit_code', 'stdout_includes'].includes(key))) return undefined;
    if (!Number.isInteger(expect.exit_code) || expect.exit_code < 0 || expect.exit_code > 255) return undefined;
    if (Object.prototype.hasOwnProperty.call(expect, 'stdout_includes')
      && (!Array.isArray(expect.stdout_includes) || expect.stdout_includes.length === 0
        || expect.stdout_includes.some((item) => typeof item !== 'string' || item.length === 0))) return undefined;
    return {
      argv: value.argv,
      expect: { exit_code: expect.exit_code, ...(expect.stdout_includes ? { stdout_includes: expect.stdout_includes } : {}) },
      source_line: sourceLine,
      command: value.argv.join(' '),
      structured: true,
    };
  }
  if (value.expect && typeof value.expect === 'object' && !Array.isArray(value.expect)
    && Number.isInteger(value.expect.exit_code) && value.expect.exit_code >= 0 && value.expect.exit_code <= 255
    && (!Object.prototype.hasOwnProperty.call(value.expect, 'stdout_includes')
      || (Array.isArray(value.expect.stdout_includes) && value.expect.stdout_includes.length > 0
        && value.expect.stdout_includes.every((item) => typeof item === 'string' && item.length > 0)))) {
    return {
      argv: value.argv,
      expect: { exit_code: value.expect.exit_code, ...(value.expect.stdout_includes ? { stdout_includes: value.expect.stdout_includes } : {}) },
      source_line: sourceLine,
      command: value.argv.join(' '),
      structured: true,
    };
  }
  if (typeof value.expected !== 'string' || !value.expected.trim()) return undefined;
  return {
    argv: value.argv,
    expected: value.expected.trim(),
    expect: value.expect,
    source_line: sourceLine,
    command: value.argv.join(' '),
    structured: true,
  };
}

/** Structured smoke entries are JSON objects. Legacy commands remain readable unless native strictness is requested. */
export function parsePlannedSmokes(planText, { nativeStrict = false, strict = false } = {}) {
  nativeStrict = nativeStrict || strict;
  const lines = linesWithNumbers(planText);
  const smoke = section(lines, /^##\s+Smoke\b/i);
  if (!smoke.exists) return { sectionExists: false, smokes: [], malformed: [] };
  const smokes = [];
  const malformed = [];
  let inFence = false;
  let fenceLines = [];
  let fenceStart = 0;
  for (const entry of smoke.lines) {
    const line = entry.text.trim();
    if (/^```/.test(line)) {
      if (!inFence) { inFence = true; fenceLines = []; fenceStart = entry.line; }
      else {
        inFence = false;
        const fence = fenceLines.map(({ text }) => text).join('\n').trim();
        const decoded = parseJsonValue(fence);
        if (decoded !== undefined) {
          const values = Array.isArray(decoded) ? decoded : [decoded];
          values.forEach((value, index) => {
            const parsed = smokeEntry(value, fenceStart + index, { nativeStrict });
            if (parsed) smokes.push(parsed);
            else malformed.push({ source_line: fenceStart, text: fence });
          });
        } else if (fence) {
          // A fenced block may also use strict JSONL, one smoke object per non-empty line.
          for (const fencedLine of fenceLines) {
            const jsonLine = fencedLine.text.trim();
            if (!jsonLine) continue;
            const value = parseJsonValue(jsonLine);
            const parsed = value !== undefined && !Array.isArray(value)
              ? smokeEntry(value, fencedLine.line, { nativeStrict })
              : undefined;
            if (parsed) smokes.push(parsed);
            else malformed.push({ source_line: fencedLine.line, text: jsonLine });
          }
        }
      }
      continue;
    }
    if (inFence) { fenceLines.push(entry); continue; }
    if (!line || /^<!--/.test(line)) continue;
    const bullet = line.match(/^[-*]\s+(.+)$/)?.[1] ?? line;
    const decoded = parseJsonValue(bullet);
    if (decoded !== undefined) {
      const values = Array.isArray(decoded) ? decoded : [decoded];
      values.forEach((value) => {
        const parsed = smokeEntry(value, entry.line, { nativeStrict });
        if (parsed) smokes.push(parsed); else malformed.push({ source_line: entry.line, text: bullet });
      });
      continue;
    }
    // Keep old commands available to scope-check. The orchestrator never executes these.
    const legacy = line.match(/^[-*]\s+`([^`]+)`\s*(?:→|->)\s*(.*)$/);
    if (legacy && !nativeStrict) {
      smokes.push({ command: legacy[1].trim(), expected: legacy[2].trim(), source_line: entry.line, structured: false });
      continue;
    }
    malformed.push({ source_line: entry.line, text: line });
  }
  return { sectionExists: true, smokes, malformed };
}

export function parseBoundaries(planText) {
  const block = section(linesWithNumbers(planText), /^##\s+Boundaries\b/i);
  if (!block.exists) return { sectionExists: false, allowed_paths: [], malformed: true };
  const source = block.lines.map((entry) => entry.text).join('\n').trim();
  let decoded;
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const inline = fenced ? fenced[1] : source.replace(/^[-*]\s+/, '');
  try { decoded = JSON.parse(inline); } catch { decoded = undefined; }
  const allowed = decoded?.allowed_paths;
  if (!Array.isArray(allowed) || allowed.length === 0 || allowed.some((value) => typeof value !== 'string')) {
    return { sectionExists: true, allowed_paths: [], malformed: true };
  }
  return { sectionExists: true, allowed_paths: allowed, malformed: false };
}

export function parsePlanIdentity(planText) {
  const identitySection = section(linesWithNumbers(planText), /^##\s+Identity\b/i);
  if (!identitySection.exists) return { sectionExists: false, malformed: true };
  const source = identitySection.lines.map((entry) => entry.text).join('\n').trim();
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1].trim() : source.replace(/^[-*]\s+/, '').trim();
  let decoded;
  try { decoded = JSON.parse(raw); } catch { decoded = undefined; }
  const keys = decoded && typeof decoded === 'object' && !Array.isArray(decoded) ? Object.keys(decoded).sort() : [];
  if (JSON.stringify(keys) !== JSON.stringify(['phase', 'request_sha256'])) return { sectionExists: true, malformed: true };
  if (typeof decoded.phase !== 'string' || !decoded.phase.trim()
    || typeof decoded.request_sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(decoded.request_sha256)) {
    return { sectionExists: true, malformed: true };
  }
  return { sectionExists: true, malformed: false, phase: decoded.phase, request_sha256: decoded.request_sha256 };
}

export function validateBoundaries(planText, projectRoot = process.cwd()) {
  const boundaries = parseBoundaries(planText);
  const errors = [];
  if (!boundaries.sectionExists || boundaries.malformed) errors.push('PLAN.md requires a JSON Boundaries object with non-empty allowed_paths');
  const seen = new Set();
  for (const candidate of boundaries.allowed_paths) {
    const normalized = candidate.replaceAll('\\', '/');
    if (!normalized || path.isAbsolute(normalized) || normalized.split('/').includes('..')) errors.push(`invalid boundary path: ${candidate}`);
    if (seen.has(normalized)) errors.push(`duplicate boundary path: ${candidate}`);
    seen.add(normalized);
    try {
      const lexical = resolveContainedPath(projectRoot, normalized, { allowMissing: true });
      const root = fs.realpathSync(projectRoot);
      if (lexical === root) throw new Error(`boundary path resolves to project root: ${candidate}`);
      let current = root;
      for (const component of path.relative(root, lexical).split(path.sep).filter(Boolean)) {
        current = path.join(current, component);
        let stat;
        try { stat = fs.lstatSync(current); } catch (error) {
          if (error.code === 'ENOENT') break;
          throw error;
        }
        if (stat.isSymbolicLink()) throw new Error(`boundary path contains an existing symlink component: ${candidate}`);
      }
    } catch (error) { errors.push(error.message); }
  }
  return { valid: errors.length === 0, errors, ...boundaries };
}

export function parsePlannedFlowUpdates(planText) {
  const flowUpdates = section(linesWithNumbers(planText), /^##\s+Flow updates\b/i);
  if (!flowUpdates.exists) return { sectionExists: false, entries: [] };
  return {
    sectionExists: true,
    entries: flowUpdates.lines
      .filter((entry) => /\S/.test(entry.text) && !/^#{1,6}\s+/.test(entry.text))
      .map((entry) => ({ text: stripMarkdown(entry.text), source_line: entry.line })),
  };
}

export function parseConfidenceScores(planText) {
  const confidence = section(linesWithNumbers(planText), /^##\s+Confidence\b/i);
  if (!confidence.exists) return [];
  return confidence.lines.map((entry) => {
    const match = entry.text.match(/\b([01](?:\.\d+)?)\b/);
    return match ? { score: Number(match[1]), source_line: entry.line } : undefined;
  }).filter(Boolean);
}

export function parseSmokeResults(summaryText) {
  const smokeResults = section(linesWithNumbers(summaryText), /^##\s+Smoke Results\b/i);
  const results = [];
  for (const entry of smokeResults.lines) {
    const line = entry.text.trim();
    if (!line.startsWith('|')) {
      const bullet = line.match(/^\s*[-*]\s+`([^`]+)`.*\b(pass|fail|skipped)\b/i);
      if (bullet) results.push({ command: bullet[1].trim(), status: bullet[2].toLowerCase(), observed: '' });
      continue;
    }
    if (/^\|\s*-+/.test(line) || /\bCommand\b.*\bStatus\b/i.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length < 2) continue;
    const statusCell = cells.findLast((cell) => /^(pass|fail|skipped)$/i.test(cell));
    if (!statusCell) continue;
    const headers = (() => {
      const header = smokeResults.lines.find(({ text: candidate }) => /\bCommand\b/i.test(candidate) && candidate.includes('|'))?.text;
      return header ? header.split('|').slice(1, -1).map((cell) => stripMarkdown(cell).toLowerCase()) : [];
    })();
    const result = { command: stripMarkdown(cells[0]), expected: cells[1] || '', observed: '', status: statusCell.toLowerCase() };
    const exitIndex = headers.indexOf('exit code');
    const stdoutIndex = headers.indexOf('stdout');
    const stderrIndex = headers.indexOf('stderr');
    if (exitIndex >= 0) result.exit_code = Number(cells[exitIndex]);
    if (stdoutIndex >= 0) result.stdout = cells[stdoutIndex];
    if (stderrIndex >= 0) result.stderr = cells[stderrIndex];
    if (stdoutIndex >= 0 || stderrIndex >= 0) result.observed = [result.stdout || '', result.stderr || ''].filter(Boolean).join(' ');
    else if (cells[2] && !/^(pass|fail|skipped)$/i.test(cells[2])) result.observed = cells[2];
    results.push(result);
  }
  return results;
}

export function parseSummaryStatus(summaryText) {
  const status = section(linesWithNumbers(summaryText), /^##\s+Status\s*$/i);
  for (const entry of status.lines) {
    const value = normalize(entry.text.replace(/^\*+|\*+$/g, ''));
    if (['completed', 'partial', 'blocked'].includes(value)) return value;
  }
  return undefined;
}

const SUMMARY_SECTIONS = Object.freeze(['Status', 'Changed Paths', 'Completed Criteria', 'Check Results', 'Smoke Results', 'Unresolved Items']);

function completedCriteriaBullets(summaryText) {
  const body = section(linesWithNumbers(summaryText), /^##\s+Completed Criteria\s*$/i);
  return body.lines
    .map(({ text }) => text.match(/^\s*[-*+]\s+(.+?)\s*$/)?.[1])
    .filter((value) => value !== undefined);
}

function matchesExactTaskLabel(bullet, label) {
  if (!String(bullet).startsWith(label)) return false;
  const suffix = String(bullet).slice(label.length);
  return suffix === '' || /^(?:\s|[,:;.!?()])/.test(suffix);
}

function substantiveTaskOutcome(value) {
  const outcome = stripMarkdown(value)
    .replace(/^[\s,:;.!?()\-[\u2014]+/, '')
    .trim();
  if (outcome.length < 8 || !/[A-Za-z0-9]/.test(outcome)) return false;
  return !/^(?:done|complete(?:d)?|implemented?|finished?|pass(?:ed)?|success(?:ful|fully)?|ok|yes|none|n\/?a|as requested|see above)(?:[.!\s]|$)/i.test(outcome);
}

const GENERIC_TASK_WORDS = new Set([
  'add', 'built', 'build', 'check', 'checks', 'complete', 'completed', 'create', 'created', 'ensure',
  'feature', 'fix', 'handle', 'handled', 'implement', 'implemented', 'remove', 'run', 'support',
  'test', 'tests', 'testing', 'update', 'use', 'verify', 'verified', 'work', 'write', 'written',
]);
const OBSERVABLE_BEHAVIOR = /\b(?:accept(?:s|ed)?|contain(?:s|ed)?|cover(?:s|ed)?|detect(?:s|ed)?|emit(?:s|ted)?|equal(?:s|ed)?|exercise(?:s|d)?|export(?:s|ed)?|filter(?:s|ed)?|import(?:s|ed)?|include(?:s|d)?|keep(?:s|t)?|match(?:es|ed)?|output(?:s|ted)?|parse(?:s|d)?|prevent(?:s|ed)?|produce(?:s|d)?|read(?:s|ing)?|reject(?:s|ed)?|render(?:s|ed)?|return(?:s|ed)?|sort(?:s|ed)?|throw(?:s|n)?|use(?:s|d)?|validat(?:e|es|ed)|write(?:s|en)?)\b/i;
const CONCRETE_CHANGE = /\b(?:add(?:s|ed)?|build(?:s|ing|t)?|chang(?:e|es|ed)|creat(?:e|es|ed)|delet(?:e|es|ed)|fix(?:es|ed)?|implement(?:s|ed)?|modif(?:y|ies|ied)|refactor(?:s|ed)?|remov(?:e|es|ed)|rewrit(?:e|es|ten)|updat(?:e|es|ed)|writ(?:e|es|ten|ing))\b/i;
const CODE_LIKE_ASSERTION = /(?:===|!==|==|!=|=>|%|\b(?:true|false|null|undefined)\b|\b[A-Za-z_$][\w$]*\([^)]*\)\s+(?:returns?|produces?|equals?|matches?))/i;

function normalizedEvidenceText(value) {
  return stripMarkdown(value).replaceAll('\\', '/').replace(/\s+/g, ' ').trim();
}

function escapedPattern(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mentionsChangedPath(value, candidate) {
  const normalized = normalizedEvidenceText(value);
  const relative = String(candidate).replaceAll('\\', '/').replace(/^\.\//, '');
  if (!relative) return false;
  const pattern = new RegExp(`(?:^|[^A-Za-z0-9_.-])(?:\\./)?${escapedPattern(relative)}(?=$|[^A-Za-z0-9_.-])`, 'i');
  return pattern.test(normalized);
}

function taskSpecificTokens(task) {
  return tokens(`${task.title}\n${task.body || ''}`).filter((token) => !GENERIC_TASK_WORDS.has(token));
}

function hasConcreteBehavior(suffix, task) {
  const normalized = normalize(suffix);
  const specific = taskSpecificTokens(task);
  if (!specific.some((token) => normalized.split(' ').includes(token))) return false;
  return OBSERVABLE_BEHAVIOR.test(suffix) || CODE_LIKE_ASSERTION.test(suffix);
}

function smokeObservationMatches(suffix, result) {
  const command = result?.argv?.join(' ') || result?.command;
  if (!command) return false;
  const normalized = normalizedEvidenceText(suffix).toLowerCase();
  const commandText = normalizedEvidenceText(command).toLowerCase();
  if (!normalized.includes(commandText)) return false;
  const status = String(result.status || '').toLowerCase();
  const statusObserved = status === 'pass'
    ? /\b(?:pass(?:es|ed)?|succeed(?:s|ed)?|green)\b/i.test(normalized)
    : status === 'fail'
      ? /\b(?:fail(?:s|ed|ure)?|red|error)\b/i.test(normalized)
      : status === 'skipped' && /\bskip(?:s|ped)?\b/i.test(normalized);
  const exitCode = Number.isInteger(result.exit_code)
    && new RegExp(`(?:exit(?:s|ed)?(?: code)?|status)\\s*(?:is|=|:)?\\s*${result.exit_code}(?:\\b|$)`, 'i').test(normalized);
  return statusObserved || exitCode;
}

function normalizedChangedPath(value) {
  return String(value ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
}

function changedRecordFor(pathValue, expectedChangedRecords) {
  if (!expectedChangedRecords) return undefined;
  if (expectedChangedRecords instanceof Map) {
    if (expectedChangedRecords.has(pathValue)) return expectedChangedRecords.get(pathValue);
    return [...expectedChangedRecords.entries()].find(([candidate]) => normalizedChangedPath(candidate) === pathValue)?.[1];
  }
  if (Object.prototype.hasOwnProperty.call(expectedChangedRecords, pathValue)) return expectedChangedRecords[pathValue];
  const entry = Object.entries(expectedChangedRecords).find(([candidate]) => normalizedChangedPath(candidate) === pathValue);
  return entry?.[1];
}

function isNonDirectoryChangedRecord(record) {
  if (!record || typeof record !== 'object') return false;
  const endpoints = [record.before, record.after].filter(Boolean);
  if (!endpoints.length && record.kind) endpoints.push(record);
  if (!endpoints.length) return false;
  return endpoints.some((endpoint) => endpoint.kind === 'file');
}

function authoritativeProductPaths(expectedChangedPaths, expectedChangedRecords) {
  if (!Array.isArray(expectedChangedPaths)) return [];
  const paths = [...new Set(expectedChangedPaths.map(normalizedChangedPath).filter(Boolean))];
  return paths.filter((candidate) => {
    const record = changedRecordFor(candidate, expectedChangedRecords);
    if (record) return isNonDirectoryChangedRecord(record);
    // Snapshot deltas include ancestor directories when a new directory is created.
    // An ancestor with a changed descendant cannot be the product file proving a task.
    return !paths.some((other) => other !== candidate && pathWithinBoundary(other, candidate));
  });
}

function validateNativeTaskAcknowledgements(summaryText, tasks, { expectedChangedPaths, expectedChangedRecords } = {}) {
  const errors = [];
  const bullets = completedCriteriaBullets(summaryText);
  if (bullets.length === 0) return ['SUMMARY.md ## Completed Criteria must contain one bullet per exact task heading'];
  const labels = tasks.map((task) => task.label);
  const actualPaths = authoritativeProductPaths(expectedChangedPaths, expectedChangedRecords);
  const owners = new Map();
  for (const task of tasks) {
    const matches = bullets.filter((bullet) => matchesExactTaskLabel(bullet, task.label));
    if (matches.length === 0) {
      errors.push(`SUMMARY.md does not acknowledge exact task label: ${task.label}`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`SUMMARY.md duplicates exact task acknowledgement: ${task.label}`);
      continue;
    }
    const suffix = matches[0].slice(task.label.length);
    if (suffix && !/^[\s,:;.!?()\-\u2014]/.test(suffix)) {
      errors.push(`SUMMARY.md task acknowledgement must start with the exact label: ${task.label}`);
      continue;
    }
    if (suffix.includes(task.label)) {
      errors.push(`SUMMARY.md repeats exact task label inside one acknowledgement: ${task.label}`);
      continue;
    }
    const declaredPaths = (task.declared_paths || []).map(normalizedChangedPath).filter(Boolean);
    const ownedPaths = actualPaths.filter((candidate) => declaredPaths.some((boundary) => pathWithinBoundary(candidate, boundary)));
    const citedPaths = ownedPaths.filter((candidate) => mentionsChangedPath(suffix, candidate));
    if (!ownedPaths.length) errors.push(`SUMMARY.md task acknowledgement has no actual changed product path under declared task paths: ${task.label}`);
    if (!citedPaths.length || !CONCRETE_CHANGE.test(suffix) || !substantiveTaskOutcome(suffix)) {
      errors.push(`SUMMARY.md task acknowledgement lacks authoritative evidence: exact changed-path outcome required for ${task.label}`);
    }
    for (const candidate of citedPaths) {
      const previous = owners.get(candidate);
      if (previous && previous !== task.label) {
        errors.push(`SUMMARY.md actual changed path is claimed by multiple native tasks: ${candidate}`);
      } else owners.set(candidate, task.label);
    }
    for (const otherLabel of labels) {
      if (otherLabel !== task.label && suffix.includes(otherLabel)) {
        errors.push(`SUMMARY.md cannot use one task acknowledgement for multiple tasks: ${task.label}`);
      }
    }
  }
  return errors;
}

function validateExactTaskAcknowledgements(summaryText, tasks, { expectedChangedPaths, expectedSmokeResults, expectedChangedRecords, nativeStrict = false } = {}) {
  if (nativeStrict) return validateNativeTaskAcknowledgements(summaryText, tasks, { expectedChangedPaths, expectedChangedRecords });
  const errors = [];
  const bullets = completedCriteriaBullets(summaryText);
  if (bullets.length === 0) return ['SUMMARY.md ## Completed Criteria must contain one bullet per exact task heading'];
  const labels = tasks.map((task) => task.label);
  for (const task of tasks) {
    const matches = bullets.filter((bullet) => matchesExactTaskLabel(bullet, task.label));
    if (matches.length === 0) {
      errors.push(`SUMMARY.md does not acknowledge exact task label: ${task.label}`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`SUMMARY.md duplicates exact task acknowledgement: ${task.label}`);
      continue;
    }
    const suffix = matches[0].slice(task.label.length);
    if (suffix && !/^[\s,:;.!?()\-\u2014]/.test(suffix)) {
      errors.push(`SUMMARY.md task acknowledgement must start with the exact label: ${task.label}`);
      continue;
    }
    if (suffix.includes(task.label)) {
      errors.push(`SUMMARY.md repeats exact task label inside one acknowledgement: ${task.label}`);
      continue;
    }
    const pathEvidence = Array.isArray(expectedChangedPaths)
      && expectedChangedPaths.some((candidate) => mentionsChangedPath(suffix, candidate))
      && CONCRETE_CHANGE.test(suffix);
    const smokeEvidence = Array.isArray(expectedSmokeResults)
      && expectedSmokeResults.some((result) => smokeObservationMatches(suffix, result));
    const behaviorEvidence = hasConcreteBehavior(suffix, task);
    if ((!pathEvidence && !smokeEvidence && !behaviorEvidence) || !substantiveTaskOutcome(suffix)) {
      errors.push(`SUMMARY.md task acknowledgement lacks authoritative evidence: ${task.label}`);
    }
    for (const otherLabel of labels) {
      if (otherLabel !== task.label && suffix.includes(otherLabel)) {
        errors.push(`SUMMARY.md cannot use one task acknowledgement for multiple tasks: ${task.label}`);
      }
    }
  }
  return errors;
}

export function parseSummarySections(summaryText) {
  const lines = linesWithNumbers(summaryText);
  const sections = {};
  const duplicates = [];
  for (const name of SUMMARY_SECTIONS) {
    const pattern = new RegExp(`^##\\s+${name.replace(' ', '\\s+')}\\s*$`, 'i');
    const matches = lines.filter(({ text: line }) => pattern.test(line));
    if (matches.length > 1) duplicates.push(name);
    sections[name] = section(lines, pattern);
  }
  const secondLevel = lines.map(({ text: line }) => line.match(/^##\s+(.+?)\s*$/)?.[1]?.trim()).filter(Boolean);
  const expected = new Set(SUMMARY_SECTIONS.map((name) => name.toLowerCase()));
  return {
    sections,
    duplicateSections: duplicates,
    unexpectedSections: secondLevel.filter((name) => !expected.has(name.toLowerCase())),
    sectionOrder: secondLevel.filter((name) => expected.has(name.toLowerCase())).map((name) => name.toLowerCase()),
  };
}

export function parseSummaryChangedPaths(summaryText) {
  const parsed = parseSummarySections(summaryText);
  const body = parsed.sections['Changed Paths']?.lines || [];
  return body.map(({ text: line }) => line.match(/^\s*[-*]\s+[` ]?([^`\s]+)[` ]?\s*$/)?.[1]?.replace(/^`|`$/g, '')).filter(Boolean).map((value) => value.replaceAll('\\', '/'));
}

export function parseReview(reviewText) {
  const text = String(reviewText ?? '');
  const lines = linesWithNumbers(text);
  const names = ['Mode', 'Verdict', 'Findings', 'Evidence', 'Residual Risk'];
  const sections = {};
  const duplicateSections = [];
  for (const name of names) {
    const pattern = new RegExp(`^##\\s+${name.replace(' ', '\\s+')}\\s*$`, 'i');
    const matches = lines.filter(({ text: line }) => pattern.test(line));
    if (matches.length > 1) duplicateSections.push(name);
    sections[name] = section(lines, pattern);
  }
  const secondLevel = lines
    .map(({ text: line }) => line.match(/^##\s+(.+?)\s*$/)?.[1])
    .filter(Boolean)
    .map((name) => name.trim().toLowerCase());
  const expected = new Set(names.map((name) => name.toLowerCase()));
  const unexpectedSections = secondLevel.filter((name) => !expected.has(name));
  const sectionOrder = secondLevel.filter((name) => expected.has(name));
  const body = (name) => sections[name]?.lines.map(({ text: line }) => line).join('\n').replace(/<!--[^>]*-->/g, '').trim() || '';
  const modeText = stripMarkdown(body('Mode')).trim().toLowerCase();
  const verdictText = stripMarkdown(body('Verdict')).trim();
  const pass = /^pass(?:\b|\s*[:.,])/i.test(verdictText) && !/\bfail\b/i.test(verdictText);
  const fail = /^fail(?:\b|\s*[:.,])/i.test(verdictText) && !/\bpass\b/i.test(verdictText);
  const findingsText = body('Findings');
  const findings = findingsText.split(/\r?\n/).map((line) => stripMarkdown(line).replace(/^[-*+]\s+/, '').trim()).filter((line) => line);
  return {
    verdict: pass ? 'PASS' : fail ? 'FAIL' : undefined,
    pass,
    fail,
    mode: modeText,
    sections,
    duplicateSections,
    unexpectedSections,
    sectionOrder,
    findings,
    evidence: body('Evidence'),
    residualRisk: body('Residual Risk'),
  };
}

const PLAN_REVIEW_SECTIONS = Object.freeze(['Mode', 'Verdict', 'Findings', 'Evidence', 'Residual Risk']);

function parseStrictReviewSections(reviewText, names) {
  const lines = linesWithNumbers(reviewText);
  const sections = Object.fromEntries(names.map((name) => [name, { exists: false, lines: [] }]));
  const headings = [];
  const duplicates = [];
  let current;
  for (const entry of lines) {
    const heading = entry.text.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const name = heading[1].trim();
      headings.push(name);
      current = names.includes(name) ? name : undefined;
      if (current) {
        if (sections[current].exists) duplicates.push(current);
        sections[current] = { exists: true, lines: [] };
      }
      continue;
    }
    if (current) sections[current].lines.push(entry);
  }
  const expected = new Set(names);
  const unexpectedSections = headings.filter((name) => !expected.has(name));
  const sectionOrder = headings.filter((name) => expected.has(name));
  const body = (name) => sections[name]?.lines.map(({ text }) => text).join('\n').trim() || '';
  return { lines, sections, duplicateSections: duplicates, unexpectedSections, sectionOrder, body };
}

export function parsePlanReview(reviewText) {
  const parsed = parseStrictReviewSections(reviewText, PLAN_REVIEW_SECTIONS);
  const mode = parsed.body('Mode');
  const verdict = parsed.body('Verdict');
  const findings = parsed.body('Findings');
  const evidence = parsed.body('Evidence');
  const residualRisk = parsed.body('Residual Risk');
  return {
    ...parsed,
    mode,
    verdict,
    findings,
    evidence,
    residualRisk,
  };
}

function planReviewPathVariants(planPath, projectRoot) {
  if (typeof planPath !== 'string' || !planPath.trim()) return [];
  const absolute = path.resolve(planPath).replaceAll('\\', '/');
  const variants = [absolute];
  if (projectRoot) {
    const relative = path.relative(path.resolve(projectRoot), path.resolve(planPath)).replaceAll(path.sep, '/');
    if (relative && !relative.startsWith('../') && relative !== '..') variants.push(relative);
  }
  variants.push('PLAN.md');
  return [...new Set(variants)];
}

function planReviewCitations(text, planPath, projectRoot) {
  const normalized = String(text ?? '').replaceAll('\\', '/');
  const citations = [];
  for (const candidate of planReviewPathVariants(planPath, projectRoot)) {
    const prefix = candidate === 'PLAN.md' || !candidate.startsWith('/')
      ? '(?:^|[^A-Za-z0-9_./-])'
      : '(?:^|[^A-Za-z0-9_.-])';
    const pattern = new RegExp(`${prefix}${escapedPattern(candidate)}:(\\d+)\\b`, 'g');
    let match;
    while ((match = pattern.exec(normalized))) citations.push({ path: candidate, line: Number(match[1]) });
  }
  return citations;
}

function substantivePlanReviewText(value, { kind } = {}) {
  const normalized = stripMarkdown(value).replace(/\s+/g, ' ').trim();
  if (normalized.length < 20 || !/[A-Za-z0-9]/.test(normalized)) return false;
  if (/^(?:none|n\/?a|ok|see (?:above|plan)|reviewed(?: the)? plan|plan reviewed|looks good|no findings?)\.?$/i.test(normalized)) return false;
  if (/^(?:see|review(?:ed)?|check(?:ed)?|verif(?:y|ied))\b.*\bPLAN\.md:[0-9]+\b[.!]?$/i.test(normalized)) return false;
  if (/^(?:everything|all)\s+(?:looks?\s+good|is\s+(?:fine|valid|correct))\b/i.test(normalized)) return false;
  if (/\b(?:no|without)\s+(?:known\s+)?(?:additional|residual)\s+risk\b/i.test(normalized)) return false;
  if (kind === 'evidence' && /^(?:evidence|reviewed|checked|verified)\b/i.test(normalized) && normalized.length < 32) return false;
  return true;
}

/** Validate the shared reviewer contract when the reviewer is checking PLAN.md. */
export function validatePlanReview(reviewText, { planPath, projectRoot } = {}) {
  const parsed = parsePlanReview(reviewText);
  const errors = [];
  for (const name of PLAN_REVIEW_SECTIONS) {
    if (!parsed.sections[name]?.exists) errors.push(`PLAN-REVIEW.md requires exact ## ${name} section`);
  }
  if (parsed.duplicateSections.length) errors.push(`PLAN-REVIEW.md has duplicate sections: ${parsed.duplicateSections.join(', ')}`);
  if (parsed.unexpectedSections.length) errors.push(`PLAN-REVIEW.md has unexpected second-level sections: ${parsed.unexpectedSections.join(', ')}`);
  if (parsed.sectionOrder.join('|') !== PLAN_REVIEW_SECTIONS.join('|')) errors.push('PLAN-REVIEW.md sections must use the required order');
  if (parsed.mode !== 'plan') errors.push('PLAN-REVIEW.md Mode body must be exactly plan');
  if (!['PROCEED', 'REVISE'].includes(parsed.verdict)) errors.push('PLAN-REVIEW.md Verdict body must be exactly PROCEED or REVISE');
  if (parsed.verdict === 'PROCEED' && parsed.findings !== 'None.') errors.push('PLAN-REVIEW.md PROCEED Findings body must be exactly None.');
  if (parsed.verdict === 'REVISE') {
    const findingText = parsed.findings;
    const hasSeverity = /\b(?:P[0-3]|critical|high|medium|low|blocker|major|minor)\b/i.test(findingText);
    const hasPathLine = planReviewCitations(findingText, planPath, projectRoot).length > 0
      || /(?:^|[^A-Za-z0-9_.-])(?:\.?\/?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*):(?:[1-9][0-9]*)\b/.test(findingText);
    if (!hasSeverity || !hasPathLine) errors.push('PLAN-REVIEW.md REVISE findings require a severity and concrete path:line evidence');
  }
  if (!substantivePlanReviewText(parsed.evidence, { kind: 'evidence' })) errors.push('PLAN-REVIEW.md Evidence must be substantive');
  if (!substantivePlanReviewText(parsed.residualRisk, { kind: 'risk' })) errors.push('PLAN-REVIEW.md Residual Risk must be substantive and at least 20 characters');
  const citations = planReviewCitations(parsed.evidence, planPath, projectRoot);
  if (!citations.length) errors.push('PLAN-REVIEW.md Evidence must cite PLAN.md with a line number');
  else {
    let lineCount;
    try {
      const planText = fs.readFileSync(path.resolve(planPath), 'utf8');
      const planLines = planText.split(/\r?\n/);
      if (planLines.at(-1) === '') planLines.pop();
      lineCount = Math.max(planLines.length, 1);
    } catch { errors.push('PLAN-REVIEW.md Evidence PLAN.md path cannot be inspected'); }
    if (lineCount !== undefined && citations.some(({ line }) => line < 1 || line > lineCount)) {
      errors.push(`PLAN-REVIEW.md Evidence cites a PLAN.md line outside 1-${lineCount}`);
    }
  }
  const contractValid = errors.length === 0;
  return { valid: contractValid && parsed.verdict === 'PROCEED', contractValid, errors, ...parsed };
}

function packageScripts(projectRoot) {
  try {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
    return new Set(Object.keys(packageJson.scripts || {}));
  } catch { return new Set(); }
}

const ALLOWED_BINARIES = new Set(['node', 'npm', 'npx', 'pnpm', 'yarn', 'bun']);
const META = /[;&|<>$`\\\n\r]/;
const NODE_MODULE_LOADING_FLAGS = new Set(['--import', '--loader', '--require']);
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

function pathBearingArgument(argument, root) {
  if (typeof argument !== 'string' || !argument) return false;
  const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argument;
  return path.isAbsolute(value)
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.startsWith('.')
    || value.includes('/')
    || value.includes('\\')
    || fs.existsSync(path.join(root, value));
}

function validatePathBearingArgument(root, argument) {
  if (!pathBearingArgument(argument, root)) return undefined;
  const value = argument.includes('=') ? argument.slice(argument.indexOf('=') + 1) : argument;
  try {
    resolveContainedPath(root, value, { allowMissing: true });
    return undefined;
  } catch (error) {
    return `path-bearing smoke argument escapes project root: ${argument} (${error.message})`;
  }
}

function nodeModuleLoadingArguments(argv) {
  const values = [];
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (NODE_MODULE_LOADING_FLAGS.has(argument)) {
      values.push({ flag: argument, value: argv[index + 1], argument: argv[index + 1] });
      index += 1;
      continue;
    }
    const equals = argument.match(/^(--import|--loader|--require)=(.*)$/s);
    if (equals) values.push({ flag: equals[1], value: equals[2], argument });
  }
  return values;
}

function validateNodeModuleLoadingArgument(root, { flag, value, argument }) {
  const urlValue = typeof value === 'string' ? value.trim() : value;
  if (typeof urlValue !== 'string' || !URI_SCHEME.test(urlValue)) return undefined;
  if (!/^file:/i.test(urlValue)) return `node ${flag} non-file URL is forbidden: ${argument}`;
  let filePath;
  try {
    filePath = fileURLToPath(urlValue);
    if (filePath.includes('\0')) throw new Error('file URL contains a NUL byte');
  } catch (error) {
    return `node ${flag} file URL is malformed: ${argument} (${error.message})`;
  }
  try {
    resolveContainedPath(root, filePath, { allowMissing: true });
  } catch (error) {
    return `node ${flag} file URL escapes project root: ${argument} (${error.message})`;
  }
  return undefined;
}

function nodeFileURLArguments(argv) {
  const values = [];
  for (const argument of argv.slice(1)) {
    if (/^\s*file:/i.test(argument)) {
      values.push({ value: argument, argument });
      continue;
    }
    const equals = argument.match(/^[^=]+=([\s\S]*)$/);
    if (equals && /^\s*file:/i.test(equals[1])) values.push({ value: equals[1], argument });
  }
  return values;
}

function validateNodeFileURLArgument(root, { value, argument }) {
  let filePath;
  try {
    filePath = fileURLToPath(value.trim());
    if (filePath.includes('\0')) throw new Error('file URL contains a NUL byte');
  } catch (error) {
    return `node file URL is malformed: ${argument} (${error.message})`;
  }
  try {
    resolveContainedPath(root, filePath, { allowMissing: true });
  } catch (error) {
    return `node file URL escapes project root: ${argument} (${error.message})`;
  }
  return undefined;
}

export function validateSmokeArgv(argv, projectRoot = process.cwd()) {
  const errors = [];
  if (!Array.isArray(argv) || argv.length === 0 || argv.some((arg) => typeof arg !== 'string')) {
    return ['argv must be a non-empty array of strings'];
  }
  const executable = argv[0];
  if (!executable || META.test(executable)) errors.push('executable contains shell metacharacters');
  if (path.isAbsolute(executable)) errors.push('absolute executables are forbidden');
  if (executable.includes('/') || executable.split(path.sep).includes('..')) errors.push('executable path escape is forbidden');
  if (argv.slice(1).some((arg) => META.test(arg))) errors.push('smoke arguments contain shell metacharacters');
  const scripts = packageScripts(projectRoot);
  for (const arg of argv.slice(1)) {
    const pathError = validatePathBearingArgument(projectRoot, arg);
    if (pathError) errors.push(pathError);
  }
  if (executable === 'node' && argv.slice(1).some((arg) => ['-e', '--eval', '-p', '--print'].includes(arg) || /^--(?:eval|print)=/.test(arg))) {
    errors.push('node eval and print flags are forbidden');
  }
  if (executable === 'node' && argv.slice(1).some((arg) => /^data:/i.test(arg) || /=data:/i.test(arg))) {
    errors.push('node data URI inline execution is forbidden');
  }
  if (executable === 'node') {
    for (const fileArgument of nodeFileURLArguments(argv)) {
      const fileError = validateNodeFileURLArgument(projectRoot, fileArgument);
      if (fileError) errors.push(fileError);
    }
    for (const moduleArgument of nodeModuleLoadingArguments(argv)) {
      const moduleError = validateNodeModuleLoadingArgument(projectRoot, moduleArgument);
      if (moduleError) errors.push(moduleError);
    }
  }
  if (executable === 'npx') {
    if (argv[1] !== '--no-install' || !argv[2]) errors.push('npx requires --no-install and a local binary');
    else {
      const localBin = path.join(projectRoot, 'node_modules', '.bin', argv[2]);
      if (!fs.existsSync(localBin)) errors.push(`npx binary is not project-local: ${argv[2]}`);
      else {
        try { resolveContainedPath(projectRoot, path.relative(projectRoot, localBin)); } catch { errors.push(`npx binary escapes project root: ${argv[2]}`); }
      }
    }
  } else if (!ALLOWED_BINARIES.has(executable)) {
    errors.push(`executable is not allowed: ${executable}`);
  } else if (['npm', 'pnpm', 'yarn', 'bun'].includes(executable)) {
    const command = argv[1];
    const declared = command === 'run' ? argv[2] : command === 'test' ? 'test' : undefined;
    if (!declared || (command === 'run' && argv.length < 3) || !scripts.has(declared)) {
      errors.push(`${executable} may invoke only test or a declared package script`);
    }
  }
  return errors;
}

export function validatePlan(planText, {
  projectRoot = process.cwd(), requireStructuredSmokes = false, requireNativeStrict = false, nativeStrict = false,
  strict = false, requireBoundaries = false, requireIdentity = false, identity, expectedIdentity,
} = {}) {
  const nativeStrictMode = requireNativeStrict || nativeStrict || strict;
  const strictSmoke = requireStructuredSmokes || nativeStrictMode;
  const parsed = parsePlannedSmokes(planText, { nativeStrict: nativeStrictMode });
  const errors = [];
  const nativeTasks = nativeStrictMode ? parseNativeTaskShape(planText, { enforceProductScope: true }) : undefined;
  const tasks = nativeStrictMode ? nativeTasks.tasks : parsePlannedTasks(planText);
  const waves = nativeStrictMode ? parseNativeWaves(planText, tasks) : undefined;
  const parsedIdentity = parsePlanIdentity(planText);
  const expected = expectedIdentity || identity;
  if (nativeStrictMode) errors.push(...nativeReservedSectionErrors(planText), ...nativePromptInjectionErrors(planText));
  if (requireIdentity && (!parsedIdentity.sectionExists || parsedIdentity.malformed)) errors.push('PLAN.md requires a valid ## Identity JSON object');
  if (expected) {
    if (!parsedIdentity.sectionExists || parsedIdentity.malformed) errors.push('PLAN.md Identity is missing or malformed');
    else {
      if (parsedIdentity.phase !== expected.phase) errors.push('PLAN.md Identity phase does not match the requested phase');
      if (parsedIdentity.request_sha256 !== expected.request_sha256) errors.push('PLAN.md Identity request_sha256 does not match the requested task');
    }
  }
  if (nativeTasks) errors.push(...nativeTasks.errors);
  if (waves) errors.push(...waves.errors);
  else if (!tasks.length) errors.push('PLAN.md has no parseable Tasks section');
  if (strictSmoke && !parsed.sectionExists) errors.push('PLAN.md requires a non-empty ## Smoke section');
  if (nativeStrictMode && parsed.sectionExists && parsed.smokes.length < 2) errors.push('PLAN.md ## Smoke must contain at least two structured JSON entries');
  else if (strictSmoke && parsed.sectionExists && parsed.smokes.length === 0) errors.push('PLAN.md ## Smoke must contain at least one structured JSON entry');
  if (parsed.malformed.length) errors.push(`malformed Smoke entry at line ${parsed.malformed[0].source_line}`);
  if (nativeStrictMode) {
    const smokeIdentities = new Map();
    for (const smoke of parsed.smokes) {
      if (!smoke.structured) continue;
      const identityKey = canonicalSmokeIdentity(smoke);
      const previous = smokeIdentities.get(identityKey);
      if (previous !== undefined) {
        errors.push(`PLAN.md ## Smoke contains duplicate structured argv+expect entry at lines ${previous} and ${smoke.source_line}`);
      } else smokeIdentities.set(identityKey, smoke.source_line);
    }
  }
  const boundaryCheck = validateBoundaries(planText, projectRoot);
  if (requireBoundaries) errors.push(...boundaryCheck.errors);
  for (const smoke of parsed.smokes) {
    if (!smoke.structured) {
      if (requireStructuredSmokes || strictSmoke) errors.push(`legacy free-form smoke command at line ${smoke.source_line}`);
      continue;
    }
    errors.push(...validateSmokeArgv(smoke.argv, projectRoot).map((message) => `Smoke line ${smoke.source_line}: ${message}`));
    if (strictSmoke && (!smoke.expect || !Number.isInteger(smoke.expect.exit_code))) errors.push(`Smoke line ${smoke.source_line}: expect.exit_code is required`);
  }
  return {
    valid: errors.length === 0, errors, tasks, waves, smokes: parsed.smokes, planned_smokes: parsed.smokes,
    boundaries: boundaryCheck, identity: parsedIdentity,
  };
}

export function validateSummary(summaryText, {
  planText, requireCompleted = false, expectedChangedPaths, expectedChangedRecords, expectedSmokeResults,
} = {}) {
  const errors = [];
  const parsedSections = parseSummarySections(summaryText);
  const changedPaths = parseSummaryChangedPaths(summaryText);
  const smokeResults = parseSmokeResults(summaryText);
  for (const name of SUMMARY_SECTIONS) {
    if (!parsedSections.sections[name]?.exists) errors.push(`SUMMARY.md requires exact ## ${name} section`);
    else if (!parsedSections.sections[name].lines.some(({ text: line }) => line.trim())) errors.push(`SUMMARY.md ## ${name} must be non-empty`);
  }
  if (parsedSections.duplicateSections.length) errors.push(`SUMMARY.md has duplicate sections: ${parsedSections.duplicateSections.join(', ')}`);
  if (parsedSections.unexpectedSections.length) errors.push(`SUMMARY.md has unexpected second-level sections: ${parsedSections.unexpectedSections.join(', ')}`);
  const requiredOrder = SUMMARY_SECTIONS.map((name) => name.toLowerCase()).join('|');
  if (parsedSections.sectionOrder.join('|') !== requiredOrder) errors.push('SUMMARY.md sections must use the required order');
  const status = parseSummaryStatus(summaryText);
  if (!status) errors.push('SUMMARY.md has no valid Status');
  if (requireCompleted) {
    const statusBody = normalize(parsedSections.sections.Status?.lines.map(({ text: line }) => line).join(' ') || '');
    if (statusBody !== 'completed') errors.push('SUMMARY.md Status must contain exactly completed');
    const unresolvedBody = normalize(parsedSections.sections['Unresolved Items']?.lines.map(({ text: line }) => line).join(' ') || '');
    if (unresolvedBody !== 'none') errors.push('SUMMARY.md ## Unresolved Items must contain exactly None.');
  }
  if (planText) {
    const plan = validatePlan(planText);
    const strictPlan = validatePlan(planText, { requireNativeStrict: true });
    const nativeShape = parseNativeTaskShape(planText);
    const nativeSectionsPresent = nativeShape.exact && nativeReservedSectionErrors(planText).length === 0;
    if (nativeSectionsPresent && !strictPlan.valid) errors.push(...strictPlan.errors);
    const exactTasks = parseNativeTaskShape(planText, { enforceProductScope: true });
    const nativeStrict = strictPlan.valid && exactTasks.exact;
    if (nativeStrict) {
      if (requireCompleted && (!Array.isArray(expectedChangedPaths) || expectedChangedPaths.length === 0)) {
        errors.push('SUMMARY.md native strict PLAN requires a non-empty authoritative expectedChangedPaths for completed work');
      }
      errors.push(...validateExactTaskAcknowledgements(summaryText, exactTasks.tasks, {
        expectedChangedPaths,
        expectedChangedRecords,
        expectedSmokeResults,
        nativeStrict: true,
      }));
    } else if (exactTasks.exact) {
      errors.push(...validateExactTaskAcknowledgements(summaryText, exactTasks.tasks, { expectedChangedPaths, expectedSmokeResults }));
    } else {
      const completedBody = parsedSections.sections['Completed Criteria']?.lines.map(({ text: line }) => line).join('\n') || '';
      const normalized = normalize(completedBody);
      for (const task of plan.tasks) {
        const taskTokens = tokens(task.id);
        if (!normalized.includes(task.id) && taskTokens.some((token) => !normalized.includes(token))) errors.push(`SUMMARY.md does not acknowledge task: ${task.id}`);
      }
    }
  }
  if (Array.isArray(expectedChangedPaths)) {
    const expected = [...new Set(expectedChangedPaths.map((value) => String(value).replaceAll('\\', '/')))].sort();
    const actual = [...new Set(changedPaths)].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push('SUMMARY.md Changed Paths do not match the authoritative worker delta');
  }
  if (Array.isArray(expectedSmokeResults)) {
    const expected = expectedSmokeResults.map((result) => ({ command: result.argv?.join(' ') || result.command, exit_code: result.exit_code, status: result.status }));
    const actual = smokeResults.map((result) => ({ command: result.command, exit_code: result.exit_code, status: result.status }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) errors.push('SUMMARY.md Smoke Results do not match authoritative smoke observations');
  }
  return { valid: errors.length === 0, errors, status, changed_paths: changedPaths, smoke_results: smokeResults, sections: parsedSections };
}

function reviewEvidenceHash(evidence, labels) {
  const labelPattern = labels.join('|');
  const match = String(evidence).match(new RegExp(`(?:${labelPattern}).{0,120}?([a-f0-9]{64})(?![a-f0-9])`, 'i'));
  return match?.[1]?.toLowerCase();
}

function normalizedEvidenceExpectations(expectedEvidence = {}) {
  const normalized = Object.fromEntries(Object.entries(expectedEvidence || {}).map(([key, value]) => [key.toLowerCase().replace(/[^a-z0-9]+/g, '_'), value]));
  const get = (...keys) => keys.map((key) => normalized[key]).find((value) => typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value));
  return {
    plan: get('plan', 'plan_hash', 'plan_sha256'),
    summary: get('summary', 'summary_hash', 'summary_sha256'),
    worker_delta: get('worker_delta', 'worker_delta_hash', 'worker_delta_sha256', 'delta', 'delta_hash'),
    base_snapshot: get('base_snapshot', 'base_snapshot_hash', 'base_snapshot_sha256'),
    head_snapshot: get('head_snapshot', 'head_snapshot_hash', 'head_snapshot_sha256'),
    delta_paths: Array.isArray(normalized.delta_paths) ? normalized.delta_paths : (Array.isArray(normalized.deltapaths) ? normalized.deltapaths : []),
  };
}

function evidencePathLine(evidence, deltaPaths) {
  const paths = deltaPaths.map((item) => String(item).replaceAll('\\', '/').replace(/^\.\//, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!paths.length) return undefined;
  const match = String(evidence).match(new RegExp(`(?:^|[^A-Za-z0-9_.-])((?:\\./)?${paths.join('|')}):(deleted|[1-9][0-9]*)\\b`));
  return match ? `${match[1]}:${match[2]}` : undefined;
}

function reviewPathCitations(text, { expectedPaths = [] } = {}) {
  const citations = [];
  const expected = new Set(expectedPaths.map((value) => String(value).replaceAll('\\', '/').replace(/^\.\//, '')));
  const pattern = /(?:^|[^A-Za-z0-9_.-])((?:\/[A-Za-z0-9_.-]+)+|(?:\.\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*):(deleted|[1-9][0-9]*)\b/g;
  let match;
  while ((match = pattern.exec(String(text)))) {
    const candidate = match[1].replace(/^\.\//, '');
    // Numeric prose such as a WCAG contrast ratio (`1.46:1`) is not a file
    // citation. Keep accepting extensionless and missing paths, but require a
    // bare candidate to contain a filename-like character rather than treating
    // every number before `:line` as a path.
    if (!candidate.includes('/') && !/[A-Za-z_]/.test(candidate) && !expected.has(candidate)) continue;
    citations.push({ path: candidate, line: match[2] });
  }
  return citations;
}

function validateReviewPaths(reviewText, { projectRoot, reviewablePaths = [], evidenceText } = {}) {
  if (!projectRoot && !reviewablePaths.length) return [];
  const errors = [];
  const citations = reviewPathCitations(reviewText, { expectedPaths: reviewablePaths });
  const evidenceCitations = reviewPathCitations(evidenceText ?? reviewText, { expectedPaths: reviewablePaths });
  const normalized = (value) => String(value).replaceAll('\\', '/').replace(/^\.\//, '');
  const asRelative = (candidate) => {
    const absoluteRoot = projectRoot ? path.resolve(projectRoot) : undefined;
    const value = normalized(candidate);
    if (absoluteRoot && path.isAbsolute(value)) {
      const relative = path.relative(absoluteRoot, value).replaceAll(path.sep, '/');
      return relative && !relative.startsWith('../') ? relative : value;
    }
    return value;
  };
  for (const citation of citations) {
    if (!projectRoot) continue;
    const relative = asRelative(citation.path);
    let absolute;
    try { absolute = resolveContainedPath(projectRoot, relative, { allowMissing: true }); }
    catch (error) { errors.push(`REVIEW.md cites an escaping path: ${citation.path}`); continue; }
    let stat;
    try { stat = fs.lstatSync(absolute); } catch (error) { if (error.code !== 'ENOENT') errors.push(`REVIEW.md cited path cannot be inspected: ${citation.path}`); }
    if (citation.line === 'deleted') {
      if (stat) errors.push(`REVIEW.md marks an extant path as deleted: ${citation.path}`);
      continue;
    }
    if (!stat) { errors.push(`REVIEW.md cites a missing path: ${citation.path}`); continue; }
    if (stat.isDirectory()) continue;
    const lineCount = stat.isFile() ? (() => {
      const content = fs.readFileSync(absolute, 'utf8');
      const lines = content.split(/\r?\n/);
      if (lines.at(-1) === '') lines.pop();
      return Math.max(lines.length, 1);
    })() : 1;
    if (Number(citation.line) > lineCount) errors.push(`REVIEW.md cites a line outside ${citation.path}: ${citation.line}`);
  }
  if (projectRoot && reviewablePaths.length) {
    for (const candidate of reviewablePaths) {
      const relative = asRelative(candidate);
      let absolute;
      try { absolute = resolveContainedPath(projectRoot, relative, { allowMissing: true }); } catch { errors.push(`REVIEW.md reviewable path escapes project root: ${candidate}`); continue; }
      let stat;
      try { stat = fs.lstatSync(absolute); } catch (error) { if (error.code !== 'ENOENT') errors.push(`REVIEW.md reviewable path cannot be inspected: ${candidate}`); }
      if (stat?.isDirectory()) continue;
      const expectedCitation = evidenceCitations.find((citation) => asRelative(citation.path) === relative);
      if (!expectedCitation) errors.push(`REVIEW.md Evidence must cite every reviewable path: ${candidate}`);
      else if (!stat && expectedCitation.line !== 'deleted') errors.push(`REVIEW.md must mark removed path as deleted: ${candidate}`);
    }
  }
  return errors;
}

export function validateReview(reviewText, options = {}) {
  if (options?.mode === 'plan') return validatePlanReview(reviewText, options);
  const expectedEvidence = options?.expectedEvidence || options || {};
  const parsed = parseReview(reviewText);
  const errors = [];
  const required = ['Mode', 'Verdict', 'Findings', 'Evidence', 'Residual Risk'];
  for (const name of required) if (!parsed.sections[name]?.exists) errors.push(`REVIEW.md requires exact ## ${name} section`);
  if (parsed.duplicateSections.length) errors.push(`REVIEW.md has duplicate sections: ${parsed.duplicateSections.join(', ')}`);
  if (parsed.unexpectedSections.length) errors.push(`REVIEW.md has unexpected second-level sections: ${parsed.unexpectedSections.join(', ')}`);
  if (parsed.sectionOrder.join('|') !== required.map((name) => name.toLowerCase()).join('|')) errors.push('REVIEW.md sections must use the required order');
  if (parsed.mode !== 'code') errors.push('REVIEW.md Mode must be code');
  if (!parsed.verdict) errors.push('REVIEW.md Verdict must be an unambiguous PASS or FAIL');
  if (!parsed.evidence.trim()) errors.push('REVIEW.md Evidence must be non-empty');
  if (!parsed.residualRisk.trim()) errors.push('REVIEW.md Residual Risk must be non-empty');
  if (!parsed.findings.length) errors.push('REVIEW.md Findings must be non-empty');
  const modeBody = stripMarkdown(parsed.sections.Mode?.lines.map(({ text }) => text).join('\n') || '').trim().toLowerCase();
  const verdictBody = stripMarkdown(parsed.sections.Verdict?.lines.map(({ text }) => text).join('\n') || '').trim();
  const findingsBody = parsed.sections.Findings?.lines.map(({ text }) => text).join('\n').replace(/<!--[^>]*-->/g, '').trim() || '';
  const evidenceBody = parsed.evidence.trim();
  const riskBody = parsed.residualRisk.trim();
  if (modeBody !== 'code') errors.push('REVIEW.md Mode body must be exactly code');
  if (!/^(PASS|FAIL)$/.test(verdictBody)) errors.push('REVIEW.md Verdict body must be exactly PASS or FAIL');
  if (parsed.verdict === 'PASS' && findingsBody !== 'None.') errors.push('REVIEW.md PASS Findings body must be exactly None.');
  if (parsed.verdict === 'FAIL') {
    if (parsed.findings.length === 1 && /^none[.!]?$/i.test(parsed.findings[0])) errors.push('REVIEW.md FAIL requires at least one finding');
    if (!parsed.findings.some((finding) => /\b(?:P[0-3]|critical|high|medium|low|blocker|major|minor)\b/i.test(finding)
      && /(?:^|[\s`(\[])(?:\.\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*:\d+\b/.test(finding))) {
      errors.push('REVIEW.md FAIL findings require a severity and concrete path:line');
    }
  }
  const expected = normalizedEvidenceExpectations(expectedEvidence);
  const evidenceLabels = {
    plan: ['PLAN(?:\.md)?', 'plan_sha256', 'plan_hash'],
    summary: ['SUMMARY(?:\.md)?', 'summary_sha256', 'summary_hash'],
    worker_delta: ['worker[ _-]?delta', 'worker_delta_sha256', 'worker_delta_hash'],
    base_snapshot: ['base[ _-]?snapshot', 'base_snapshot_sha256', 'base_snapshot_hash'],
    head_snapshot: ['head[ _-]?snapshot', 'head_snapshot_sha256', 'head_snapshot_hash'],
  };
  for (const [key, expectedHash] of Object.entries(expected)) {
    if (key === 'delta_paths') continue;
    if (!expectedHash) {
      errors.push(`REVIEW.md Evidence expected ${key} SHA-256 is unavailable`);
      continue;
    }
    const actualHash = reviewEvidenceHash(evidenceBody, evidenceLabels[key]);
    if (actualHash !== expectedHash.toLowerCase()) errors.push(`REVIEW.md Evidence ${key} SHA-256 does not match runner evidence`);
  }
  if (expected.delta_paths.length && !evidencePathLine(evidenceBody, expected.delta_paths)) {
    errors.push('REVIEW.md Evidence must cite at least one reviewed delta path:line');
  }
  errors.push(...validateReviewPaths(reviewText, { projectRoot: options.projectRoot, reviewablePaths: expected.delta_paths, evidenceText: evidenceBody }));
  const riskNormalized = riskBody.toLowerCase().replace(/[.!?]+$/, '').trim();
  if (riskBody.length < 20 || /^(none|n\/a|na|ok|none identified|no residual risk)$/.test(riskNormalized)
    || /^(?:no|without) (?:additional|residual) risk\b/.test(riskNormalized)) {
    errors.push('REVIEW.md Residual Risk must be substantive and at least 20 characters');
  }
  const contractValid = errors.length === 0;
  return { valid: contractValid && parsed.verdict === 'PASS', contractValid, errors, ...parsed };
}

/** Strict, portable contract for the terminal semantic security review. */
export function validateSecurityReview(text, { phase, projectRoot } = {}) {
  const source = String(text ?? '').replace(/\r\n?/g, '\n');
  const errors = [];
  const front = source.match(/^---\n([\s\S]*?)\n---\n?/);
  const values = {};
  if (!front) errors.push('SECURITY.md requires exact YAML frontmatter');
  else {
    for (const line of front[1].split('\n')) {
      const match = line.match(/^([a-z_]+): (.+)$/);
      if (!match || Object.hasOwn(values, match?.[1])) { errors.push('SECURITY.md frontmatter is malformed or duplicate'); continue; }
      values[match[1]] = match[2];
    }
    if (JSON.stringify(Object.keys(values).sort()) !== JSON.stringify(['generated_at', 'phase', 'verdict'])) errors.push('SECURITY.md frontmatter must contain only phase, generated_at, verdict');
    if (values.phase !== String(phase || '')) errors.push('SECURITY.md frontmatter phase does not match');
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(values.generated_at || '')) errors.push('SECURITY.md generated_at must be an ISO UTC timestamp');
    if (!['PASS', 'PASS-WITH-WARNINGS', 'BLOCKED'].includes(values.verdict)) errors.push('SECURITY.md verdict must be PASS, PASS-WITH-WARNINGS, or BLOCKED');
  }
  const body = front ? source.slice(front[0].length) : source;
  if (/\b(?:ignore|override)\s+(?:all\s+)?(?:previous|above)\s+instructions?\b|\b(?:return|set)\s+(?:the\s+)?verdict\b/i.test(body)) errors.push('SECURITY.md contains prompt-injection verdict instructions');
  if (/(?:^|\s)(?:\/[^\s:]+|[A-Za-z]:\\[^\s:]+):\d+/m.test(body)) errors.push('SECURITY.md must not contain absolute paths');
  const headings = [...body.matchAll(/^## ([A-Za-z ][A-Za-z -]*)\s*$/gm)].map((match) => ({ name: match[1], index: match.index }));
  const names = headings.map((entry) => entry.name);
  const allowed = ['Verdict', 'Findings', 'Resolved Findings', 'Notes'];
  if (names.some((name) => !allowed.includes(name)) || new Set(names).size !== names.length) errors.push('SECURITY.md has duplicate or unexpected reserved sections');
  const expected = ['Verdict', ...(names.includes('Findings') ? ['Findings'] : []), 'Resolved Findings', 'Notes'];
  if (JSON.stringify(names) !== JSON.stringify(expected)) errors.push('SECURITY.md sections must be Verdict, optional Findings, Resolved Findings, Notes in order');
  const sectionBody = (name) => { const i = headings.findIndex((entry) => entry.name === name); return i < 0 ? '' : body.slice(headings[i].index + `## ${headings[i].name}`.length, headings[i + 1]?.index).trim(); };
  if (sectionBody('Verdict') !== (values.verdict || '')) errors.push('SECURITY.md Verdict section must exactly match frontmatter verdict');
  const findings = [];
  const findingRe = /^### \[(CRITICAL|HIGH|MEDIUM|LOW)\]\s+(.+?)\s*$/gm;
  let match;
  const findingsBody = sectionBody('Findings');
  const resolvedBody = sectionBody('Resolved Findings');
  if (resolvedBody !== 'None.') errors.push('SECURITY.md Resolved Findings must be exactly None.');
  const levelThreeHeadingsOutsideFindings = body.replace(findingsBody, '').match(/^###\s+/gm) || [];
  if (levelThreeHeadingsOutsideFindings.length) errors.push('SECURITY.md level-three findings are allowed only in Findings');
  while ((match = findingRe.exec(findingsBody))) {
    const item = findingsBody.slice(match.index + match[0].length, findingsBody.indexOf('\n### ', match.index + 1) < 0 ? findingsBody.length : findingsBody.indexOf('\n### ', match.index + 1));
    findings.push({ severity: match[1], title: match[2], body: item });
  }
  if (findingsBody && findings.length === 0) errors.push('SECURITY.md Findings must use severity headings');
  if (/^### /m.test(findingsBody) && findings.length !== (findingsBody.match(/^### /gm) || []).length) errors.push('SECURITY.md Findings has invalid headings');
  for (const finding of findings) {
    for (const label of ['Location', 'OWASP category', 'Description', 'Proof', 'Fix']) {
      const value = finding.body.match(new RegExp(`(?:^|\\n)${label}:\\s*(.+)`, 'i'))?.[1]?.trim();
      if (!value || /^(?:none|n\/a|unknown|see above|tbd|todo)[.!]?$/i.test(value)) errors.push(`SECURITY.md ${finding.severity} finding requires substantive ${label}`);
    }
    const locations = finding.body.match(/(?:^|\n)Location:\s*(.+)/im)?.[1] || '';
    for (const citation of reviewPathCitations(locations)) {
      if (!projectRoot) continue;
      try {
        const file = resolveContainedPath(projectRoot, citation.path.replace(/^\.\//, ''), { allowMissing: true });
        const stat = fs.existsSync(file) ? fs.lstatSync(file) : null;
        if (citation.line === 'deleted') { if (stat) errors.push(`SECURITY.md deleted citation exists: ${citation.path}`); }
        else if (!stat?.isFile()) errors.push(`SECURITY.md citation is missing: ${citation.path}`);
        else if (Number(citation.line) > Math.max(1, fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line !== '').length)) errors.push(`SECURITY.md citation line is outside file: ${citation.path}:${citation.line}`);
      } catch { errors.push(`SECURITY.md citation escapes project root: ${citation.path}`); }
    }
    if (!reviewPathCitations(locations).length) errors.push(`SECURITY.md ${finding.severity} finding requires a relative path:line or path:deleted Location`);
  }
  const severities = new Set(findings.map((finding) => finding.severity));
  const expectedVerdict = severities.has('CRITICAL') || severities.has('HIGH') ? 'BLOCKED' : severities.has('MEDIUM') ? 'PASS-WITH-WARNINGS' : 'PASS';
  if (values.verdict && values.verdict !== expectedVerdict) errors.push('SECURITY.md verdict is inconsistent with finding severity');
  return { valid: errors.length === 0, errors, verdict: values.verdict, findings };
}

export function hashText(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function resolveContainedPath(root, candidate, { allowMissing = false } = {}) {
  const rootReal = fs.realpathSync(root);
  if (typeof candidate !== 'string' || !candidate) throw new Error('path is required');
  const rootLexical = path.resolve(root);
  const candidateAbs = path.resolve(candidate);
  const lexical = candidateAbs === rootLexical || candidateAbs.startsWith(`${rootLexical}${path.sep}`)
    ? path.join(rootReal, path.relative(rootLexical, candidateAbs))
    : path.resolve(rootReal, candidate);
  const inside = lexical === rootReal || lexical.startsWith(`${rootReal}${path.sep}`);
  if (!inside) throw new Error(`path escapes Git root: ${candidate}`);
  const parts = path.relative(rootReal, lexical).split(path.sep).filter(Boolean);
  let current = rootReal;
  for (const part of parts) {
    current = path.join(current, part);
    let stat;
    try { stat = fs.lstatSync(current); } catch (error) {
      if (error.code === 'ENOENT' && allowMissing) break;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      const target = fs.realpathSync(current);
      const targetInside = target === rootReal || target.startsWith(`${rootReal}${path.sep}`);
      if (!targetInside) throw new Error(`symlink escapes Git root: ${candidate}`);
    }
  }
  if (!allowMissing && !fs.existsSync(lexical)) throw new Error(`path does not exist: ${candidate}`);
  if (fs.existsSync(lexical)) {
    const real = fs.realpathSync(lexical);
    if (real !== rootReal && !real.startsWith(`${rootReal}${path.sep}`)) throw new Error(`path escapes Git root: ${candidate}`);
  }
  return lexical;
}

export function parsePlannedPaths(planText) {
  const paths = new Set();
  for (const line of String(planText).split(/\r?\n/)) {
    for (const match of line.matchAll(/(?:^|[`\s])((?:src|app|lib|test|tests|scripts|packages|\.planning)[A-Za-z0-9._/-]+)(?=[`\s),;:]|$)/g)) paths.add(match[1]);
  }
  return [...paths];
}

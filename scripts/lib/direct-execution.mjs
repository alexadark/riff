import crypto from 'node:crypto';

const MAX_TASKS = 64;
const MAX_WAVES = 64;
const MAX_SMOKES = 16;
const MAX_PATHS_PER_TASK = 64;

function fail(message) { throw new Error(`direct execution specification ${message}`); }

function exactKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) fail(`${label} must contain exactly ${wanted.join(', ')}`);
}

function boundedLine(value, label, maximum = 1200) {
  if (typeof value !== 'string' || value.trim() !== value || !value || value.length > maximum || /[\r\n]/.test(value)) {
    fail(`${label} must be one non-empty bounded line`);
  }
  return value;
}

function productPath(value, label) {
  const candidate = boundedLine(value, label, 512);
  if (candidate.includes('\\') || candidate.includes('\u0000') || candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate)) {
    fail(`${label} must be project-root-relative and use forward slashes`);
  }
  const parts = candidate.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail(`${label} contains an unsafe path segment`);
  if (['.git', '.planning', '.riff'].includes(parts[0])) fail(`${label} must identify product work, not RIFF or Git state`);
  return candidate;
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

function normalizeExpect(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const keys = Object.keys(value).sort();
  if (!keys.length || keys.some((key) => !['exit_code', 'stdout_includes'].includes(key))) {
    fail(`${label} may contain only exit_code and stdout_includes`);
  }
  if (!Number.isInteger(value.exit_code) || value.exit_code < 0 || value.exit_code > 255) {
    fail(`${label}.exit_code must be an integer from 0 through 255`);
  }
  const normalized = { exit_code: value.exit_code };
  if (Object.prototype.hasOwnProperty.call(value, 'stdout_includes')) {
    if (!Array.isArray(value.stdout_includes) || !value.stdout_includes.length || value.stdout_includes.length > 32
      || value.stdout_includes.some((item) => typeof item !== 'string' || !item || item.length > 1000 || /[\r\n]/.test(item))) {
      fail(`${label}.stdout_includes must be a bounded non-empty string array`);
    }
    normalized.stdout_includes = [...value.stdout_includes];
  }
  return normalized;
}

export function normalizeDirectExecution(value, { allowAbsent = true } = {}) {
  if (value === undefined || value === null) {
    if (allowAbsent) return null;
    fail('is required');
  }
  exactKeys(value, ['mode', 'tasks', 'waves', 'smoke'], 'root');
  if (value.mode !== 'direct') fail('mode must be exactly direct');
  if (!Array.isArray(value.tasks) || !value.tasks.length || value.tasks.length > MAX_TASKS) {
    fail(`tasks must contain between 1 and ${MAX_TASKS} entries`);
  }
  const owned = [];
  const titles = new Set();
  const tasks = value.tasks.map((task, index) => {
    const label = `task ${index + 1}`;
    exactKeys(task, ['title', 'owned_paths', 'outcome'], label);
    const title = boundedLine(task.title, `${label}.title`, 240);
    const outcome = boundedLine(task.outcome, `${label}.outcome`);
    if (titles.has(title)) fail(`${label}.title is duplicated`);
    titles.add(title);
    if (!Array.isArray(task.owned_paths) || !task.owned_paths.length || task.owned_paths.length > MAX_PATHS_PER_TASK) {
      fail(`${label}.owned_paths must contain between 1 and ${MAX_PATHS_PER_TASK} paths`);
    }
    const ownedPaths = task.owned_paths.map((entry, pathIndex) => productPath(entry, `${label}.owned_paths[${pathIndex}]`));
    if (new Set(ownedPaths).size !== ownedPaths.length) fail(`${label}.owned_paths contains duplicates`);
    for (const current of ownedPaths) {
      const conflict = owned.find((entry) => pathsOverlap(entry.path, current));
      if (conflict) fail(`${label}.owned_paths overlaps task ${conflict.task}: ${current}`);
      owned.push({ path: current, task: index + 1 });
    }
    return { title, owned_paths: ownedPaths, outcome };
  });

  if (!Array.isArray(value.waves) || !value.waves.length || value.waves.length > MAX_WAVES) {
    fail(`waves must contain between 1 and ${MAX_WAVES} entries`);
  }
  const seenTasks = new Set();
  const waves = value.waves.map((wave, index) => {
    if (!Array.isArray(wave) || !wave.length || wave.length > tasks.length) fail(`wave ${index + 1} must be a non-empty task-number array`);
    const normalized = wave.map((number) => {
      if (!Number.isInteger(number) || number < 1 || number > tasks.length) fail(`wave ${index + 1} references an invalid task number`);
      if (seenTasks.has(number)) fail(`wave ${index + 1} repeats task ${number}`);
      seenTasks.add(number);
      return number;
    });
    return normalized;
  });
  if (seenTasks.size !== tasks.length) fail('waves must assign every task exactly once');

  if (!Array.isArray(value.smoke) || value.smoke.length < 2 || value.smoke.length > MAX_SMOKES) {
    fail(`smoke must contain between 2 and ${MAX_SMOKES} entries`);
  }
  const smokeIdentities = new Set();
  const smoke = value.smoke.map((entry, index) => {
    const label = `smoke ${index + 1}`;
    exactKeys(entry, ['argv', 'expect'], label);
    if (!Array.isArray(entry.argv) || !entry.argv.length || entry.argv.length > 64
      || entry.argv.some((argument) => typeof argument !== 'string' || !argument || argument.length > 1000 || /[\r\n]/.test(argument))) {
      fail(`${label}.argv must be a bounded non-empty string array`);
    }
    const normalized = { argv: [...entry.argv], expect: normalizeExpect(entry.expect, `${label}.expect`) };
    const identity = JSON.stringify(normalized);
    if (smokeIdentities.has(identity)) fail(`${label} duplicates an earlier argv and expectation`);
    smokeIdentities.add(identity);
    return normalized;
  });
  return Object.freeze({ mode: 'direct', tasks, waves, smoke });
}

export function directExecutionSha256(value) {
  const normalized = normalizeDirectExecution(value, { allowAbsent: false });
  return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function renderDirectPlan(value, { phase, requestSha256 }) {
  const execution = normalizeDirectExecution(value, { allowAbsent: false });
  const taskText = execution.tasks.map((task, index) => [
    `### Task ${index + 1}: ${task.title}`,
    `Owned paths: ${JSON.stringify(task.owned_paths)}`,
    '',
    task.outcome,
  ].join('\n')).join('\n\n');
  const waveText = execution.waves.map((wave, index) => {
    const noun = wave.length === 1 ? 'Task' : 'Tasks';
    return `- Wave ${index + 1}: ${noun} ${wave.join(', ')}.`;
  }).join('\n');
  const allowedPaths = execution.tasks.flatMap((task) => task.owned_paths);
  const smokeText = execution.smoke.map((entry) => `- ${JSON.stringify(entry)}`).join('\n');
  return `# Plan\n\n## Tasks\n\n${taskText}\n\n## Waves\n\n${waveText}\n\n## Identity\n\n${JSON.stringify({ phase, request_sha256: requestSha256 })}\n\n## Boundaries\n\n${JSON.stringify({ allowed_paths: allowedPaths })}\n\n## Smoke\n\n${smokeText}\n`;
}

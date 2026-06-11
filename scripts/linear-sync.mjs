#!/usr/bin/env node
// RIFF <-> Linear integration: API client and command surface.
//
// T1 implements `setup`. T2 extends this file with pullRequests(),
// pushPhase() and updateRequestStatus(); the GraphQL helper, env loader,
// config and ledger helpers below are shared by all of them.

import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeJson, readJsonIfExists } from './lib/artifacts.mjs';

export const LINEAR_API_URL = 'https://api.linear.app/graphql';
export const CONFIG_PATH = '.planning/linear.json';
export const STATE_PATH = '.planning/linear-state.json';
export const DEFAULT_API_KEY_ENV = 'LINEAR_API_KEY';
export const REQUESTS_PROJECT_NAME = 'Requests';
export const ROADMAP_PROJECT_NAME = 'Roadmap';

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

// --- Environment ------------------------------------------------------------

// Minimal .env loader (no dependency). Only fills vars not already set in the
// real environment, so an exported var always wins over the file.
export function loadDotEnv(projectRoot) {
  const envPath = path.resolve(projectRoot, '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function resolveApiKey(projectRoot, apiKeyEnv = DEFAULT_API_KEY_ENV) {
  loadDotEnv(projectRoot);
  const key = process.env[apiKeyEnv];
  if (!key || !key.trim()) {
    fail(
      `Missing Linear API key. Set ${apiKeyEnv} in your environment or in a .env ` +
        `file at the repo root (see .env.example). Create the key at Linear -> ` +
        `Settings -> API -> Personal API keys.`,
    );
  }
  return key.trim();
}

// --- GraphQL ----------------------------------------------------------------

// Single request path. Validates the HTTP status, JSON shape and GraphQL
// errors so every caller can trust the returned `data` object.
export async function linearRequest(apiKey, query, variables = {}) {
  let response;
  try {
    response = await fetch(LINEAR_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (error) {
    fail(`Could not reach Linear (${LINEAR_API_URL}): ${error.message}`);
  }
  if (response.status === 401 || response.status === 403) {
    fail('Linear rejected the API key (HTTP ' + response.status + '). Check the key value.');
  }
  if (!response.ok) {
    fail(`Linear API returned HTTP ${response.status} ${response.statusText}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    fail('Linear API returned a response that was not valid JSON.');
  }
  if (Array.isArray(payload.errors) && payload.errors.length > 0) {
    const messages = payload.errors
      .map((entry) => (entry && typeof entry.message === 'string' ? entry.message : 'unknown error'))
      .join('; ');
    fail(`Linear API error: ${messages}`);
  }
  if (!payload.data || typeof payload.data !== 'object') {
    fail('Linear API response was missing the expected "data" object.');
  }
  return payload.data;
}

// Defensive accessor for a GraphQL connection ({ nodes: [...] }).
function expectNodes(value, label) {
  if (!value || !Array.isArray(value.nodes)) {
    fail(`Linear response had an unexpected shape for ${label}.`);
  }
  return value.nodes;
}

// --- Config -----------------------------------------------------------------

export function readConfig(projectRoot) {
  const config = readJsonIfExists(projectRoot, CONFIG_PATH);
  if (config.error) {
    fail(`${CONFIG_PATH} is not valid JSON: ${config.error.message}`);
  }
  return config.exists ? config.value : undefined;
}

// --- Interactive helpers ----------------------------------------------------

async function askChoice(rl, question, choices, defaultValue) {
  const rendered = choices.map((choice) => (choice === defaultValue ? `${choice}*` : choice)).join('/');
  while (true) {
    const answer = (await rl.question(`${question} (${rendered}): `)).trim();
    const value = answer || defaultValue;
    if (choices.includes(value)) return value;
    output.write(`Choose one of: ${choices.join(', ')}\n`);
  }
}

async function pickFromList(rl, label, items, render) {
  items.forEach((item, index) => {
    output.write(`  ${index + 1}. ${render(item)}\n`);
  });
  while (true) {
    const answer = (await rl.question(`${label} (1-${items.length}): `)).trim();
    const choice = Number.parseInt(answer, 10);
    if (Number.isInteger(choice) && choice >= 1 && choice <= items.length) {
      return items[choice - 1];
    }
    output.write(`Enter a number between 1 and ${items.length}.\n`);
  }
}

// --- Setup queries ----------------------------------------------------------

const VIEWER_QUERY = `query { viewer { id name email } }`;
const TEAMS_QUERY = `query { teams(first: 100) { nodes { id name key } } }`;
const TEAM_PROJECTS_QUERY = `query($id: String!) {
  team(id: $id) { projects(first: 250) { nodes { id name } } }
}`;
const USERS_QUERY = `query { users(first: 250) { nodes { id name email active } } }`;
const PROJECT_CREATE = `mutation($input: ProjectCreateInput!) {
  projectCreate(input: $input) { success project { id name } }
}`;

async function resolveProject(rl, apiKey, teamId, projectName, existingProjects) {
  const matches = existingProjects.filter(
    (project) => project.name.toLowerCase() === projectName.toLowerCase(),
  );
  if (matches.length === 1) {
    output.write(`Using existing "${matches[0].name}" project.\n`);
    return matches[0];
  }
  if (matches.length > 1) {
    return pickFromList(rl, `Multiple "${projectName}" projects found, pick one`, matches, (p) => p.name);
  }
  const create = await askChoice(
    rl,
    `No "${projectName}" project in this team. Create it?`,
    ['yes', 'no'],
    'yes',
  );
  if (create === 'no') {
    if (existingProjects.length === 0) {
      fail(`No projects to choose from and creation declined; cannot map "${projectName}".`);
    }
    return pickFromList(rl, `Pick the project to use for "${projectName}"`, existingProjects, (p) => p.name);
  }
  const data = await linearRequest(apiKey, PROJECT_CREATE, {
    input: { name: projectName, teamIds: [teamId] },
  });
  const result = data.projectCreate;
  if (!result || result.success !== true || !result.project || !result.project.id) {
    fail(`Linear did not confirm creation of the "${projectName}" project.`);
  }
  output.write(`Created "${result.project.name}" project.\n`);
  return result.project;
}

async function runSetup(projectRoot) {
  if (!input.isTTY || !output.isTTY) {
    fail('`riff linear setup` is interactive; run it from a terminal.');
  }

  const apiKey = resolveApiKey(projectRoot);

  const existing = readConfig(projectRoot);
  const rl = createInterface({ input, output });
  try {
    if (existing) {
      const replace = await askChoice(rl, `${CONFIG_PATH} already exists. Replace it?`, ['no', 'yes'], 'no');
      if (replace === 'no') {
        output.write('Kept existing Linear config.\n');
        return;
      }
    }

    // 1. Validate the key and confirm the owner identity.
    const viewerData = await linearRequest(apiKey, VIEWER_QUERY);
    const viewer = viewerData.viewer;
    if (!viewer || !viewer.id) {
      fail('Linear viewer query returned no user; the key may be invalid.');
    }
    output.write(`Authenticated as ${viewer.name} <${viewer.email}>.\n`);

    // 2. Choose the team that will hold the Requests + Roadmap projects.
    const teams = expectNodes((await linearRequest(apiKey, TEAMS_QUERY)).teams, 'teams');
    if (teams.length === 0) {
      fail('No Linear teams found for this key.');
    }
    const team =
      teams.length === 1
        ? teams[0]
        : await pickFromList(rl, 'Pick the team for the RIFF projects', teams, (t) => `${t.name} (${t.key})`);
    output.write(`Using team ${team.name} (${team.key}).\n`);

    // 3. Resolve (or create) both projects within that team.
    const projects = expectNodes(
      (await linearRequest(apiKey, TEAM_PROJECTS_QUERY, { id: team.id })).team?.projects,
      'team projects',
    );
    const requestsProject = await resolveProject(rl, apiKey, team.id, REQUESTS_PROJECT_NAME, projects);
    const roadmapProject = await resolveProject(rl, apiKey, team.id, ROADMAP_PROJECT_NAME, projects);

    // 4. Record the partner whose issues RIFF will ingest.
    const users = expectNodes((await linearRequest(apiKey, USERS_QUERY)).users, 'users')
      .filter((user) => user.active !== false)
      .filter((user) => user.id !== viewer.id);
    let partnerUserId;
    if (users.length === 0) {
      output.write('No other workspace members found; you can set partnerUserId later in the config.\n');
      partnerUserId = '';
    } else {
      const partner = await pickFromList(
        rl,
        'Pick the partner who files requests',
        users,
        (u) => `${u.name} <${u.email}>`,
      );
      partnerUserId = partner.id;
    }

    // 5. Persist the config.
    const config = {
      apiKeyEnv: DEFAULT_API_KEY_ENV,
      teamId: team.id,
      teamKey: team.key,
      projects: {
        requests: requestsProject.id,
        roadmap: roadmapProject.id,
      },
      partnerUserId,
      viewerId: viewer.id,
    };
    writeJson(projectRoot, CONFIG_PATH, config);
    output.write(`Wrote ${CONFIG_PATH}.\n`);
    if (!partnerUserId) {
      output.write('Remember to fill in "partnerUserId" before running `riff linear pull`.\n');
    }
  } finally {
    rl.close();
  }
}

// --- CLI dispatch -----------------------------------------------------------

const USAGE = `Usage: riff linear <command>

Commands:
  setup    Validate the API key, pick/create the Requests + Roadmap projects,
           record the partner user id, and write ${CONFIG_PATH}
`;

export async function main() {
  const argv = process.argv.slice(2);
  const sub = argv[0];

  if (!sub || sub === '-h' || sub === '--help') {
    process.stdout.write(USAGE);
    process.exit(sub ? 0 : 1);
  }

  const projectRoot = process.cwd();

  if (sub === 'setup') {
    await runSetup(projectRoot);
    return;
  }

  process.stderr.write(`Unknown linear command: ${sub}\n`);
  process.exit(1);
}

// Run only when invoked directly (not when imported by T2 code or tests).
if (process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('scripts', 'linear-sync.mjs'))) {
  await main();
}

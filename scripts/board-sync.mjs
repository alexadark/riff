#!/usr/bin/env node
//
// board-sync.mjs — sync a RIFF project's ROADMAP.yaml into riff-board via its
// HTTP sync API, so the project shows up on https://riff-boards.vercel.app.
//
// Usage:
//   node ~/DEV/frameworks/riff/scripts/board-sync.mjs [path-to-repo] [--prune] [--dry-run]
//
// path-to-repo defaults to the current working directory. The script looks
// for <path-to-repo>/ROADMAP-board.yaml first (a curated slice for projects
// whose full ROADMAP.yaml is huge or non-standard); if that file doesn't
// exist, it falls back to <path-to-repo>/ROADMAP.yaml.
//
// RIFF_BOARD_URL and RIFF_BOARD_SYNC_TOKEN must be set in the environment (see
// scripts/README-board-sync.md for setup). Neither is required for --dry-run.
//
// Expected ROADMAP.yaml shape (additional RIFF-technical fields — priority,
// mode, depends_on, tags, etc. — are read and ignored):
//
//   name: "Riff Board"
//   description: "Partner Kanban + inbox for RIFF projects"
//   github: "https://github.com/alexadark/riff-board"  # optional
//   board:
//     slug: "riff-board"        # optional; derived from name via kebab-case if omitted
//   phases:
//     - id: 1
//       slug: "auth-multi-user" # required — used as the phaseId upsert key
//       title: "Sign in without password"
//       status: done            # todo | in-progress | done | blocked | skipped
//       description: |          # optional; becomes the phase body (markdown)
//         Alex and Ian can log in by picking their name.
//
// Status mapping (YAML -> board):
//   todo         -> planned
//   in-progress  -> doing
//   done         -> shipped
//   blocked      -> waiting
//   skipped      -> waiting
//
// Flags:
//   --dry-run   parse + validate only, print the planned upserts, send nothing to the board
//   --prune     ask the board to delete roadmap items for this project that are no
//               longer present in the YAML. Prints the list and asks for interactive
//               confirmation before sending prune: true.
//
// What this script does NOT do (yet): it never deletes anything without --prune, and it
// never writes back from the board to ROADMAP.yaml — sync is one-directional, YAML -> board.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import yaml from "js-yaml";

const STATUS_MAP = {
  todo: "planned",
  "in-progress": "doing",
  done: "shipped",
  blocked: "waiting",
  skipped: "waiting",
};

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function kebabCase(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseArgs(argv) {
  const flags = new Set();
  const positional = [];
  for (const arg of argv) {
    if (arg.startsWith("--")) flags.add(arg.slice(2));
    else positional.push(arg);
  }
  return { positional, prune: flags.has("prune"), dryRun: flags.has("dry-run") };
}

async function confirmPrune(question) {
  if (!input.isTTY || !output.isTTY) {
    fail(`${question}\nRefusing to prompt in a non-interactive shell — re-run from a terminal to confirm --prune.`);
  }
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${question} (yes/no): `)).trim().toLowerCase();
    return answer === "yes" || answer === "y";
  } finally {
    rl.close();
  }
}

function loadRoadmap(yamlPath) {
  if (!existsSync(yamlPath)) {
    fail(`No ROADMAP.yaml found at ${yamlPath}`);
  }

  let doc;
  try {
    doc = yaml.load(readFileSync(yamlPath, "utf8"));
  } catch (err) {
    fail(`Failed to parse ${yamlPath}: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (!doc || typeof doc !== "object") {
    fail(`${yamlPath} did not parse to an object.`);
  }
  if (!doc.name || typeof doc.name !== "string") {
    fail(`${yamlPath} is missing required field "name".`);
  }
  if (!Array.isArray(doc.phases) || doc.phases.length === 0) {
    fail(`${yamlPath} has no "phases" list.`);
  }

  const displayName = doc.name;
  const slug = doc.board?.slug ?? kebabCase(displayName);
  const githubUrl = typeof doc.github === "string" && doc.github.trim() ? doc.github.trim() : undefined;

  const phases = doc.phases.map((phase, index) => {
    if (!phase.slug || typeof phase.slug !== "string") {
      fail(`Phase "${phase.title ?? phase.id ?? index}" in ${yamlPath} is missing required field "slug".`);
    }
    const mappedStatus = STATUS_MAP[phase.status];
    if (!mappedStatus) {
      fail(
        `Phase "${phase.slug}" in ${yamlPath} has unknown status "${phase.status}". Expected one of: ${Object.keys(STATUS_MAP).join(", ")}`,
      );
    }
    const phasePayload = {
      phaseId: phase.slug,
      title: phase.title ?? phase.slug,
      status: mappedStatus,
      orderIndex: String(phase.id ?? index + 1),
    };
    if (phase.description) phasePayload.body = phase.description;
    return phasePayload;
  });

  return { displayName, slug, githubUrl, phases };
}

async function postRoadmap({ boardUrl, token, project, phases, prune }) {
  const endpoint = `${boardUrl.replace(/\/+$/, "")}/api/sync/roadmap`;
  const body = { project, phases, prune };

  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    fail(`Failed to reach ${endpoint}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const text = await res.text();
  if (!res.ok) {
    fail(`Sync request failed: ${res.status} ${res.statusText}\n${text}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    fail(`Sync request returned a non-JSON response (${res.status}):\n${text}`);
  }

  return data;
}

async function main() {
  const { positional, prune, dryRun } = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(positional[0] ?? process.cwd());
  const boardYamlPath = path.join(targetDir, "ROADMAP-board.yaml");
  const yamlPath = existsSync(boardYamlPath) ? boardYamlPath : path.join(targetDir, "ROADMAP.yaml");

  console.log(`Reading: ${path.basename(yamlPath)}`);

  const { displayName, slug, githubUrl, phases } = loadRoadmap(yamlPath);

  console.log(`Project: ${displayName}`);
  console.log(`Slug: ${slug}`);
  console.log(`Phases in YAML: ${phases.length}`);

  if (dryRun) {
    console.log("\n[dry run] would sync:");
    for (const phase of phases) {
      console.log(`  - ${phase.phaseId} (${phase.status}): ${phase.title}`);
    }
    if (prune) {
      console.log("\n[dry run] --prune was passed: the live run would ask the board to remove any");
      console.log("phases missing from this list, after an interactive confirmation.");
    }
    console.log("\n[dry run] no HTTP request sent.");
    return;
  }

  const boardUrl = process.env.RIFF_BOARD_URL;
  const token = process.env.RIFF_BOARD_SYNC_TOKEN;

  if (!boardUrl || !token) {
    fail(
      [
        "RIFF_BOARD_URL and/or RIFF_BOARD_SYNC_TOKEN is not set.",
        "",
        "Set both before running this script, for example:",
        '  export RIFF_BOARD_URL="https://riff-boards.vercel.app"',
        '  export RIFF_BOARD_SYNC_TOKEN="..."   # the SYNC_API_TOKEN value from the board\'s Vercel env',
        "",
        "Or run with --dry-run to validate ROADMAP.yaml without contacting the board.",
      ].join("\n"),
    );
  }

  let confirmedPrune = false;
  if (prune) {
    console.log("\n--prune was passed: the board will be asked to remove any roadmap items for this");
    console.log("project that are not in the phase list above.");
    confirmedPrune = await confirmPrune("Send prune request to the board?");
    if (!confirmedPrune) {
      console.log("Prune cancelled — syncing without prune.");
    }
  }

  const project = { slug, displayName };
  if (githubUrl) project.githubUrl = githubUrl;

  const result = await postRoadmap({
    boardUrl,
    token,
    project,
    phases,
    prune: confirmedPrune,
  });

  if (!result || result.ok !== true) {
    fail(`Sync request did not confirm success:\n${JSON.stringify(result, null, 2)}`);
  }

  console.log(`\nSynced project ${slug} (id: ${result.projectId}).`);
  console.log(`Phases upserted: ${result.phasesUpserted ?? phases.length}`);
  if (typeof result.phasesRemoved === "number") {
    console.log(`Phases removed: ${result.phasesRemoved}`);
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});

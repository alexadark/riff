# board-sync.mjs

Syncs a RIFF project's `ROADMAP.yaml` into riff-board via its HTTP sync API, so the
project's phases show up as roadmap cards at https://riff-boards.vercel.app.

The script talks to the board over HTTP only. It never connects to the board's database
directly, so `DATABASE_URL` never needs to exist outside the board app itself (in
particular, it is never needed in a project repo's CI).

## What it does

1. Reads `ROADMAP-board.yaml` from a target repo if it exists; otherwise falls back to
   `ROADMAP.yaml`. Prints which file it read (e.g. `Reading: ROADMAP-board.yaml`).
2. Validates it and maps each phase's status to the board's status vocabulary.
3. POSTs the project + phases to `${RIFF_BOARD_URL}/api/sync/roadmap`, authenticated with
   a bearer token.
4. Prints a summary of what the board reports it upserted (and removed, if `--prune`).

It never asks the board to delete anything unless you pass `--prune`, and it never writes
back from the board into `ROADMAP.yaml` — sync is one-directional, YAML into the board.

## How to run it

From the root of a repo that has a `ROADMAP.yaml`:

```bash
node ~/DEV/frameworks/riff/scripts/board-sync.mjs
```

Or point it at another repo:

```bash
node ~/DEV/frameworks/riff/scripts/board-sync.mjs /path/to/other-repo
```

Add `--dry-run` to see what would be synced without making any HTTP request:

```bash
node ~/DEV/frameworks/riff/scripts/board-sync.mjs --dry-run
```

`--dry-run` only parses and validates the YAML — it does not require
`RIFF_BOARD_URL`/`RIFF_BOARD_SYNC_TOKEN` to be set.

## Setting RIFF_BOARD_URL and RIFF_BOARD_SYNC_TOKEN

The script needs two environment variables for a live sync:

- `RIFF_BOARD_URL` — the board app's base URL, e.g. `https://riff-boards.vercel.app`.
- `RIFF_BOARD_SYNC_TOKEN` — the `SYNC_API_TOKEN` value from the board's Vercel environment
  variables. Sent as `Authorization: Bearer ${RIFF_BOARD_SYNC_TOKEN}`.

```bash
export RIFF_BOARD_URL="https://riff-boards.vercel.app"
export RIFF_BOARD_SYNC_TOKEN="..."
node ~/DEV/frameworks/riff/scripts/board-sync.mjs
```

If either is missing (and `--dry-run` was not passed), the script prints this guidance and
exits non-zero — it never silently falls back to anything, and it never touches a database
connection string.

## ROADMAP-board.yaml fallback

Some projects have a large, non-standard `ROADMAP.yaml` that can't be converted wholesale
to the board's format (for example, a roadmap with dozens of ad-hoc `phase-N:` keys and
extra fields the board doesn't understand). For those projects, create a
`ROADMAP-board.yaml` alongside the original `ROADMAP.yaml` — a curated slice in the
standard format below (see it for the exact shape). The script prefers
`<repo>/ROADMAP-board.yaml` when it exists and only falls back to `<repo>/ROADMAP.yaml`
when it doesn't. The original `ROADMAP.yaml` is never read or modified when a
`ROADMAP-board.yaml` is present.

## ROADMAP.yaml format expected

```yaml
name: "Riff Board"
description: "Partner Kanban + inbox for RIFF projects"
github: "https://github.com/alexadark/riff-board"  # optional; becomes project.githubUrl
board:
  slug: "riff-board"   # optional; if omitted, derived from name via kebab-case
phases:
  - id: 1
    slug: "auth-multi-user"    # required — used as the phaseId upsert key
    title: "Sign in without password"
    status: done                # todo | in-progress | done | blocked | skipped
    description: |              # optional; becomes the phase body (markdown)
      Alex and Ian can log in by picking their name.
    # Additional RIFF-technical fields (priority, mode, depends_on, tags, milestone,
    # etc.) are read and ignored — they don't affect the board.
```

Required fields:

- `name` (project) — top level.
- `slug` (per phase) — this is the stable key the sync upserts on. Renaming a phase's
  `slug` in the YAML creates a new roadmap item on the board rather than updating the
  old one; treat `slug` as permanent once a phase exists.

If `github` is omitted, `project.githubUrl` is left out of the request body entirely
(never sent as an empty string).

## Status mapping

| ROADMAP.yaml status | Board status |
| -------------------- | ------------- |
| `todo`               | `planned`     |
| `in-progress`        | `doing`       |
| `done`                | `shipped`     |
| `blocked`             | `waiting`     |
| `skipped`             | `waiting`     |

## The `--prune` flag

By default, phases that exist on the board but are no longer in the YAML are left alone
(safest default — nothing disappears from the board without you asking for it). Pass
`--prune` to also clean those up:

```bash
node ~/DEV/frameworks/riff/scripts/board-sync.mjs --prune
```

With `--prune`, the script asks for an interactive `yes`/`no` confirmation in the terminal
before sending `prune: true` in the request body — the board only deletes roadmap items
missing from the YAML after that confirmation is given. It refuses to prompt (and exits
non-zero) if stdin/stdout are not a real TTY, so `--prune` can never silently delete rows
in a non-interactive context (CI, a piped command, etc.). If you decline the confirmation,
the script still syncs normally, just with `prune: false`.

## API contract

`POST ${RIFF_BOARD_URL}/api/sync/roadmap`

Headers: `Authorization: Bearer ${RIFF_BOARD_SYNC_TOKEN}`, `Content-Type: application/json`.

Request body:

```json
{
  "project": {
    "slug": "riff-board",
    "displayName": "Riff Board",
    "githubUrl": "https://github.com/alexadark/riff-board"
  },
  "phases": [
    {
      "phaseId": "auth-multi-user",
      "title": "Sign in without password",
      "status": "shipped",
      "body": "Alex and Ian can log in by picking their name.",
      "orderIndex": "1"
    }
  ],
  "prune": false
}
```

On success (`200`), the board responds:

```json
{ "ok": true, "projectId": "...", "phasesUpserted": 5, "phasesRemoved": 0 }
```

On any non-2xx response, the script prints the status code and response body, then exits 1.

## Automating sync from a project repo's CI

Copy `templates/board-sync.yml` from this repo into the project repo as
`.github/workflows/board-sync.yml`, and set two repo secrets: `RIFF_BOARD_URL` and
`RIFF_BOARD_SYNC_TOKEN`. See that template file for the full workflow and a note about the
`riff` repo's visibility (public vs private) affecting how the template downloads
`board-sync.mjs`.

## What's not supported yet

Writing back from the board to `ROADMAP.yaml` — for example, if a partner edits a phase's
title or status directly on the board, that change does not flow back into the YAML file
in the repo. Sync today is one-directional (YAML → board). Two-way sync is a planned next
pass, not yet implemented.

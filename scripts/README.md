# RIFF scripts

This is the supported script reference. Script internals under `scripts/lib/` are implementation details.

## Runtime and installation

| Script | Usage | Purpose |
| --- | --- | --- |
| `riff-init.mjs` | `riff init [options]` | Installs RIFF into a normal Git checkout. Creates `.riff`, planning scaffolding, Claude runtime links, project-local Codex skills, and materialized Codex route adapters. |
| `../riff` | `riff next --phase <id> --task <bounded-request>` | Runs one native stage through the provider selected by the active profile. |
| `../riff` | `riff phase <list|add|set-status>` | Manages roadmap phases with full-roadmap validation and rollback on invalid edits. |
| `../riff` | `riff status [--json]` | Reports authoritative roadmap, wave, stage, and next-action state. |
| `../riff` | `riff wave --autonomous [--loop]` | Runs ready roadmap work and persists an `awaiting_human` verification request only at explicit dependency-ready confirmation boundaries. |
| `../riff` | `riff wave --approve --run <id> --phase <id> --evidence "Checked: <scope>; Observed: <result>; Expected: <expected result>"` | Validates the immutable request, records a bound approval receipt, and continues the same wave run. |
| `../riff` | `riff finish --check [--run <id>] [--base <branch>] [--json]` | Builds a read-only, token-bound Git plan from a completed wave's final security evidence. It never changes Git or artifacts. |
| `../riff` | `riff finish --confirm <token> [--run <id>] [--base <branch>]` | Rebuilds the plan, then commits only its exact paths. `github_button` opens or reuses a PR without merging; `local_no_ff` performs the explicitly confirmed local merge. |
| `../riff` | `riff resync` | Reconciles RIFF-owned runtime links after RIFF changes. |
| `../riff` | `riff doctor [--ci]` | Checks framework citations, adapter contracts, and profile reads. `--ci` fails only on errors. |
| `../riff-resync.sh` | Internal implementation, do not invoke directly | Implements the `riff resync` CLI operation. Use `riff resync`, `$resync`, `$riff:resync`, or `/riff:resync`. |

`riff init` options are `--scope <production|scratch>`, `--project-root <path>`, `--force`, `--profile <default|custom|skip>`, and `--no-onboard`.

`riff init` does not support Git linked worktrees. It preserves unowned runtime collisions unless `--force` applies.

## Native stage runner

| Script | Usage | Purpose |
| --- | --- | --- |
| `riff-next.mjs` | Internal target behind `riff next` | Runs native control, Codex direct or explicit provider planning, ordered waves with bounded parallel workers, gates, fresh code review, and completed-state flow. |
| `riff-next-stage.mjs` | Internal stage-state module | Defines validated state transitions and phase locking. Don't invoke it for normal work. |
| `artifact-check.mjs` | `node scripts/artifact-check.mjs [--project-root <framework-root>]` | Validates active skills, canonical roles, provider mappings, adapter routes, and plugin metadata. |
| `scope-check.mjs` | `node .riff/scripts/scope-check.mjs --project-root <git-root> --phase <id> --worker-delta <path>` | Compares actual worker changes with validated plan boundaries. |

`riff next` is the shared entry point behind the native skill. It requires explicit phase and task values, reads `runtime.provider` from the active profile, and has no implicit resume flag. `--provider codex|claude` is an explicit one-run override, not fallback.

Production model and smoke dispatches require Darwin. The runner fails closed on other platforms.
The current Claude route still requires the Codex CLI as the mechanical sandbox helper for planned smokes, but it does not dispatch Codex models.

## Supporting scripts

| Script | Usage | Purpose |
| --- | --- | --- |
| `dashboard.sh` | `riff dashboard [--stop]` | Starts or stops the local RIFF dashboard. |
| `linear-sync.mjs` | `riff linear <setup>` | Runs the supported Linear synchronization entry point. |
| `riff-codex.mjs` | `node scripts/riff-codex.mjs <command> [options]` | Generates or runs legacy Codex context-pack capabilities. It isn't the native `$riff:next` runner. |
| `riff-opus-prompt.mjs` | `node scripts/riff-opus-prompt.mjs ...` | Generates explicit manual Claude Opus prompt packs. It doesn't bypass RIFF gates. |
| `riff-pr-metadata.sh` | `scripts/riff-pr-metadata.sh <phase-id>` | Generates optional historical PR metadata from existing phase artifacts. It isn't part of the native next completion path. |
| `csv-append.sh` | `bash scripts/csv-append.sh <csv-file> <row>` | Appends a CSV row under a best-effort or `flock` lock. |

Other scripts support older autonomy, board, gate, and integration features. They are not part of the active native `$riff:next` slice unless a separate protocol explicitly selects them.

## Verification

Run the narrowest relevant check after changing a script. For framework-wide contract changes:

```bash
node scripts/artifact-check.mjs
./riff doctor --ci
git diff --check
```

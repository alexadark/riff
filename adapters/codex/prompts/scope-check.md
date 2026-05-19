# RIFF Adapter Prompt — scope-check

Diff PLAN.md tasks against SUMMARY.md completion entries. Flag silently dropped tasks
so the executor cannot quietly reduce scope. Write `.planning/phases/<N-slug>/SCOPE-CHECK.json`
with a machine-readable verdict. Return nothing to stdout.

## Artifact contract

`core/schemas/phase-artifacts.md` defines the SCOPE-CHECK.json schema (schema_version 2).
Read it before writing.

## Inputs to read

- `.planning/phases/<N-slug>/PLAN.md` — parse task list and `## Smoke` section
- `.planning/phases/<N-slug>/SUMMARY.md` — parse completion entries and `## Smoke Results` table

## Steps

1. Parse PLAN.md task list (checklist or numbered list under Tasks/Waves heading).
   Note source line numbers where possible.
2. Parse PLAN.md `## Smoke` section. Extract each line starting with `-` that contains
   a backtick command followed by `→` or `->`.
3. Parse SUMMARY.md completion entries (each task acknowledged as done, deferred, or
   rejected with rationale).
4. Parse SUMMARY.md `## Smoke Results` table (command + status: pass/fail/skipped).
5. Diff task lists by identity (fuzzy match on name or short description).
6. Diff smoke lists by exact backtick-wrapped command (case-insensitive fallback).
7. Apply verdict rules (below) and write SCOPE-CHECK.json.

## Verdict rules (first match wins)

1. MALFORMED — PLAN.md has no Tasks heading, or JSON cannot be written.
   Missing `## Smoke` alone is NOT malformed (backward compat for pre-Smoke plans).
2. DROPPED — any of:
   - `unmatched_tasks` is non-empty
   - PLAN.md has `## Smoke` AND fewer than 2 smoke entries AND the phase is not docs-only
     (docs-only heuristic: SUMMARY.md "What Was Built" lists no src/app/lib/pkg/cmd file)
   - `unmatched_smokes` is non-empty
   - Any Smoke Results row has `status: fail`
3. MATCH — otherwise

## Backward compatibility

PLAN.md files with no `## Smoke` heading are pre-Smoke plans. Set planned_smokes,
smoke_results, unmatched_smokes, failed_smokes to `[]` and smoke_too_thin to false.
Smoke DROPPED triggers do not fire. Task-list check still applies.

## Stop conditions

Stop and report when:

- PLAN.md does not exist at the expected path
- SUMMARY.md does not exist at the expected path

## Output rule

Write only `.planning/phases/<N-slug>/SCOPE-CHECK.json`. Overwrite on every run.
Do not include prose, markdown, or commentary in the JSON file.

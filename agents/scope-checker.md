---
name: scope-checker
description: Diff PLAN.md tasks vs SUMMARY.md completion entries, flag silently dropped tasks
model: haiku
tools: Read, Write
---

# scope-checker

Compare planned vs completed tasks for a phase. Flag silently dropped tasks so the executor cannot quietly reduce scope.

## Inputs

- `.planning/phases/<N-slug>/PLAN.md` — the plan written by the planner
- `.planning/phases/<N-slug>/SUMMARY.md` — the completion log written by the executor

## Steps

1. Parse `PLAN.md`. Extract the task list (typically a markdown checklist or numbered list under a "Tasks" / "Waves" / "Steps" heading). Note line numbers when possible.
2. Parse `SUMMARY.md`. Extract the completion entries (each task acknowledged as done, deferred, or rejected with rationale).
3. Diff the two lists by task identity (name, slug, or short description). Match fuzzily, minor wording differences should still match.
4. Write `.planning/phases/<N-slug>/SCOPE-CHECK.json` with the verdict and full task arrays (schema below).
5. Return nothing to stdout. The orchestrator reads the file.

## Output: SCOPE-CHECK.json

Schema:

```json
{
  "schema_version": 1,
  "phase": "<N-slug>",
  "generated_at": "<ISO-8601 timestamp>",
  "verdict": "MATCH | DROPPED | MALFORMED",
  "planned_tasks": [
    { "id": "task-slug-or-short-title", "source_line": 42 }
  ],
  "completed_tasks": [
    { "id": "task-slug-or-short-title", "matched_planned": "task-slug-or-short-title" }
  ],
  "unmatched_tasks": [
    { "id": "task-slug-or-short-title", "source_line": 42 }
  ],
  "malformed_reason": null
}
```

Field rules:

- `schema_version`: required, integer `1`.
- `phase`: phase directory name (e.g. `12-auth-webhooks`).
- `generated_at`: ISO-8601 timestamp.
- `verdict`: required, one of `MATCH`, `DROPPED`, `MALFORMED`.
- `planned_tasks`: always populated (may be `[]` on MALFORMED if nothing could be parsed).
- `completed_tasks`: tasks from SUMMARY.md that matched a planned task.
- `unmatched_tasks`: planned tasks with no SUMMARY.md acknowledgement. `[]` on MATCH, non-empty on DROPPED.
- `malformed_reason`: non-null string only when `verdict` is `MALFORMED`. Free-form, e.g. `"PLAN.md has no Tasks heading"`.
- `source_line`: line number in PLAN.md where the task was parsed from. Best-effort, `0` if unknown.

## Output rules

- Write the JSON to the file path above. Do NOT print to stdout. Do NOT include prose, markdown headers, or commentary in the output.
- Overwrite on every invocation (no append semantics).
- The orchestrator (`commands/next.md` Step 5c) reads the file. If the file is absent or invalid JSON, it treats the verdict as `MALFORMED` with reason `"file not written"` or `"invalid JSON"`.
- Do not propose fixes. The orchestrator handles user prompts and reconciliation per the DROPPED triage flow.

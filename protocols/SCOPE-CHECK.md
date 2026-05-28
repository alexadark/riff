# Scope Check

Source of truth for `/riff:next` Step 5c.

RIFF uses a mechanical checker by default:

```bash
node .riff/scripts/scope-check.mjs --phase .planning/phases/<N-slug>
```

The script reads `PLAN.md` and `SUMMARY.md`, writes `SCOPE-CHECK.json`, and exits `0` only when the verdict is `MATCH`.

## Inputs

- `.planning/phases/<N-slug>/PLAN.md`
- `.planning/phases/<N-slug>/SUMMARY.md`

## Output

`SCOPE-CHECK.json` uses schema version `2`:

```json
{
  "schema_version": 2,
  "phase": "<N-slug>",
  "generated_at": "<ISO-8601 timestamp>",
  "verdict": "MATCH | DROPPED | MALFORMED",
  "planned_tasks": [{ "id": "task-title", "source_line": 42 }],
  "completed_tasks": [{ "id": "task-title", "matched_planned": "task-title" }],
  "unmatched_tasks": [{ "id": "task-title", "source_line": 42 }],
  "planned_smokes": [{ "command": "npm test", "source_line": 88 }],
  "smoke_results": [{ "command": "npm test", "status": "pass" }],
  "unmatched_smokes": [],
  "failed_smokes": [],
  "smoke_too_thin": false,
  "malformed_reason": null
}
```

## Verdict Rules

`MALFORMED`:

- `PLAN.md` has no parseable `## Tasks` section.
- `PLAN.md` or `SUMMARY.md` is missing.
- `SUMMARY.md` says `completed` while any smoke result is `fail`.

`DROPPED`:

- Any planned task is not acknowledged in `SUMMARY.md`.
- A current plan has `## Smoke`, but one or more planned smoke commands have no result row.
- Any smoke result is `fail` and `SUMMARY.md` does not correctly mark the phase as partial/blocked.
- `## Smoke` has fewer than two entries for a code-touching phase.

`MATCH`:

- Every planned task is acknowledged.
- Every planned smoke has a result.
- No smoke failed.
- Docs-only phases may use one smoke entry.

## Legacy Fallback

`agents/scope-checker.md` remains as a human-readable fallback spec for older runs or manual recovery, but it is not the default Step 5c path. When this protocol and the agent file disagree, this protocol and `scripts/scope-check.mjs` win.

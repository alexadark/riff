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
  "planned_flow_updates": [],
  "flow_manifest_changed": false,
  "missing_flow_manifest_update": false,
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
- PLAN.md has `## Flow updates` but `.uxtest/flows.yaml` is not changed in the git diff.

`MATCH`:

- Every planned task is acknowledged.
- Every planned smoke has a result.
- No smoke failed.
- Any planned `## Flow updates` section has a matching `.uxtest/flows.yaml` diff.
- Docs-only phases may use one smoke entry.

## Step 5c orchestration (verdict handling)

**Read the verdict from SCOPE-CHECK.json:**

1. Read `.planning/phases/N-slug/SCOPE-CHECK.json`.
2. If file absent → treat as `MALFORMED` with reason `"file not written"`.
3. If invalid JSON → treat as `MALFORMED` with reason `"invalid JSON"`.
4. If `schema_version` is neither `1` nor `2` → surface mismatch to user, halt. (`1` = legacy plans pre-Smoke contract, `2` = current.)
5. Branch on the `verdict` field.

**On `MATCH`:** proceed to Step 5d.

**On `DROPPED`:** STOP. Triage in three buckets, in order:

1. **Task drops (`unmatched_tasks` non-empty).** For each, AskUserQuestion: "completed (mark done in SUMMARY)" | "defer to new phase (will run /riff:add-phase)" | "rejected (write rationale)". Apply each choice, then re-run Step 5c.
2. **Smoke section too thin or missing (`smoke_too_thin == true` OR `planned_smokes` empty on a non-legacy plan).** Surface to user with the modified files list. AskUserQuestion: "ask the planner to expand Smoke section (re-run Step 4 with this finding)" | "skip this gate (run `node .riff/scripts/gates-update.mjs --phase .planning/phases/N-slug --gate scope-check --status skipped --reason "override"`)". On expand → re-run Step 4 inline with the missing-smoke finding as input, then re-run Step 5c.
3. **Flow manifest drops (`missing_flow_manifest_update == true`).** Surface that PLAN.md contains `## Flow updates` but `.uxtest/flows.yaml` is absent from the diff. AskUserQuestion: "apply flow updates now" | "remove/defer the Flow updates section from PLAN.md" | "skip this gate (run `node .riff/scripts/gates-update.mjs --phase .planning/phases/N-slug --gate scope-check --status skipped --reason "override"`)". On apply/defer → make the selected change, then re-run Step 5c.
4. **Smoke regressions or missing results (`failed_smokes` non-empty OR `unmatched_smokes` non-empty).** For each entry, surface command + observed output (for `failed_smokes`) or "no result row in SUMMARY.md" (for `unmatched_smokes`). AskUserQuestion: "auto-debug (treat as failure_type=smoke_fail, artifact=SCOPE-CHECK.json)" | "fix manually now, then re-run Step 5c" | "skip this gate (run `node .riff/scripts/gates-update.mjs --phase .planning/phases/N-slug --gate scope-check --status skipped --reason "override"`)". On auto-debug → trigger the auto-debug pattern, on RESOLVED re-run Step 5c.

Loop until `verdict == MATCH`. **Max 3 cycles per bucket**, then STOP and escalate to user with both SCOPE-CHECK.json and PLAN.md, ask whether to skip the remaining gate (run `node .riff/scripts/gates-update.mjs --phase .planning/phases/N-slug --gate scope-check --status skipped --reason "override"`) or halt for manual fix.

**On `MALFORMED`:** surface `malformed_reason` to user, ask whether to skip (acceptable for unstructured PLAN.md formats) or fix the format and retry.

## Legacy Fallback

`agents/scope-checker.md` remains as a human-readable fallback spec for older runs or manual recovery, but it is not the default Step 5c path. When this protocol and the agent file disagree, this protocol and `.riff/scripts/scope-check.mjs` win.

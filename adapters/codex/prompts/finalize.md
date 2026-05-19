# RIFF Adapter Prompt — finalize

Finalize the phase: update `STATE.md`, write `HANDOFF.md` when a context handoff is
required, and confirm all blocking gates are pass or explicitly skipped before declaring
the phase complete. Do not create the PR — PR creation is a separate step in the loop.

## Artifact contract

`core/schemas/phase-artifacts.md` defines the required fields for STATE.md, HANDOFF.md,
and the gate verdict format in GATES.md. Read it before writing.

## Inputs to read

- `.planning/phases/<N-slug>/SUMMARY.md` — what was built
- `.planning/phases/<N-slug>/GATES.md` — current gate verdicts (plan-review, scope-check,
  code-review, security-review, docs-check)
- ROADMAP.yaml — mark the phase `status: done` once all gates pass
- STATE.md — update Current Phase, Phases Completed table, Next Action
- `.planning/phases/<N-slug>/REVIEW.md` — adversarial verdict
- `.planning/phases/<N-slug>/SECURITY.md` — security verdict (read frontmatter `verdict:`)

## Gate check (required before finalizing)

All of the following must be pass or explicitly skipped in GATES.md:

| Gate | Blocking condition |
|------|--------------------|
| plan-review | REVISE verdict |
| scope-check | DROPPED or MALFORMED verdict |
| code-review | FAIL verdict |
| security-review | BLOCKED verdict (any CRITICAL or HIGH finding) |
| docs-check | Not blocking, but flag PENDING taste annotations |

If any gate is BLOCKED/FAIL/DROPPED: report the failing gate and do not finalize.
If any gate is missing from GATES.md: treat as pending and do not finalize unless the
scope is `scratch` (scratch skips heavy review gates by design).

## Commit discipline

Every commit on the phase branch must have the RIFF trailer. Verify the last commit on the
branch includes it. If the summary commit is missing the trailer, amend it:

```
Phase: <phase-id>
Wave: post-wave
Agent: executor
Model: <executor_model>
Plan: .planning/phases/<N-slug>/PLAN.md
```

## HANDOFF.md (write when context is large)

Write `.planning/phases/<N-slug>/HANDOFF.md` when the session context is at YELLOW or RED
(over 100k tokens). Include: active decisions, open buckets, files to bootstrap, resume
command for the next session.

## STATE.md update

After all gates pass:
- Update `## Current Phase` to describe the completed phase
- Append a row to `## Phases Completed` table
- Update `## Next Action` to point to the next eligible phase
- Update `## Active Phase` fields to `-` (the phase is no longer active)

## Stop conditions

Stop before writing STATE.md and report when:

- Any blocking gate is FAIL/BLOCKED/DROPPED
- SUMMARY.md does not exist (execution never completed)

## Output rule

Write `STATE.md` (update in place), and optionally `HANDOFF.md` and `ROADMAP.yaml`
(mark phase done). Do not write PLAN.md, SUMMARY.md, or implementation files.

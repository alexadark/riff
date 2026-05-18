# Codex Capability: Scope Check

Compare the plan, implementation diff, and summary for this phase.

Read:

- `core/protocols/review.md`
- `core/schemas/phase-artifacts.md`
- `.planning/phases/<phase>/PLAN.md`
- `.planning/phases/<phase>/SUMMARY.md`
- current git diff and changed file list
- `.planning/phases/<phase>/GATES.md` when present

Write:

- `.planning/phases/<phase>/SCOPE-CHECK.json`

Required JSON fields:

- `phase`
- `planPath`
- `summaryPath`
- `status`: `match`, `mismatch`, or `accepted_exception`
- `checkedAcceptanceCriteria`
- `missingItems`
- `extraChanges`
- `boundaryViolations`
- `smokeVerified`
- `notes`

Production mismatches, boundary violations, and missing planned artifacts are blocking unless a human accepted exception is recorded.

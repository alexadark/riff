# Codex Capability: Docs Check

Check whether documentation must change for this phase.

Read:

- `core/protocols/review.md`
- `.planning/phases/<phase>/PLAN.md`
- `.planning/phases/<phase>/SUMMARY.md`
- changed file list and public/operator interfaces
- docs files relevant to touched behavior

Write:

- documentation updates when required by the phase
- otherwise a docs gate result in `.planning/phases/<phase>/GATES.md`

Check changes to:

- behavior
- setup
- CLI usage
- public APIs
- architecture
- environment variables
- operator workflow

In production, stale required docs are blocking. If no docs are needed, record the reason.

Do not use provider-specific rendering or chat state to decide this gate. Base the result on durable files and the current diff.

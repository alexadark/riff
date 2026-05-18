# Codex Capability: Plan Review

Review a RIFF phase plan before execution.

Read:

- `core/protocols/review.md`
- `core/protocols/planning.md`
- `.planning/phases/<phase>/PLAN.md`
- relevant roadmap, state, and design context

Write:

- `.planning/phases/<phase>/PLAN-REVIEW.md`

Check:

- scope is bounded to one phase
- file boundaries are explicit
- acceptance criteria are observable
- smoke commands are executable and meaningful
- production gates are preserved or skips are justified
- sensitive surfaces have validation and review criteria
- no core contract is replaced by adapter-specific behavior
- gate status expectations are consistent with `GATES.md`

Return findings first, ordered by severity, then verdict: `PASS`, `REVISE`, or `FAIL`.

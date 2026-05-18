# Codex Capability: Code Review

Review phase implementation changes.

Read:

- `core/protocols/review.md`
- `.planning/phases/<phase>/PLAN.md`
- `.planning/phases/<phase>/SUMMARY.md`
- `.planning/phases/<phase>/SCOPE-CHECK.json` when present
- `.planning/phases/<phase>/GATES.md` when present
- the current diff and touched files
- smoke and test evidence

Write:

- `.planning/phases/<phase>/REVIEW.md`

Check:

- behavioral bugs and broken contracts
- missing error handling and edge cases
- task boundary violations
- mismatch between plan, diff, and summary
- failed or unverified smoke claims

Findings must lead the artifact and include file and line references when possible.

End with verdict: `PASS`, `REVISE`, or `FAIL`.

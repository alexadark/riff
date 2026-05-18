# Codex Capability: Security Review

Review phase changes for security risk.

Read:

- `core/protocols/review.md`
- `.planning/phases/<phase>/PLAN.md`
- `.planning/phases/<phase>/SUMMARY.md`
- `.planning/phases/<phase>/GATES.md` when present
- security-relevant changed files and configuration
- current diff

Write:

- `.planning/phases/<phase>/SECURITY.md`

Check:

- hardcoded secrets
- authentication and authorization boundaries
- tenant or user data scoping
- public API input validation
- payment, webhook, migration, and destructive data risks when present
- secret leakage in logs, artifacts, or generated output

Docs-only phases may return `SKIPPED` with a reason. Hardcoded secrets are blocking in every scope.

End with verdict: `PASS`, `FAIL`, or `SKIPPED`.

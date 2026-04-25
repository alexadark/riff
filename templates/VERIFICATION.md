# Verification - Phase {{PHASE_ID}}: {{PHASE_TITLE}}

> Verified: {{DATE}}
> Verifier: {{AGENT}}

## Goal Check

**Original goal:** {{PHASE_GOAL}}
**Achieved:** YES / NO / PARTIAL

## 3-Level Artifact Check

| Artifact | Exists? | Substantive? | Wired? | Evidence |
| -------- | ------- | ------------ | ------ | -------- |
|          |         |              |        |          |

### Level definitions:

- **Exists** - File is present on disk at the expected path
- **Substantive** - File contains real implementation, not a stub/placeholder/TODO
- **Wired** - File is imported and used by other code (not orphaned)

## Acceptance Criteria Reconciliation

| AC   | Plan says | Reality | Verdict               |
| ---- | --------- | ------- | --------------------- |
| AC-1 |           |         | PASS / FAIL / PARTIAL |
| AC-2 |           |         | PASS / FAIL / PARTIAL |

## Security Check

- [ ] No hardcoded secrets
- [ ] Input validated at system boundaries
- [ ] Auth checks on protected routes
- [ ] No IDOR vulnerabilities (user can only access own data)
- [ ] No SQL/NoSQL injection vectors
- [ ] Error messages don't leak internal details

## Issues Found

| #   | Severity | Description | Fix required? |
| --- | -------- | ----------- | ------------- |
|     |          |             |               |

## Verdict

**PASS** / **FAIL** / **PASS WITH ISSUES**

<!-- If FAIL: list exactly what needs to be fixed before proceeding -->

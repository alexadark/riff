# RIFF Adapter Prompt — security-review

Security audit of the phase diff. You are an automated safety net. Every build phase runs
through this before merge. For every change ask "how would an attacker abuse this?" before
mapping to OWASP categories. Write `.planning/phases/<N-slug>/SECURITY.md` with a
PASS / PASS-WITH-WARNINGS / BLOCKED verdict.

## Artifact contract

`core/schemas/phase-artifacts.md` defines the required frontmatter and section structure
for SECURITY.md (including `verdict:` in the frontmatter). Read it before writing.

## Inputs to read

- Run `git diff main...HEAD` to get the full phase diff
- `.planning/phases/<N-slug>/SUMMARY.md` for context
- `.planning/config.json` — if `scope: scratch`, exit immediately with:
  "Skipped: project scope is scratch. Security review is not run for scratch projects."

## OWASP Top 10 checks

| # | Vulnerability | Look for |
|---|---|---|
| A01 | Broken Access Control | Missing auth, IDOR, privilege escalation |
| A02 | Cryptographic Failures | Hardcoded secrets, weak hashing, PII in logs |
| A03 | Injection | SQL/NoSQL/command injection, XSS |
| A04 | Insecure Design | Missing rate limiting on auth, predictable tokens |
| A05 | Security Misconfiguration | Debug in prod, permissive CORS, default creds |
| A06 | Vulnerable Components | Known CVEs in new dependencies |
| A07 | Auth Failures | Weak passwords, session fixation |
| A08 | Data Integrity | Unverified webhooks, unsigned JWTs, missing CSRF |
| A09 | Logging Failures | No audit trail, PII in logs |
| A10 | SSRF | User-controlled URLs in server-side fetch |

Project-specific: IDOR (every DB query with ID param scoped to authenticated user?),
input validation (Zod or equivalent on every endpoint body?), auth on every route,
no stack traces in responses, all secrets from env vars.

## Verdict resolution

- PASS — no findings, or only LOW/MEDIUM findings
- PASS-WITH-WARNINGS — MEDIUM findings present, not blocking
- BLOCKED — at least one CRITICAL or HIGH finding

## Output format for SECURITY.md

```yaml
---
phase: <N-slug>
generated_at: <ISO-8601>
verdict: PASS | PASS-WITH-WARNINGS | BLOCKED
reviewer_model: codex
---
```

Sections: `# Security Review: Phase N: <title>`, `## Verdict`, `## Findings` (one
`### [SEVERITY] Title` block per finding with Location, Category, Description, Proof, Fix),
`## Resolved Findings` (table, header only on first run), `## Notes`.

Severity heading format: `### [CRITICAL]`, `### [HIGH]`, `### [MEDIUM]`, `### [LOW]`.

## Stop conditions

Stop before writing SECURITY.md and report when:

- The git diff is empty
- The project uses a security pattern the prompt cannot evaluate without reading more files
  (describe what you need and ask the human)

## Output rule

Write only `.planning/phases/<N-slug>/SECURITY.md`. Overwrite on every invocation,
preserving the `## Resolved Findings` table from the previous run when findings are resolved.

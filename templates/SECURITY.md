---
phase: {{PHASE_ID}}-{{PHASE_SLUG}}
generated_at: {{ISO_TIMESTAMP}}
verdict: {{VERDICT}}
reviewer_model: sonnet
---

# Security Review: Phase {{PHASE_ID}}: {{PHASE_TITLE}}

## Verdict

{{VERDICT}}

<!--
One-line summary of the review outcome.
Examples:
  "No CRITICAL or HIGH findings."
  "2 CRITICAL findings. PR creation blocked until resolved."
  "1 MEDIUM finding (logging). Not blocking."

Verdict values:
- PASS: no findings, or only LOW/MEDIUM findings.
- PASS-WITH-WARNINGS: MEDIUM findings present, not blocking.
- BLOCKED: at least one CRITICAL or HIGH finding, PR creation blocked.
-->

## Findings

<!--
One block per finding. Omit this entire section if no findings.

Severity headings MUST use the exact format `### [SEVERITY] Title`
where SEVERITY is one of CRITICAL, HIGH, MEDIUM, LOW.
The orchestrator greps for `^### \[CRITICAL\]` and `^### \[HIGH\]`
to decide whether to block PR creation.
-->

### [CRITICAL] {{FINDING_TITLE}}

- **Location**: `path/to/file.ts:42`
- **Category**: OWASP A01: Broken Access Control
- **Description**: What is wrong and why it matters.
- **Proof**: code snippet (max 10 lines)
- **Fix**: concrete fix recommendation

## Resolved Findings

<!--
Findings that were CRITICAL or HIGH at first scan but were resolved by
auto-debug. Populated on re-runs. On first run, leave the table header only.

| Finding | Resolution | Commit |
|---------|------------|--------|
| [CRITICAL] Missing auth on /admin route | Added requireUserId middleware | abc1234 |
-->

| Finding | Resolution | Commit |
|---------|------------|--------|

## Notes

<!--
Anything that informed the review but is not a finding:
deliberate risk acceptance, known framework mitigations, scope notes.
-->

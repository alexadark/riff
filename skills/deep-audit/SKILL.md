---
name: deep-audit
description: Run a RIFF deep audit / milestone review on a module or milestone boundary. Use when the user says "deep audit", "audit this module", "milestone review", or "full milestone review" - the FULL phrase, not a bare "review". Skip if scope=scratch. Do NOT trigger on "review" alone, on "audit codebase" or "health check" (that is the audit-codebase skill), or on "incident review" (that is incident).
---

Read `.riff/protocols/DEEP-AUDIT.md` and run the flow. Milestone boundary = a
phase tagged `milestone:` in ROADMAP.yaml; the audit covers all phases in that
group. If scope is scratch, skip silently.

---
name: deep-audit
description: Runs a RIFF deep audit at a milestone boundary when the user says "deep audit", "audit this module", "milestone review", or "full milestone review". It skips scratch scope and bare review requests, codebase audits, health checks, and incident reviews.
---

Read `.riff/protocols/DEEP-AUDIT.md` and run the flow. A milestone boundary is a
phase tagged `milestone:` in ROADMAP.yaml; the audit covers every phase in that
group. Skip silently when scope is scratch.

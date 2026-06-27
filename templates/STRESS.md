---
generated_at: {{ISO_TIMESTAMP}}
target: {{TARGET_OR_STATIC_ONLY}}
verdict: {{VERDICT}}
peak_users: {{PEAK_USERS}}
needs_specialist: {{yes | no}}
---

# Stress Report — {{DATE}}

## Verdict

{{VERDICT}}

<!--
One line. BLOCKED if any CRITICAL/HIGH security finding, or the app breaks below the --users target.
PASS-WITH-WARNINGS for MEDIUM-only. PASS for clean.
-->

## Coverage

<!-- State exactly what ran. Never imply coverage you didn't run. -->

- Mode: {{static | static + active}}
- Target: {{url or "none — static only"}}
- Active security classes run: {{auth, injection, idor, ratelimit, config | "none"}}
- Load test: {{ran to N users | skipped — reason}}
- Adversarial verify (Codex): {{ran on CRITICAL/HIGH | every finding | skipped — frugal/missing}}
- Skipped / static-only: {{e.g. "IDOR static-only — no second test account"}}

## Security

<!-- One `### [SEVERITY] Title` block per finding. Omit the section if none. Active findings carry a request/response proof; static findings say "(static)". -->

### [SEVERITY] Title
- **Class:** {{class}} (OWASP A0X)
- **Location:** METHOD /path
- **Proof:** {{request sent + proving response, trimmed | "(static)"}}
- **Fix:** {{specific change}}

## Scalability

### Load curve

| Concurrency | p50 | p95 | p99 | req/s | error rate |
| ----------- | --- | --- | --- | ----- | ---------- |
| 10          |     |     |     |       |            |
| 50          |     |     |     |       |            |
| 100         |     |     |     |       |            |
| 200         |     |     |     |       |            |
| 500         |     |     |     |       |            |

**Breaking point:** {{"holds to X concurrent / Y req/s, degrades at Z on <endpoint>" | "holds to <users> clean" | "not run — static only"}}

**Limiting bottleneck:** {{endpoint + why, tied to a static finding where possible}}

### Static bottlenecks

<!-- `### [SEVERITY] Title` per finding: Location, why it fails to scale, fix. Omit if none. -->

## Top fixes

<!--
Prioritized by impact, security and scale interleaved. Number them; these are what --seed turns into phases.
Tag each fix with who does it:
  [agent]            — the coding agent can fix it AFK (add a query filter, paginate, add an index, set a header, validate input).
  [needs: <role>]    — needs a specialized human (see Human escalation). The agent can scaffold, not own the call.
-->

1. [agent] {{fix}}
2. [needs: {{role}}] {{fix}}
3.

## Human escalation

<!--
The whole point of this section: tell Alex what she can let the agent fix unattended vs what needs a specialist.
Set needs_specialist in frontmatter accordingly.
-->

**Needs a specialized human:** {{yes | no}}

<!-- If no: the agent can fix everything above AFK. Say so in one line and stop. -->
<!-- If yes: one row per item that exceeds the agent's safe authority. -->

| Item | Specialist | Why it can't be agent-owned |
| --- | --- | --- |
| {{finding/fix}} | {{security engineer / DBA / SRE-infra / compliance-legal / payments}} | {{e.g. "auth protocol redesign — correctness must be reasoned from first principles, high blast radius" / "prod capacity + index plan needs the real data distribution" / "tenant-isolation fix touches a compliance boundary"}} |

<!--
Roles, when to escalate:
- security engineer — crypto, auth/session protocol design, anything where a wrong fix silently reopens the hole.
- DBA — index/partition/query-plan changes that depend on real prod data volume and distribution.
- SRE / infra — horizontal-scaling, connection-pool sizing, autoscale, capacity planning against real prod infra.
- compliance / legal — tenant isolation, PII handling, data-residency, anything where the correctness criterion lives in a contract or counsel email, not the code.
- payments — money movement, idempotency on charges, anything that costs real money to get wrong.
-->

## Notes

<!-- Risk acceptance, framework mitigations, what to re-test after fixes. -->

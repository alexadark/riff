# Codex Capability: Finalize

Finalize one phase only after required gates are resolved.

Read:

- `core/protocols/state.md`
- `core/schemas/phase-artifacts.md`
- `.planning/phases/<phase>/PLAN.md`
- `.planning/phases/<phase>/SUMMARY.md`
- `.planning/phases/<phase>/GATES.md`
- `.planning/phases/<phase>/SCOPE-CHECK.json` when present
- `.planning/phases/<phase>/REVIEW.md` when present
- `.planning/phases/<phase>/SECURITY.md` when present
- `STATE.md`

Write:

- updated `STATE.md`
- `.planning/phases/<phase>/HANDOFF.md` when the phase creates cross-phase context
- final gate records in `.planning/phases/<phase>/GATES.md`

Rules:

- Do not finalize if a required production gate is `pending`, `running`, `fail`, or `skipped`, except the `state` gate that this command resolves.
- Scratch finalization still requires R1-R4, no-secrets, smoke, summary, and state evidence.
- Do not merge, push, start another phase, or run unattended loops.
- Do not depend on Claude agents, provider transcripts, or dashboard explanation text as source of truth.

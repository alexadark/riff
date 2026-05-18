# Codex Capability: Plan

Create one RIFF phase plan.

Read:

- `core/protocols/planning.md`
- `core/protocols/context-budget.md`
- `core/schemas/phase-artifacts.md`
- `ROADMAP.yaml` and `STATE.md` when present
- relevant design docs and files needed to set safe task boundaries

Write:

- `.planning/phases/<phase>/PLAN.md`

Rules:

- Plan only one phase.
- Do not implement code.
- Include concrete file boundaries, acceptance criteria, risks, gate expectations, and `## Smoke`.
- Use provider names only as non-binding adapter hints when useful.
- Stop and ask for a human decision if the scope requires an unapproved architecture change.

End the plan with the next manual command to run.


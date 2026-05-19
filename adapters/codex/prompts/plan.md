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
- First, stop and ask for a human decision if the scope requires an unapproved architecture change.
- After any required human architecture decision is resolved, if the phase is critical enough for Opus escalation, generate the prompt pack and stop instead of writing `PLAN.md`.

Opus escalation triggers:

- greenfield product architecture or project start
- cross-module architecture contracts
- auth, payments, PII, public APIs, migrations, or security-critical planning
- P0 work, a module with no prior `SUMMARY.md`, at least two `REVISE` or `FAIL` plan-review verdicts on the same phase, or a resolved R3 architecture decision

When escalation is needed:

1. Run:
   `node scripts/riff-opus-prompt.mjs phase-plan --phase <phase> --context-out .planning/phases/<phase>/OPUS-PHASE-PLAN-PROMPT.md`
2. Ask the human to choose:
   - Manual: paste the prompt pack into Opus and return the response for integration.
   - Programmatic: use the Opus adapter programmatic path documented in `adapters/opus/README.md`.
3. Do not run the programmatic path unless the human explicitly chooses it.
4. Save the Opus response as draft planning input, integrate it into `PLAN.md`, then run normal plan-review. Do not treat Opus output as a completed gate.

End the plan with the next manual command to run.

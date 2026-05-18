Run the next RIFF phase or one explicit gate: $ARGUMENTS.

Default to one capability per run. For local models, split production work into separate `step=<capability>` runs.

Valid steps:

- `plan`
- `plan-review`
- `execute`
- `scope-check`
- `code-review`
- `security-review`
- `docs-check`
- `hooks`
- `dashboard-metadata`
- `dashboard-explain`
- `finalize`

Read first:

- `adapters/commandcode/model-policy.md`
- `core/protocols/adapter-contract.md`
- `core/protocols/context-budget.md`
- `core/protocols/hooks.md`
- `core/schemas/phase-artifacts.md`
- `.planning/config.json`
- `STATE.md`
- `ROADMAP.yaml`

Phase selection:

1. If `$ARGUMENTS` names a phase, use it.
2. Else read `.planning/active-phase.txt`.
3. Else select the first `todo` roadmap phase whose dependencies are complete.
4. If selection is ambiguous, stop and report choices.

Context pack:

- write or update `.planning/phases/<N-slug>/context-packs/<step>.md` when useful
- include mission, output artifact, loaded rules, relevant files, and evidence
- paste short excerpts only; list large files to read directly

Step contracts:

- `plan`: write `PLAN.md` with goal, boundaries, tasks, acceptance criteria, risks, and smoke.
- `plan-review`: write `PLAN-REVIEW.md` with findings and verdict.
- `execute`: implement only planned boundaries and write `SUMMARY.md`.
- `scope-check`: compare plan, diff, and summary; write `SCOPE-CHECK.json`.
- `code-review`: review the diff; write `REVIEW.md`.
- `security-review`: check sensitive surfaces and no-secrets evidence; write `SECURITY.md`.
- `docs-check`: update docs or write `DOCS-CHECK.md` with result.
- `hooks`: run deterministic project hooks and update `GATES.md`.
- `dashboard-metadata`: build or refresh `dashboard-metadata.json`.
- `dashboard-explain`: write optional explanation metadata.
- `finalize`: verify gates, update `STATE.md`, and write `HANDOFF.md` when needed.

Production order:

1. `plan`
2. `plan-review`
3. `execute`
4. `scope-check`
5. `code-review`
6. `security-review`
7. `docs-check`
8. `hooks`
9. `dashboard-metadata`
10. `finalize`

If the selected phase has no `PLAN.md`, the next safe step is always `plan`.

Scratch may skip heavy review gates, but R1-R4, no-secrets, smoke, summary, and state evidence still apply.

Stop rules:

- do not continue past a failed required gate
- do not mark a production gate passed without artifact evidence
- do not broaden file boundaries without a logged R1-R4 decision or human approval
- do not run an unattended multi-phase loop
- request stronger/manual review for security-sensitive production changes

Final response:

- step run
- files changed
- artifact written
- gates changed
- verification result
- next safest step

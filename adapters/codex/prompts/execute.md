# Codex Capability: Execute

Execute an existing RIFF phase plan.

Read:

- `core/protocols/execution.md`
- `core/protocols/state.md`
- `core/schemas/phase-artifacts.md`
- `.planning/phases/<phase>/PLAN.md`
- task boundary files named by the plan

Write:

- implementation changes allowed by the plan
- `.planning/phases/<phase>/SUMMARY.md`

Rules:

- Treat `PLAN.md` as the execution contract.
- Apply R1-R4 deviations and record every deviation in `SUMMARY.md`.
- Run the plan smoke commands in order.
- Record command, observed result, exit code, and pass/fail in `SUMMARY.md`.
- Do not modify files outside the plan boundaries unless R1 or R2 applies.
- Do not stage, commit, merge, or start the next gate unless the user explicitly asks.
- If R3 applies, stop before implementing and report the decision needed.

The summary must not claim success for failed or skipped checks.


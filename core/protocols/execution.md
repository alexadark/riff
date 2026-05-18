# Execution Protocol

This protocol defines how a RIFF phase is executed after a plan exists. It is provider-neutral: any adapter, script, or human executor must satisfy the same artifact and gate contract.

## Phase Selection

Execution starts from an explicit phase id or the next eligible `ROADMAP.yaml` entry.

An eligible phase:

- is not marked complete, skipped, or blocked
- has all declared dependencies complete
- has no unresolved `STATE.md` blocker
- has a scope resolved from `.planning/config.json` as `production` or `scratch`

If multiple phases are eligible and no phase id was supplied, choose the first roadmap order entry. If eligibility is ambiguous, stop and ask for a human decision before writing files.

## Branch Expectations

Phase work should happen on a dedicated branch unless the caller explicitly opts out. The branch name should identify the phase without encoding private context.

The executor must not create hidden commits or broad staging operations. Stage only the files produced by the current task or phase. If the worktree already contains unrelated changes, leave them untouched and record the assumption in `SUMMARY.md`.

## Required Inputs

Before execution, the executor reads:

- `.planning/phases/<N-slug>/PLAN.md`
- `.planning/config.json` if present
- `STATE.md`
- the files listed in each task boundary
- the most recent relevant `SUMMARY.md` or `HANDOFF.md` when the plan depends on prior work

The plan is the executable contract. Do not implement work outside its boundaries except for R1-R2 deviations.

## R1-R4 Deviation Contract

When reality differs from the plan, classify the difference:

| Rule | Situation | Required action |
| --- | --- | --- |
| R1 | Minor bug found while implementing planned work | Fix it and log the bug, file, and fix in `SUMMARY.md`. |
| R2 | Missing obvious piece required by the plan | Add it and log the added piece and reason in `SUMMARY.md`. |
| R3 | Architecture or product direction must change | Stop before implementing, record the issue, and request a human decision. |
| R4 | Useful idea outside the phase scope | Do not implement it. Record it as a deferred seed or next-action note. |

R1 and R2 are allowed only when they preserve the plan's architecture. R3 and R4 must not be silently absorbed into implementation.

## Smoke Command Contract

Every phase plan must include `## Smoke` with executable commands and observable expectations.

The executor must:

- run the smoke commands in order
- capture command, expected result, observed output summary, exit code, and pass/fail status
- fix failures caused by the phase before finalizing
- mark an entry skipped only when the plan explicitly allows the skip condition and the condition is true

`SUMMARY.md` must include a `## Smoke Results` table. A phase cannot be complete while a required smoke command fails.

## Scope Check Contract

After implementation and smoke, compare `PLAN.md` against delivered changes.

The scope check must verify:

- every task acceptance criterion is satisfied or explicitly deferred with a blocking reason
- every planned artifact exists
- no forbidden file boundary was modified
- `SUMMARY.md` truthfully describes the delivered work
- smoke results match actual command outcomes

Production phases write `.planning/phases/<N-slug>/SCOPE-CHECK.json`. Scratch phases may use a lighter check, but must still report dropped scope and boundary changes in `SUMMARY.md`.

## Production Execution Gates

Production phases preserve the full gate sequence unless a gate is provably irrelevant and the skip reason is written to `GATES.md`.

Required production gates:

- plan review before implementation
- smoke commands
- scope check
- code review for behavioral changes
- security review for code, configuration, data, auth, billing, API, migration, or secrets surfaces
- documentation check when behavior, setup, API, architecture, or operator workflow changes
- hook and mechanical checks configured for the project
- dashboard metadata update when dashboard files are part of the project contract
- `SUMMARY.md` and `STATE.md` updates

Sensitive surfaces strengthen the gate requirements. Auth, payments, public APIs, PII, database writes, migrations, multi-tenant data access, and secrets handling require a security review and targeted smoke coverage where feasible.

## Scratch Execution Gates

Scratch mode is lighter but not unchecked.

Scratch phases keep:

- R1-R4
- no hardcoded secrets
- smoke commands
- truthful `SUMMARY.md`
- `STATE.md` update
- explicit note of skipped production gates

Scratch phases may skip plan review, code review, full security review, heavy documentation review, dashboard explanation, and non-critical hooks unless the phase touches sensitive surfaces.

## Finalization

Finalization is complete only after:

- all required gates pass or have documented non-blocking skips
- `SUMMARY.md` lists artifacts, deviations, decisions, smoke results, tests, and next action
- `STATE.md` reflects the new current position
- `GATES.md` records production gate outcomes when required
- the branch contains only intended phase changes


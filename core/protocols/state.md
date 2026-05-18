# State Protocol

This protocol defines how RIFF records durable project and phase state.

## State Sources

RIFF state is distributed across durable artifacts:

- `ROADMAP.yaml` stores planned phases and high-level progress
- `STATE.md` stores the current operational position and next action
- `.planning/config.json` stores project scope and execution settings
- `.planning/phases/<N-slug>/PLAN.md` stores the execution contract
- `.planning/phases/<N-slug>/SUMMARY.md` stores completed work
- `.planning/phases/<N-slug>/HANDOFF.md` stores compact context for later phases
- `.planning/phases/<N-slug>/GATES.md` stores production gate outcomes

Adapters may keep temporary runtime files, but durable state must be recoverable from these artifacts.

## ROADMAP.yaml Contract

The roadmap is the source of phase eligibility.

Each phase entry should identify:

- stable id
- slug or title
- goal
- priority when used
- dependencies
- status
- optional tags for risk, surface, or escalation
- optional scope or gate overrides

Do not encode provider commands in roadmap entries. Adapter preferences may be hints only.

## STATE.md Contract

`STATE.md` is the human-readable resume point.

It must include:

- current command or workflow
- active phase id, slug, branch, and step
- last action
- active decisions
- blockers
- files to bootstrap in a fresh context
- resume command or next action

State updates must be factual and concise. A fresh human or adapter should be able to continue from `STATE.md` without reading chat history.

## Active Phase Contract

When a phase is in progress, state must identify:

- phase id
- phase slug
- branch name when applicable
- current step or gate
- blocking issue if paused

When a phase is finalized and merged or accepted, clear active phase fields or move them to completed status according to the project workflow.

## Summary Contract

`SUMMARY.md` is written after execution evidence exists.

It must include:

- artifacts delivered
- deviations under R1-R4
- decisions made during implementation
- smoke results
- tests and checks run
- changed interfaces or public APIs
- environment variables or setup changes
- wiring notes
- next action

The summary must not claim success for commands that failed.

## Handoff Contract

`HANDOFF.md` is a compact machine-readable or skim-friendly brief for future steps.

It should include:

- what changed
- stable paths and interfaces
- unresolved risks or blockers
- files a future step should read first
- any gate exceptions accepted by the human

Keep it shorter than `SUMMARY.md`; it is designed for frequent context loading.

## Gate State

Production phases update `GATES.md` as gates resolve.

Gate records must distinguish:

- passed checks
- failed checks
- skipped checks with reason
- accepted exceptions with human approval
- pending gates

Finalization is blocked while required production gates are failed or pending.

## Scratch State

Scratch mode keeps state minimal but durable.

Required:

- summary of delivered work
- R1-R4 deviations
- smoke results
- no-secrets confirmation when code or config changed
- next action

Optional production artifacts may be omitted when the skip is intentional and recorded.


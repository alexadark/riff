# State - {{PROJECT_NAME}}

## Current Position

- **Command**: -
- **Phase**: -
- **Stage / Step**: -
- **Status**: Not started
- **Last action**: Project initialized

## Active Phase

- **Id**: -
- **Slug**: -
- **Branch**: -
- **Step**: -

<!--
Written by /riff:next Step 2b when the phase branch is created.
Cleared by Step 0 at the start of every run AND by Step 8c on local_no_ff merge (all fields back to -).
Format must stay machine-parseable: bullet, bold key, colon, space, value.

Mirror of the runtime sidecar `.planning/active-phase.txt` (read by hooks/boundary-check.sh).
This section is the human-readable + agent-bootstrap copy.
-->

## Active Decisions

<!--
Every locked answer from AskUserQuestion this session.
Phrase as facts, not as the prompt: "Scope = production", not "Asked about scope".
-->

## Open Buckets

<!--
Outstanding work categorized: BLOCKERS to address, REVISIONs queued,
files awaiting verification, sub-agent returns not yet folded in.
Empty if no work is in flight.
-->

## Files to bootstrap

<!--
Explicit list of artifact paths the next session must read before continuing
(e.g. .planning/phases/N-slug/PLAN.md, .planning/design/architecture.md).
Empty until a handoff is proposed.
-->

## Resume Command

<!--
The exact prompt the user will paste into the fresh window after /clear.
Examples:
  continue /riff:start at Stage 3 (feature scoping). Read STATE.md.
  continue /riff:next at Step 5 for phase 7-payment-webhooks. Read STATE.md.
-->

## Session Notes

<!--
Protocol nuances surfaced this session that affect later steps.
Example: "PLAN revision 1/2 used; one more allowed before escalation."
-->

## Blockers

<!-- Anything preventing progress -->

## Next Action

Run `/riff:start` to begin the discovery pipeline.

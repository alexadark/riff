# ADVERSARIAL-REVIEW — Stage-level adversarial Codex pass

Shared protocol for the gated adversarial reviews `/riff:start` runs at Stage 2.5 (architecture) and Stage 4.5 (roadmap). Both stages spawn a Codex pass against the locked artifact, surface findings, and loop on REVISE until PROCEED. The mechanics are identical; only the inputs and outputs differ.

Each caller supplies five parameters:

| Param           | Stage 2.5                                                                                                                                | Stage 4.5                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Reviewer agent  | `agents/architecture-adversarial-reviewer.md`                                                                                            | `agents/roadmap-adversarial-reviewer.md`                                                                                     |
| Target artifact | `.planning/design/architecture.md`                                                                                                       | `ROADMAP.yaml`                                                                                                               |
| Sibling reads   | `PROJECT.md`, `.planning/design/data-model.md` (if exists), `.planning/design/pages.md` (if exists)                                      | `PROJECT.md`, `.planning/design/architecture.md` (if exists), `.planning/design/pages.md` (if exists)                        |
| Output file     | `.planning/design/ARCHITECTURE-REVIEW.md`                                                                                                | `.planning/ROADMAP-REVIEW.md`                                                                                                |
| Default model   | `gpt-5.5 high`                                                                                                                           | `gpt-5.4 medium`                                                                                                             |

The gate flag is also stage-specific: Stage 2.5 reads `arch_adversarial:` from `.planning/config.json`; Stage 4.5 reads `roadmap_adversarial:`. Both accept `true | false | auto` with default `auto`. `auto` resolution lives in [`AUTO-TRIGGERS.md`](AUTO-TRIGGERS.md) (`#architecture-adversarial-auto` and `#roadmap-adversarial-auto`).

## Pre-check

Skip if `scope: scratch` in `.planning/config.json`. Adversarial Codex is overkill for personal/local projects where re-sequencing or re-drawing the architecture is trivially cheap.

For Stage 2.5 specifically, also skip if `.planning/design/architecture.md` does not exist (the System Architecture module was not run in Stage 2).

## Invocation

When the gate passes, spawn an Agent → skill `codex:codex-rescue`.

Resolve model and effort per [`protocols/MODEL.md`](MODEL.md) § Codex model + effort. The defaults above are the starting point; override per project via `.planning/config.json` when needed.

Prompt template (substitute `{{REVIEWER_AGENT}}`, `{{TARGET}}`, `{{SIBLINGS}}`, `{{OUTPUT}}`, `{{MODEL}}`, `{{EFFORT}}`):

> Project: {{PROJECT_NAME}}
>
> Run with `--model {{MODEL}} --effort {{EFFORT}}`. Read `{{REVIEWER_AGENT}}`. Read `{{TARGET}}`, `PROJECT.md`, and any of the sibling files that exist ({{SIBLINGS}}). Apply the protocol. Write `{{OUTPUT}}` with a `PROCEED` or `REVISE` verdict.

## On REVISE

1. Surface the review file to the user (paste the Findings section).
2. Re-run the upstream stage (Stage 2 System Architecture module, or Stage 4 Roadmap) with the review file as additional input. Address every `BLOCKER`, optionally address `WARNING`/`NOTE`, rewrite the target artifact in place.
3. Re-run this protocol. Loop until PROCEED.
4. Max 2 revision cycles. After that, STOP and escalate to the user with both the target artifact and the latest review file.

## On PROCEED

Continue to the next stage. For Stage 4.5 specifically, Stage 5 bootstrap does NOT run until the verdict is PROCEED.

## Skip safely

If the Codex skill is not configured (no `codex:codex-rescue` available, no Codex CLI on PATH), log a one-line warning and continue. Do not block the discovery pipeline on missing infrastructure — discovery is the moment to capture decisions, not to gate on tooling.

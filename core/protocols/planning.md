# Planning Protocol

This protocol defines the quality bar for turning a roadmap entry or human request into an executable RIFF phase plan.

## Planning Inputs

A planner reads enough context to plan safely, not the entire repository by default.

Required inputs:

- `ROADMAP.yaml`
- `STATE.md`
- `.planning/config.json` if present
- prior `HANDOFF.md` or `SUMMARY.md` files relevant to the selected phase
- design docs, taste rules, or stack rules directly relevant to the phase
- files the plan expects the executor to modify or inspect

If required context is missing, the planner either makes a low-risk assumption and records it in the plan or stops for a human decision.

## Phase Selection Rules

The planner may receive an explicit phase id. Otherwise, choose the first eligible roadmap entry.

A phase is plannable when:

- dependencies are complete
- it is not marked blocked, skipped, or done
- the requested scope fits one phase
- the plan can name concrete outputs and smoke checks

Do not plan multiple roadmap phases together unless the roadmap already defines them as one combined phase.

## Plan Quality Bar

`PLAN.md` must be a complete execution contract for a fresh executor.

It must include:

- phase id, title, goal, and scope
- goal-backward observable truths
- required artifacts and wiring
- waves or task order
- task boundaries listing files that may be modified
- acceptance criteria for each task
- dependencies and risks
- security-relevant acceptance criteria for sensitive surfaces
- documentation expectations
- `## Smoke` with executable commands and observable results
- model or adapter recommendations only as non-binding adapter hints

Tasks should be small enough that a senior executor can finish them without making architectural decisions. Split tasks when they cross unrelated modules, require different risk handling, or create file-boundary conflicts.

## Manual Branch Expectations

The plan should name the expected branch strategy when the phase is roadmap-backed.

The branch expectation is:

- one phase branch for normal phase work
- one commit per coherent task or a single docs-only commit when appropriate
- explicit staging of intended files only
- no requirement for a specific provider command

If branch creation is not appropriate, the plan must say why.

## Production Planning Gates

Production plans must preserve the safety profile of the framework.

The plan must include gate expectations for:

- plan review
- implementation smoke
- scope check
- code review
- security review
- documentation check
- hook or mechanical checks
- dashboard metadata when applicable
- final summary and state update

For auth, billing, public API, PII, database writes, migrations, multi-tenant access, or secrets handling, the plan must include explicit validation and review criteria.

## Scratch Planning Gates

Scratch plans may be shorter, but must still include:

- task boundaries
- R1-R4 handling
- no-secrets requirement
- smoke commands
- summary and state updates

Scratch plans should state which production gates are intentionally skipped.

## Human Decision Points

Stop planning and ask for a decision when:

- the request requires an architecture change not already approved
- the phase scope cannot be bounded
- acceptance criteria cannot be made observable
- a dependency is missing or contradictory
- a sensitive production action requires human verification

Record resolved decisions in the plan or `STATE.md` so later steps do not re-litigate them.

## Output

The planner writes `.planning/phases/<N-slug>/PLAN.md`.

The planner does not implement the phase, update final state, or modify runtime files outside the plan boundary.


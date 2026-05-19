# Phase Artifact Schema

This schema defines durable RIFF artifacts. Artifact names remain recognizable from RIFF v1 while the contracts are provider-neutral.

Each artifact lists purpose, producer, required sections or fields, and blocking semantics.

## `PROJECT.md`

Purpose: project brief created during RIFF start. It captures the product or repository shape before phase planning begins.

Producer: start workflow, human maintainer, or adapter-assisted discovery.

Required sections:

- project summary
- current stage: greenfield, starter, or brownfield
- users, goals, and non-goals when known
- technical shape and important boundaries
- security, data, deployment, or integration notes when relevant
- assumptions and open questions

Blocking semantics:

- missing `PROJECT.md` does not block existing brownfield projects that already have an equivalent project brief, but the start workflow must state the equivalent source
- missing security, data, or integration notes block production roadmap generation when those surfaces are in scope
- provider-specific command requirements are invalid in this artifact

Scratch vs production:

- production briefs should include enough context to route gates and risks
- scratch briefs may be short, but must still identify the goal, assumptions, and next action

## `.planning/design/*`

Purpose: start-time design notes for architecture, data, user journeys, integration boundaries, or other project decisions that should not be hidden in chat history.

Producer: start workflow, roadmap planner, or human maintainer.

Required content:

- one or more markdown files under `.planning/design/` when architecture, data, user experience, security, or integration decisions are material to the roadmap
- each design note names the decision, constraints, accepted assumptions, and follow-up risks

Blocking semantics:

- missing design docs block production roadmap generation when a roadmap depends on unstated architecture, data, security, or integration assumptions
- design docs must not encode provider commands or provider-specific workflow requirements

Scratch vs production:

- production starts should create design docs for material architecture or risk decisions
- scratch starts may omit design docs when `PROJECT.md`, `ROADMAP.yaml`, and `STATE.md` are sufficient

## `ROADMAP.yaml`

Purpose: project-level phase queue and dependency map.

Producer: start workflow, roadmap planner, or human maintainer.

Required fields:

- project or roadmap title when available
- ordered `phases`
- each phase has `id`, `title` or `slug`, `goal`, `status`, and `dependencies`
- optional `priority`, `tags`, `mode`, `scope`, gate overrides, and risk metadata

Blocking semantics:

- blocked or incomplete dependencies make a phase ineligible
- missing phase id blocks automation
- provider-specific command requirements are invalid in the roadmap

Scratch vs production:

- production roadmaps should define enough metadata for gates and risk routing
- scratch roadmaps may be minimal or omitted for ad hoc work, but state and summary still need a clear task identity

## `.planning/config.json`

Purpose: project execution configuration.

Producer: project initialization or human maintainer.

Required fields:

- `scope`: `production` or `scratch`

Optional fields:

- budget or quality profile
- enabled gates
- hook configuration references
- dashboard settings
- adapter preferences

Blocking semantics:

- invalid JSON blocks automated execution
- missing `scope` defaults to `production`
- disabling production gates requires explicit documented reason

Scratch vs production:

- scratch scope skips heavy gates by default but keeps R1-R4, no secrets, smoke, summary, and state
- production scope runs full gates unless a gate has a documented non-applicability reason

## `.planning/phases/<N-slug>/PLAN.md`

Purpose: executable contract for one phase.

Producer: planner.

Required sections:

- goal
- goal-backward observable truths
- required artifacts and wiring
- waves or task order
- tasks with file boundaries
- acceptance criteria
- dependencies
- risks
- security and documentation expectations when relevant
- `## Smoke`

Blocking semantics:

- missing smoke commands block execution
- missing boundaries block execution
- unclear acceptance criteria require plan revision
- production plans without required gates block execution

Scratch vs production:

- scratch plans may be shorter but still need boundaries and smoke
- production plans must include full gate expectations

## `.planning/phases/<N-slug>/PLAN-REVIEW.md`

Purpose: independent challenge of the plan before implementation.

Producer: plan reviewer.

Required sections:

- reviewed inputs
- findings ordered by severity
- gate coverage assessment
- verdict: `PASS`, `REVISE`, or `FAIL`

Blocking semantics:

- any `BLOCKER` prevents execution until the plan is revised or a human resolves it
- missing review in production blocks execution unless explicitly skipped for a valid reason

Scratch vs production:

- production normally requires plan review
- scratch may skip plan review unless risk or sensitivity warrants it

## `.planning/phases/<N-slug>/SUMMARY.md`

Purpose: truthful record of what changed and how it was verified.

Producer: executor.

Required sections:

- what was built
- deviations
- decisions made
- smoke results
- tests
- changed interfaces or public APIs
- new environment variables
- wiring notes
- next action

Blocking semantics:

- missing summary blocks finalization
- summary claiming failed checks passed blocks finalization
- missing R1-R4 deviation records blocks finalization when deviations occurred

Scratch vs production:

- required in both modes
- scratch summary may replace heavier review artifacts

## `.planning/phases/<N-slug>/SCOPE-CHECK.json`

Purpose: structured comparison of planned scope to delivered work.

Producer: scope checker.

Required fields:

- `phase`
- `planPath`
- `summaryPath`
- `status`: `match`, `mismatch`, or `accepted_exception`
- `checkedAcceptanceCriteria`
- `missingItems`
- `extraChanges`
- `boundaryViolations`
- `smokeVerified`
- `notes`

Blocking semantics:

- `mismatch` blocks production finalization
- boundary violations block unless accepted by a human
- missing planned artifacts block unless explicitly deferred

Scratch vs production:

- production writes this artifact
- scratch may summarize scope status in `SUMMARY.md`

## `.planning/phases/<N-slug>/REVIEW.md`

Purpose: post-implementation code and behavior review.

Producer: code reviewer.

Required sections:

- tests or checks reviewed
- findings ordered by severity
- verdict: `PASS` or `FAIL`

Blocking semantics:

- any `BLOCKER` makes the review fail
- failed tests or smoke are blocking
- missing production review blocks finalization for behavioral code changes

Scratch vs production:

- production requires review for behavioral code changes
- scratch may skip review unless risk warrants it

## `.planning/phases/<N-slug>/SECURITY.md`

Purpose: security review for sensitive or code-changing phases.

Producer: security reviewer.

Required sections:

- reviewed surfaces
- threat considerations
- findings ordered by severity
- no-secrets result
- verdict: `PASS`, `FAIL`, or `SKIPPED`

Blocking semantics:

- hardcoded secrets block in all modes
- missing auth, authorization, tenant scoping, unsafe payments, secret leakage, and unsafe migrations block production
- skipped production security review requires a reason in `GATES.md`

Scratch vs production:

- scratch requires no hardcoded secrets
- production requires full security review for code, config, data, auth, billing, API, migration, secrets, or deployment surfaces

## `.planning/phases/<N-slug>/GATES.md`

Purpose: phase gate ledger.

Producer: gate runner, reviewers, finalizer, or human maintainer.

Required sections:

- status vocabulary: `pending`, `running`, `pass`, `warn`, `fail`, `skipped`
- gate entries for `plan-review`, `execute`, `scope-check`, `code-review`, `security-review`, `docs-check`, `hooks`, `dashboard`, `summary`, and `state`
- scratch-required entries for R1-R4, no-secrets, and smoke when heavy production gates are skipped
- each entry names gate, status, required flag, command or adapter step, exit code when applicable, artifact path, timestamp, and reason for skip or exception

Blocking semantics:

- pending or failed required production gates block finalization
- skipped required production gates block finalization unless there is a human accepted exception
- the `state` gate is resolved by finalization, so it may be ignored only by the finalizer preflight check
- accepted exceptions require a human decision reference

Scratch vs production:

- production requires gate ledger
- scratch may skip heavy gates but must keep resolved records for R1-R4, no-secrets, smoke, summary, and state

## `.planning/phases/<N-slug>/HANDOFF.md`

Purpose: compact continuation context for future phases or fresh sessions.

Producer: executor or finalizer.

Required sections:

- delivered changes
- stable interfaces
- files to read first
- unresolved risks
- accepted exceptions
- recommended next action

Blocking semantics:

- missing handoff does not block simple phases
- missing handoff may block complex multi-phase work when later roadmap entries depend on it

Scratch vs production:

- optional in scratch
- recommended in production, required when the phase creates cross-phase contracts

## `STATE.md`

Purpose: current project position and resume point.

Producer: runner, finalizer, or human maintainer.

Required sections:

- current position
- active phase
- active decisions
- open buckets or blockers
- files to bootstrap
- resume command or next action
- session notes when needed

Blocking semantics:

- stale active phase can block phase selection
- unresolved blockers prevent automatic continuation
- missing next action makes handoff incomplete

Scratch vs production:

- required in both modes
- scratch state may be shorter but must still identify next action

## Dashboard Explanation Metadata

Purpose: optional generated explanation for dashboard views.

Producer: dashboard explanation capability or deterministic dashboard builder.

Required fields:

- `phaseId`
- `generatedAt`
- `sourceArtifacts`
- `generator`
- `summary`
- `blockingStatus`
- `freshness`

Blocking semantics:

- missing metadata does not block execution if structured dashboard data is available
- stale metadata must be labeled stale
- production dashboard readiness blocks only when the project declares dashboard freshness as a required gate

Scratch vs production:

- production should expose gate and blocker status
- scratch may expose only summary, smoke, no-secrets, and next action

## Dashboard Metadata

Purpose: deterministic dashboard data for rendering phase status.

Producer: dashboard metadata builder.

Required fields:

- `phaseId`
- `phaseDir`
- `generatedAt`
- `generator`
- `scope`
- `sourceArtifacts`
- `gates`
- `smokeStatus`
- `reviewVerdict`
- `securityVerdict`
- `documentationStatus`
- `blockingStatus`
- `blockers`
- `nextAction`

Blocking semantics:

- missing deterministic metadata blocks a required dashboard gate
- optional explanation metadata does not block rendering when deterministic metadata exists
- failed, pending, running, or skipped required gates must appear in `blockers`

Scratch vs production:

- production metadata exposes the full gate ledger
- scratch metadata may show skipped heavy gates, but no-secrets, smoke, summary, and state remain visible

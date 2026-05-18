# Dashboard Protocol

The dashboard reports RIFF project and phase status from durable artifacts. It must not depend on a specific provider to understand project state.

## Data Sources

The dashboard may read:

- `ROADMAP.yaml`
- `STATE.md`
- `.planning/config.json`
- `.planning/phases/<N-slug>/PLAN.md`
- `.planning/phases/<N-slug>/PLAN-REVIEW.md`
- `.planning/phases/<N-slug>/SUMMARY.md`
- `.planning/phases/<N-slug>/SCOPE-CHECK.json`
- `.planning/phases/<N-slug>/REVIEW.md`
- `.planning/phases/<N-slug>/SECURITY.md`
- `.planning/phases/<N-slug>/GATES.md`
- `.planning/phases/<N-slug>/HANDOFF.md`
- optional adapter usage metadata

Dashboard readers should tolerate missing optional artifacts and label them as pending, skipped, or unavailable based on gate state.

Dashboard metadata generation is deterministic. It must be possible to build structured dashboard data from artifacts without an LLM, `claude --print`, provider-specific command output, or chat transcript state.

## Phase Status Contract

For each phase, dashboard data should expose:

- id
- title or slug
- status
- priority when available
- dependencies
- active branch when available
- current step
- gate statuses
- smoke status
- review verdicts
- security verdict
- documentation status
- next action

Derived status must be explainable from artifact contents.

## Explanation Metadata

Adapters may generate short explanations, but the dashboard data contract is artifact-first.

Explanation metadata should include:

- provider or generator id, or `none`
- generated timestamp
- source artifacts used
- summary text
- risk or blocker text when present
- confidence or freshness note when useful

If no explanation generator is available, the dashboard still renders structured status.

The deterministic metadata artifact should be written to:

- `.planning/phases/<N-slug>/dashboard-metadata.json`

Stable fields:

- `phaseId`
- `phaseDir`
- `generatedAt`
- `generator`
- `scope`
- `configStatus`
- `sourceArtifacts`
- `gates`
- `smokeStatus`
- `reviewVerdict`
- `securityVerdict`
- `documentationStatus`
- `blockingStatus`
- `blockers`
- `nextAction`

Optional explanation metadata may be written to `.planning/phases/<N-slug>/dashboard-explanation.json`. The explanation artifact can summarize or clarify the deterministic metadata, but it must not become the source of truth.

## Production Dashboard Requirements

Production phases should show:

- plan review status
- scope check status
- code review status
- security review status or documented skip
- documentation status
- hook status
- smoke status
- finalization readiness

Any failed or pending required gate should be visible as blocking.

## Scratch Dashboard Requirements

Scratch phases may show a shorter view:

- task or phase goal
- smoke status
- no-secrets status when code or config changed
- summary availability
- next action

Skipped production gates should be marked as skipped by scope, not silently absent.

## Dashboard Freshness

The dashboard should be regenerated or refreshed after:

- phase selection
- plan creation or revision
- gate completion
- summary creation
- state update
- finalization

If dashboard data is stale relative to artifacts, mark it stale rather than presenting it as current.

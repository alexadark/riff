# Review Protocol

This protocol defines RIFF review gates. Reviews are independent checks over durable artifacts and diffs, not provider-specific conversations.

## Review Inputs

Each review receives the narrow context required for its gate.

Common inputs:

- `ROADMAP.yaml` entry for the phase
- `.planning/phases/<N-slug>/PLAN.md`
- changed files or phase diff
- `.planning/phases/<N-slug>/SUMMARY.md` when implementation has run
- relevant rules for the touched surface
- smoke and test results

Reviews must verify claims against files or command output where possible.

## Verdict Contract

Every review artifact must end with a verdict:

- `PASS`: no blocking findings
- `REVISE`: findings must be fixed before the next step, but the phase can continue after revision
- `FAIL`: the gate blocks finalization until fixed or explicitly overridden by a human

Findings are ordered by severity and include file and line references when applicable.

Severity levels:

- `BLOCKER`: must fix before proceeding
- `WARNING`: should fix or document why accepted
- `NOTE`: non-blocking observation

Any `BLOCKER` makes the verdict `REVISE` or `FAIL`.

## Plan Review

Plan review writes `.planning/phases/<N-slug>/PLAN-REVIEW.md`.

It checks:

- phase scope is bounded
- tasks have file boundaries
- acceptance criteria are observable
- smoke commands cover touched and neighboring surfaces
- sensitive surfaces include validation, authorization, and review criteria
- production gates are preserved
- scratch skips are explicit and safe
- no provider-specific requirement has leaked into the core phase contract

Verdict:

- `PASS` allows execution
- `REVISE` requires the planner to update `PLAN.md`
- `FAIL` blocks until a human resolves the planning issue

## Code Review

Code review writes `.planning/phases/<N-slug>/REVIEW.md`.

It checks:

- test and smoke failures
- logic errors
- broken contracts or callers
- missing error handling
- race conditions
- edge cases
- boundary violations
- mismatch between plan, summary, and diff

It does not replace security review. Security findings may be noted, but sensitive issues should also route through the security gate.

## Security Review

Security review writes `.planning/phases/<N-slug>/SECURITY.md`.

It is required in production for phases touching code, configuration, data, auth, billing, API, migrations, secrets, or deployment behavior. Docs-only phases may skip it with a `GATES.md` reason.

Blocking rules:

- any hardcoded secret is `BLOCKER`
- missing authentication on a protected route is `BLOCKER`
- missing authorization or tenant scoping for user data is `BLOCKER`
- unsafe payment, billing, or webhook handling is `BLOCKER`
- secret leakage in logs or artifacts is `BLOCKER`
- migration or destructive data operation without rollback or explicit approval is `BLOCKER`
- public API input without validation is at least `WARNING` and becomes `BLOCKER` when exploitability is direct

Scratch mode still blocks hardcoded secrets. Other security checks may be lighter unless the task touches sensitive surfaces.

## Documentation Review

Documentation review checks whether behavior, setup, API, architecture, CLI usage, environment variables, or operator workflow changed.

Outcomes:

- docs updated
- no docs needed with reason
- docs stale, blocking finalization in production

The result is recorded in `GATES.md` or a dedicated documentation section of `SUMMARY.md`.

## Scope Check

Scope check writes `.planning/phases/<N-slug>/SCOPE-CHECK.json` in production.

It compares:

- planned tasks to delivered changes
- acceptance criteria to evidence
- boundaries to modified files
- smoke commands to smoke results
- claimed artifacts to actual artifacts

Any silently dropped task or modified forbidden boundary is blocking unless a human explicitly accepts the deviation.

## Gate Logging

Production review outcomes are recorded in `.planning/phases/<N-slug>/GATES.md`.

Each gate entry includes:

- gate name
- status: `pass`, `fail`, `revise`, `skipped`, or `accepted-exception`
- evidence path or command summary
- skip or exception reason when applicable


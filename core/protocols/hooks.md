# Hooks Protocol

Hooks are deterministic checks or guards that support RIFF gates. They must be callable by adapters, humans, and project automation without depending on a specific AI provider.

## Hook Classes

Core hooks:

- destructive operation guard
- file-boundary check
- secret scan
- migration guard
- generated artifact freshness check
- orphaned task or unchecked TODO guard

Project hooks:

- test, typecheck, lint, format, build, or smoke wrappers
- stack-specific validation
- documentation freshness checks

Adapter hooks:

- preflight checks before an adapter runs
- output validation for adapter-written artifacts
- cleanup of temporary context packs

Git hooks:

- commit message validation
- pre-commit checks
- pre-push checks when appropriate

## Runner Expectations

A hook runner must:

- run from the project root unless the hook declares another directory
- print the command or hook id
- return a machine-readable status when practical
- distinguish `pass`, `fail`, `warn`, and `skipped`
- avoid mutating files unless the hook is explicitly a fixer
- write or append gate results to `GATES.md` in production phases

Hooks should be shell-callable or script-callable. A hook must not require a chat session to interpret whether it passed.

## Blocking Semantics

Production:

- destructive guard failures block
- secret scan failures block
- boundary check failures block unless a human accepts the deviation
- migration guard failures block for schema or data migrations
- test, typecheck, lint, build, and smoke failures block when the phase touches their surface
- documentation hook failures block when docs are stale and required

Scratch:

- destructive guard failures block
- hardcoded secret findings block
- smoke failures block
- other hooks may warn unless the phase declares them required

## Boundary Checks

Boundary hooks compare modified files to the active plan's task boundaries.

Allowed changes:

- files listed in the current task or phase boundaries
- R1-R2 additions logged in `SUMMARY.md`
- generated artifacts explicitly listed in the plan

Forbidden changes block finalization until reverted, moved to a new plan, or accepted by a human as a scope change.

## Secret Checks

Secret checks scan code, config, docs, logs, summaries, and gate artifacts created by the phase.

Any hardcoded credential, token, private key, or production secret is blocking in both production and scratch.

## Hook Records

Hook outcomes are recorded with:

- hook id
- command or script path
- status
- observed summary
- artifact path for full output when useful
- reason for skip or warning

Production records belong in `GATES.md`. Scratch records may be summarized in `SUMMARY.md`.


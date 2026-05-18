Run a small RIFF task with bounded context: $ARGUMENTS.

Use this only when the task is small, local, and has no architecture decision.

Preflight:

1. Read `core/protocols/context-budget.md`, `core/protocols/hooks.md`, and `core/schemas/phase-artifacts.md` if available.
2. Read `.planning/config.json` if present; default to `production` when absent.
3. If scope is `production`, do not edit files with `quick`; stop and recommend `riff/next step=plan` or the specific `riff/next step=<capability>` needed.
4. Decide whether this is truly quick.

Quick task limit:

- 1 to 3 files
- no new data model
- no auth, billing, migration, deployment, or destructive change
- no cross-module contract change

If the task exceeds that limit, stop and recommend `riff/next` with a phase plan.

Execution:

1. State intent in at most 3 bullets.
2. Read the exact files you will edit.
3. Apply the smallest safe change.
4. Run targeted smoke checks.
5. Run or request no-secrets evidence.
6. Record a concise note in `.planning/quick/` when that directory exists or when project policy requires it.

Output:

- files changed
- verification commands and results
- R1-R4 deviations, or `none`
- whether the task should become a planned phase

Stop rules:

- stop on unclear requirements
- stop before editing when scope is `production` or unknown
- stop before architecture changes
- stop if required context does not fit
- stop if smoke or no-secrets evidence fails

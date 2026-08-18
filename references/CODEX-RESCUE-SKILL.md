# Codex rescue compatibility reference

`$riff:next` does not require an external rescue skill. Its planner, workers, and reviewers are dispatched through the installed native adapters and the stage contract in `protocols/RIFF-NEXT.md`.

Do not add a rescue-skill dependency, model override, automatic fallback, or usage ledger to the native stage workflow. Adapter-owned routing is the sole source of runtime selection.

## Legacy Claude command workflow

Some installed legacy Claude commands may still invoke a separately installed `codex:codex-rescue` skill for an independent review or delegated execution. That is a compatibility workflow, not a requirement or fallback for `$riff:next`.

When maintaining such a project, consult that installed skill's own documentation and record the exact command-era contract with the project. Do not transplant its settings into shared roles, profiles, or native RIFF protocols.

For the active workflow, read `docs/RIFF-MANUAL.md` and `protocols/RIFF-NEXT.md`.

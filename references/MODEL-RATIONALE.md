# Runtime routing rationale

This reference explains the active routing boundary. It is not an operator runbook.

RIFF separates semantic responsibilities from runtime selection:

- Shared responsibilities live in `agents/roles/` and contain no provider, model, effort, permission, or delegation choice.
- The active native routing table lives in `agents/codex/` and `agents/openai.yaml`.
- `$riff:next` selects only declared route classes, records its route receipt, and validates every stage according to `protocols/RIFF-NEXT.md`.

The runner uses a stronger architecture class only after a fresh controller confirmation. It selects worker classes from the canonical execution classification, and reviewers receive fresh read-only evidence snapshots. Reserved, inventory, fallback, and unlisted classes are not normal `$riff:next` routes.

Do not copy adapter configuration into plans, profiles, shared role specifications, or business protocols. Change routing only in the adapter-owned configuration, then run:

```bash
node scripts/artifact-check.mjs
./riff doctor --ci
```

For the operator-facing workflow, read `docs/RIFF-MANUAL.md`. For stage invariants, read `protocols/RIFF-NEXT.md`.

## Legacy Claude command workflow

Older command-era documents used inline planning, named model overrides, and optional external delegation. Those rules are not part of the active native runner. Keep them only when operating an explicitly installed legacy Claude command surface; they must not be used to configure `$riff:next`.

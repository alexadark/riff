# Wave reconcile compatibility protocol

The active native runner verifies each stage through its own pre-review and post-review mechanical evidence. Native action and publication reconciliation follows `protocols/GIT-DELIVERY.md`.

For a native phase, reconcile only from the ignored action ledger, the persisted commit-attempt marker, Git object identity, and hook receipts. A matching post-commit `HEAD` is persisted without creating another commit. Any other parent, tree, path set, or receipt blocks resume.

For phase publication, reconcile `push_pending`, `pushed`, `pr_pending`, and `pr_open` against exact remote base and head OIDs. Reuse only the unique open pull request with the evidence-bound branch and base. Never repair a mismatch with reset, rebase, amend, force-push, or branch deletion.

Use `protocols/RIFF-NEXT.md` for the authoritative state transitions and `docs/RIFF-MANUAL.md` for normal operation.

## Legacy Claude command workflow

An explicitly installed legacy wave command may retain a wave-level reconcile artifact and resume procedure. That procedure is only for the corresponding legacy bundle workflow. Do not use it to infer native completion, merge eligibility, or action commit identity.

### 5. React to verdict

Compatibility anchor only. Native stages stop on their own failed transition.

If an explicitly installed legacy wave command reaches a branch `done`
transition or merge, it must first run
`node .riff/scripts/finisher-guard.mjs <branch>`. A non-zero result leaves
that legacy phase parked and blocks its transition. This guard is not a
native `$riff:next` transition and does not authorize promotion or merge.

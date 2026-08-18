# Wave reconcile compatibility protocol

The active native runner verifies each stage through its own pre-review and post-review mechanical evidence. It has no separate resume-and-reconcile transition for a delegated wave bundle.

Use `protocols/RIFF-NEXT.md` for the authoritative state transitions and `docs/RIFF-MANUAL.md` for normal operation.

## Legacy Claude command workflow

An explicitly installed legacy wave command may retain a wave-level reconcile artifact and resume procedure. That procedure is only for the corresponding legacy bundle workflow. Do not use it to infer native completion, merge eligibility, or the semantics of `$riff:next` waves.

### 5. React to verdict

Compatibility anchor only. Native stages stop on their own failed transition.

If an explicitly installed legacy wave command reaches a branch `done`
transition or merge, it must first run
`node .riff/scripts/finisher-guard.mjs <branch>`. A non-zero result leaves
that legacy phase parked and blocks its transition. This guard is not a
native `$riff:next` transition and does not authorize promotion or merge.

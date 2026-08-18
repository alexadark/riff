# Autonomy protocol

Autonomous operation is bounded by the same stage invariants as an interactive native run. It does not authorize broader scope, unreviewed completion, merging, publishing, deployment, or an implicit resume.

- Begin only with an explicit phase identifier and bounded task.
- Preserve the runner's lock, immutable-plan, evidence-snapshot, boundary, review, and persisted-state rules from `protocols/RIFF-NEXT.md`.
- Stop on an unsafe boundary, invalid artifact, failed gate, or unresolved request ambiguity.
- Surface any action that needs new user authority rather than inventing a fallback route.

The active native slice has no autonomous wave-bundle loop, cross-project conductor, or finisher-led merge path. Completion remains a stage result, not authorization to merge or deploy.

## Legacy Claude command workflow

Legacy commands may implement front-loaded approval, loops, finishers, or wave parking. Those mechanisms are compatibility behavior for that command runtime. They are not part of `$riff:next` and must not be presented as native fallbacks.

### Autonomy boundary

Compatibility anchor only. The native boundary is stated above.

### Conversion table

Compatibility anchor only. Legacy interaction conversion is not a native transition.

### Batched verification

Compatibility anchor only. Native evidence is stage-scoped.

### Finishers

Compatibility anchor only. Native completion does not create a merge finisher.

## Merge policy

Compatibility anchor only. Native stage completion does not merge.

An explicitly installed legacy autonomous workflow that attempts a branch
merge must first run `node .riff/scripts/finisher-guard.mjs <branch>`. A
non-zero result blocks that legacy merge until its pending finisher is
resolved. This compatibility guard neither creates a native `$riff:next`
merge path nor changes the requirement for explicit promotion confirmation.

### Loop mode

Compatibility anchor only. The native slice has no implicit loop.

### Resume

Compatibility anchor only. `$riff:next` requires explicit inputs for a new invocation.

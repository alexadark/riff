# Autonomy protocol

Autonomous operation is bounded by the same stage invariants as an interactive native run. It does not authorize broader scope, unreviewed completion, merging, deployment, promotion, or an implicit resume. It does authorize the evidence-bound action commits and phase pull-request publication defined in `protocols/GIT-DELIVERY.md` because those are delivery records, not promotion.

- Begin only with an explicit phase identifier and bounded task.
- Preserve the runner's lock, immutable-plan, evidence-snapshot, boundary, review, and persisted-state rules from `protocols/RIFF-NEXT.md`.
- Stop on an unsafe boundary, invalid artifact, failed gate, or unresolved request ambiguity.
- Surface any action that needs new user authority rather than inventing a fallback route.

The native wave engine may continue across stacked phase branches without merging them. End-only security runs after the product phases, then the engine pushes each evidence-bound phase branch and creates or reuses its detailed pull request. It never auto-merges. `riff finish` only identifies the next explicit GitHub merge boundary.

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

Compatibility anchor only. Native stage completion and phase PR publication do not merge.

An explicitly installed legacy autonomous workflow that attempts a branch
merge must first run `node .riff/scripts/finisher-guard.mjs <branch>`. A
non-zero result blocks that legacy merge until its pending finisher is
resolved. This compatibility guard neither creates a native `$riff:next`
merge path nor changes the requirement for explicit promotion confirmation.

### Loop mode

Native `riff wave --autonomous --loop` recomputes dependency frontiers until the roadmap is dry or a real boundary stops it. Each completed phase advances the local stacked tip without requiring a merge.

### Resume

Native `riff wave --resume` reconciles persisted phase delivery, push, and pull-request states. A standalone `$riff:next` still requires explicit inputs, except for the internal evidence-bound `--resume-delivery` handoff owned by the wave engine.

# Opus Context Pack

The Opus adapter uses compact context packs for escalation work. A context pack is markdown printed by `scripts/riff-opus-prompt.mjs`, then either pasted into Opus manually or sent through the explicit `--run-claude` path.

`--run-claude` requires an explicit confirmation flag (`--yes`) or `RIFF_OPUS_ALLOW_PROGRAMMATIC=1`.

## Generated Layout

Each context pack contains:

- capability and expected output
- manual workflow reminder
- stop conditions
- core contract excerpts for planning and phase artifacts
- compact source artifact excerpts
- one Opus prompt template
- output requirements

## Loading Tiers

| Capability | Tier |
| --- | --- |
| `start` | focused |
| `phase-plan` | focused |
| `architecture-review` | focused |

## Source Artifacts

Project-start prompts inspect:

- `PROJECT.md`
- `ROADMAP.yaml`
- `STATE.md`
- `.planning/config.json`
- `.planning/design/*.md`

Phase prompts inspect:

- `ROADMAP.yaml`
- `STATE.md`
- `.planning/config.json`
- `.planning/phases/<phase>/PLAN.md`
- `.planning/phases/<phase>/PLAN-REVIEW.md`
- `.planning/phases/<phase>/SUMMARY.md`
- `.planning/phases/<phase>/HANDOFF.md`

Large files are excerpted and labeled. Missing files are listed as missing so Opus can call out context gaps instead of inventing state.

Architecture-review packs also include a working-tree snapshot for in-progress changes: filtered `git status --short`, filtered `git diff --stat`, filtered `git diff`, and excerpts of changed text files. Files with secret-like names such as `.env`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `.ssh/`, or `secrets/` are excluded from diffs and excerpts. Untracked status entries and excerpts are limited to RIFF-relevant paths such as `.planning/`, `adapters/`, `core/`, `docs/`, and `scripts/` so unrelated local output directories are not pulled into review packs.

## Output Rule

Opus output must be usable as a RIFF artifact, especially `.planning/phases/<phase>/PLAN.md` for phase planning. Architecture review output may be saved as `.planning/phases/<phase>/ARCHITECTURE-REVIEW.md`, but any proposed plan change must be expressed as replacement `PLAN.md` sections or a complete `PLAN.md` draft.

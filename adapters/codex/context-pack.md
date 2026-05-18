# Codex Context Pack

The Codex adapter uses compact, step-specific context packs. A context pack is the complete prompt passed to one Codex capability.

## Generated Layout

`scripts/riff-codex.mjs` generates a single markdown context pack with these sections:

- mission and stopping rules
- capability and output artifact
- loading tier
- core contract paths
- existing artifact snapshot
- required files to inspect
- adapter prompt for the selected capability
- output requirements

This follows `core/protocols/context-budget.md` without requiring every core file to be pasted into the prompt.

## Loading Tiers

| Capability | Tier |
| --- | --- |
| `plan` | focused |
| `execute` | expanded |
| `plan-review` | focused |
| `scope-check` | focused |
| `code-review` / `review` | focused |
| `security-review` | expanded |
| `docs-check` | focused |
| `hooks` | minimal |
| `dashboard-metadata` | minimal |
| `dashboard-explain` | minimal |
| `finalize` | focused |

## Source Artifacts

The generated context pack records whether these files exist:

- `ROADMAP.yaml`
- `STATE.md`
- `.planning/config.json`
- `.planning/phases/<phase>/PLAN.md`
- `.planning/phases/<phase>/PLAN-REVIEW.md`
- `.planning/phases/<phase>/SUMMARY.md`
- `.planning/phases/<phase>/SCOPE-CHECK.json`
- `.planning/phases/<phase>/REVIEW.md`
- `.planning/phases/<phase>/SECURITY.md`
- `.planning/phases/<phase>/DOCS-CHECK.md`
- `.planning/phases/<phase>/GATES.md`
- `.planning/phases/<phase>/HANDOFF.md`
- `.planning/phases/<phase>/dashboard-metadata.json`
- `.planning/phases/<phase>/dashboard-explanation.json`

When a file exists and is small enough, the script includes a compact excerpt. Large files are listed for the Codex run to inspect directly.

## Output Rule

Each capability writes or updates only the artifact named by the selected prompt, plus files explicitly allowed by the plan or gate being run.

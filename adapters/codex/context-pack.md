# Codex Context Pack

The Codex adapter uses compact, step-specific context packs. A context pack is the complete prompt passed to one Codex capability.

## Generated Layout

`scripts/riff-codex.mjs` generates a single markdown context pack with these sections:

- mission and stopping rules
- capability and output artifact
- loading tier
- core contract paths
- existing artifact snapshot
- project snapshot for `start`
- required files to inspect
- adapter prompt for the selected capability
- output requirements

This follows `core/protocols/context-budget.md` without requiring every core file to be pasted into the prompt.

## Loading Tiers

| Capability | Tier |
| --- | --- |
| `start` | focused |
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

- `PROJECT.md` for `start`
- `.planning/design/*.md` for `start`
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

For `start`, the context pack also includes a bounded project file list and excerpts from common entry files such as `README.md`, package manifests, docs indexes, and app/source directories. Generated or bulky directories such as `.git`, `node_modules`, build outputs, coverage, caches, and `outputs` are excluded from the project snapshot.

In target projects, `riff init --harness codex` or `riff init --harness all` should run before `start`. The installed `.riff/` symlink gives Codex stable access to the RIFF framework scripts while keeping durable project artifacts in the target project root.

## Output Rule

Each capability writes or updates only the artifact named by the selected prompt, plus files explicitly allowed by the plan or gate being run.

The `start` capability writes only start artifacts: `PROJECT.md`, `.planning/config.json`, `.planning/design/*.md` when needed, `ROADMAP.yaml`, and `STATE.md`. It does not write implementation files or phase execution artifacts.

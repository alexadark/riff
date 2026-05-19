---
name: "riff:map"
description: "Brownfield codebase exploration and RIFF onboarding — walks an existing project and produces architecture.md, taste.md, risks.md, and per-module specs. Explicitly invoke as $riff:map."
---

# RIFF Map

Use this skill when the user invokes `$riff:map` in Codex.

## Input

Use the user's inline text after `$riff:map` as the arguments. Pass it verbatim as `--input`:

- No args: full project exploration
- `<directory>`: focus on a specific directory
- `--focus=<area>`: deep dive (`frontend`, `backend`, `api`, `auth`, `data`)
- `--quick`: stack detection and architecture only (Steps 1-2 of the full map)

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command with the args as input:

```bash
node .riff/scripts/riff-codex.mjs map --run --input "<args>"
```

If no args were given, omit `--input` entirely:

```bash
node .riff/scripts/riff-codex.mjs map --run
```

## Expected Output

| File | Content |
| ---- | ------- |
| `.planning/architecture.md` | One-liner, stack, structure, module inventory (ranked by criticality), entry points, data flow, dependencies, Mermaid diagrams |
| `taste.md` | Extracted conventions by concern |
| `.planning/risks.md` | Tech debt, security concerns |
| `.planning/specs/*.md` | One spec per major module (skipped with `--quick`) |
| `STATE.md` | Updated: mapped, ready for planning |

## Report

Summarize: project one-liner, stack detected, number of modules mapped, files written. Surface any CI drift warnings found. Ask the user to review `architecture.md` for corrections before planning.

## Next Step

End with: "Review `.planning/architecture.md` and `taste.md`, then use `/riff:start` or `/riff:add-phase` to begin planning."

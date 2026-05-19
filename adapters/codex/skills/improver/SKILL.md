---
name: "riff:improver"
description: "Batch-run the improver across recent phases and write expertise proposals to .planning/expertise/.pending/. Explicitly invoke as /riff:improver."
---

# RIFF Improver

Use this skill when the user invokes `/riff:improver` or mentions `$riff:improver` in Codex.

## Input

Use the user's inline text after `/riff:improver` to resolve the target set:

- No args or empty: scan the last 3 phases that have a `SUMMARY.md`
- `<N>` (a number): scan the last N phases
- `--all`: scan every phase folder under `.planning/phases/`

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command. When a specific phase or count is provided, pass it as `--input`:

```bash
node .riff/scripts/riff-codex.mjs improver --run --input "<inline-input>"
```

If no input was given, omit `--input` entirely:

```bash
node .riff/scripts/riff-codex.mjs improver --run
```

## Report

List every file newly created under `.planning/expertise/.pending/` (excluding dot-files). One line per file: `<phase> → <filename> (<patterns_written> patterns)`. If a sentinel reports `patterns_written: 0`, surface that — silence is a valid result. Report the sentinel path for each processed phase.

## Next Step

End with: "Review pending proposals at `/riff:next` Step 10, or accept/reject inline now."

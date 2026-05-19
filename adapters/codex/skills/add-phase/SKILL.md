---
name: "riff:add-phase"
description: "Add one or more phases to the RIFF roadmap. Explicitly invoke as /riff:add-phase."
---

# RIFF Add Phase

Use this skill when the user invokes `/riff:add-phase` or mentions `$riff:add-phase` in Codex.

## Input

Use the user's inline text after `/riff:add-phase` as `<inline-input>`. If the inline text is empty, ask for the phase title, goal, tasks, priority, mode, and dependencies before running the adapter.

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command, substituting the resolved input safely as a single shell argument:

```bash
node .riff/scripts/riff-codex.mjs add-phase --run --input "<inline-input>"
```

## Report

Report the artifact path, exit code, and any stop condition from the adapter. If the expected artifact is missing, say which file is missing and why the adapter stopped.

## Next Step

End with `/riff:plan <new-phase-id>`.

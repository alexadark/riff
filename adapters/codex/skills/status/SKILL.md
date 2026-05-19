---
name: "riff:status"
description: "Show RIFF project status and the next safe command. Explicitly invoke as /riff:status."
---

# RIFF Status

Use this skill when the user invokes `/riff:status` or mentions `$riff:status` in Codex.

## Input

Use the user's inline text after `/riff:status` as `<inline-input>` when the command needs project-level input. Empty inline input is allowed only when the adapter can infer status or current project context.

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command, substituting the resolved input safely as a single shell argument:

```bash
node .riff/scripts/riff-codex.mjs status --run
```

## Report

Report the artifact path, exit code, and any stop condition from the adapter. If the expected artifact is missing, say which file is missing and why the adapter stopped.

## Next Step

End with `the next command reported by status`.

---
name: "riff:plan"
description: "Write a RIFF PLAN.md for one phase. Explicitly invoke as /riff:plan <phase-id>."
---

# RIFF Plan

Use this skill when the user invokes `/riff:plan` or mentions `$riff:plan` in Codex.

## Input

Use the user's inline text after `/riff:plan` to resolve the target phase.

## Phase Resolution

Resolve `<resolved-phase>` from the user's inline text after `/riff:plan`. If no phase is provided, read `.planning/active-phase.txt`; if that is missing, inspect `ROADMAP.yaml` and choose the first phase appropriate for this command. If more than one phase is plausible, stop and list the choices instead of guessing.

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command, substituting the resolved input safely as a single shell argument:

```bash
node .riff/scripts/riff-codex.mjs plan --phase "<resolved-phase>" --run
```

## Report

Report the artifact path, exit code, and any stop condition from the adapter. If the expected artifact is missing, say which file is missing and why the adapter stopped.

## Next Step

End with `/riff:plan-review <resolved-phase>`.

---
name: "riff:dashboard-metadata"
description: "Generate deterministic RIFF dashboard metadata for one phase. Explicitly invoke as /riff:dashboard-metadata <phase-id>."
---

# RIFF Dashboard Metadata

Use this skill when the user invokes `/riff:dashboard-metadata` or mentions `$riff:dashboard-metadata` in Codex.

## Input

Use the user's inline text after `/riff:dashboard-metadata` to resolve the target phase.

## Phase Resolution

Resolve `<resolved-phase>` from the user's inline text after `/riff:dashboard-metadata`. If no phase is provided, read `.planning/active-phase.txt`; if that is missing, inspect `ROADMAP.yaml` and choose the first phase appropriate for this command. If more than one phase is plausible, stop and list the choices instead of guessing.

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command, substituting the resolved input safely as a single shell argument:

```bash
node .riff/scripts/riff-codex.mjs dashboard-metadata --phase "<resolved-phase>" --run
```

## Report

Report the artifact path, exit code, and any stop condition from the adapter. If the expected artifact is missing, say which file is missing and why the adapter stopped.

## Next Step

End with `/riff:dashboard-explain <resolved-phase>`.

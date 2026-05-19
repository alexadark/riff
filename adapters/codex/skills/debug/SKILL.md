---
name: "riff:debug"
description: "Diagnose a bug or failure, write a DEBUG.md with evidence-based root cause, and attempt a targeted fix. Explicitly invoke as /riff:debug."
---

# RIFF Debug

Use this skill when the user invokes `/riff:debug` or mentions `$riff:debug` in Codex.

## Input

Use the user's inline text after `/riff:debug` as `<bug-description>`. If no description is provided, ask for one before running.

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command, passing the bug description as `--input`:

```bash
node .riff/scripts/riff-codex.mjs debug --run --input "<bug-description>"
```

If the user also specifies a phase context (e.g. `--phase 3-auth`), pass it too:

```bash
node .riff/scripts/riff-codex.mjs debug --run --input "<bug-description>" --phase "<phase-id>"
```

## Report

Report:

- Path of the DEBUG.md written (`.planning/debug/YYYY-MM-DD-<slug>.md` for ad-hoc, or `.planning/phases/<N-slug>/DEBUG.md` for phase-context bugs)
- Fix commit hash if a fix was applied
- Whether the status is RESOLVED or UNRESOLVED

## Next Step

If RESOLVED: "Verify the fix with `node .riff/scripts/riff-codex.mjs hooks --phase <phase> --run`."

If UNRESOLVED: "The DEBUG.md describes what the next investigator needs. Surface to user and stop."

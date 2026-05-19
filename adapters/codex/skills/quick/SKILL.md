---
name: "riff:quick"
description: "Ad-hoc task execution without phase overhead — for small 1-3 file changes with no architectural decisions. Explicitly invoke as $riff:quick."
---

# RIFF Quick

Use this skill when the user invokes `$riff:quick` or `$riff:quick <task description>` in Codex.

## Input

Use the user's inline text after `$riff:quick` as the task description. Pass it verbatim as `--input`.

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command with the task description as input:

```bash
node .riff/scripts/riff-codex.mjs quick --run --input "<task description>"
```

If no task description was given, stop and ask the user for one before running.

## Expected Output

- A `.planning/quick/quick-NNNN.md` log file (date, files changed, what was done)
- A git commit with a conventional message describing the change

## Report

List the files changed and the commit hash. Surface the quick log path. If the agent assessed the task as too large for a quick run, report that and suggest `/riff:add-phase` instead.

## Next Step

End with: "Quick task complete. Review the commit and the log at `.planning/quick/quick-NNNN.md`."

---
name: "riff:learn-stack"
description: "Research a stack's best practices from multiple authoritative sources and synthesize a references/taste/stacks/<stack>.md file. Explicitly invoke as /riff:learn-stack."
---

# RIFF Learn Stack

Use this skill when the user invokes `/riff:learn-stack` or mentions `$riff:learn-stack` in Codex.

## Input

Use the user's inline text after `/riff:learn-stack` as `<stack> [focus]`. Examples:

- `rust cli` — Rust language, CLI focus
- `phoenix` — Elixir/Phoenix framework
- `fastapi async-service` — FastAPI with async focus

If no stack is provided, ask for it before running.

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command, passing the stack and optional focus as `--input`:

```bash
node .riff/scripts/riff-codex.mjs learn-stack --run --input "<stack> [focus]"
```

## Report

Report:

- Stack file path (`references/taste/stacks/<stack>.md`)
- Rule count (number of entries in Core Rules + themed sections)
- Source list (names and types of sources consulted)
- Whether `references/taste/stacks/INDEX.md` was updated

## Next Step

End with: "Review the new taste file and append a row to `references/taste/stacks/INDEX.md` if the adapter did not do it automatically."

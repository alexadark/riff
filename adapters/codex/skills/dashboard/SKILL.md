---
name: "riff:dashboard"
description: "Start (or stop) the RIFF local web dashboard, auto-register the current project, and open the browser. Explicitly invoke as $riff:dashboard."
---

# RIFF Dashboard

Use this skill when the user invokes `$riff:dashboard` in Codex.

## Input

Use the user's inline text after `$riff:dashboard` to determine the action:

- No args or empty: start the dashboard, register cwd, open browser
- `--stop`: stop the running dashboard server

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Confirm `.planning/` exists. If not, this is not a RIFF project — stop and tell the user.
3. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command. Pass `--stop` as `--input` when the user wants to stop:

```bash
node .riff/scripts/riff-codex.mjs dashboard --run --input "--stop"
```

For a normal start (no args), omit `--input` entirely:

```bash
node .riff/scripts/riff-codex.mjs dashboard --run
```

## Report

On success: report the dashboard URL and project slug. If the server was already running, confirm it was not restarted. If the server failed to come up, report the log path for diagnosis.

## Next Step

End with: "Dashboard is live. Use `/riff:next` in the terminal to run phases; changes flow back to the dashboard automatically."

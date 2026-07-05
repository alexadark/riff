---
description: Start (or attach to) the local web dashboard, auto-register the current project, and open the browser
allowed-tools: Bash
argument-hint: [--stop]
---

# /riff:dashboard

Start the local Bun dashboard (or attach to a running one), register the current project into the registry, and open the browser at this project's kanban view. Re-running is idempotent: it never kills/restarts a healthy server.

Pass `--stop` to terminate the running server.

This is a thin wrapper over the shared lifecycle script `.riff/scripts/dashboard.sh`, which also backs the `riff dashboard` CLI command. Both entry points run the exact same logic.

## Steps

**Run the lifecycle script** via the project's `.riff/` symlink, forwarding `$ARGUMENTS`. The script verifies this is a RIFF project, verifies Bun, resolves the dashboard directory, then does the health probe / detached start / auto-registration / browser open (or terminates on `--stop`).

```bash
bash .riff/scripts/dashboard.sh $ARGUMENTS
```

## Notes

- **CLI equivalent:** `riff dashboard` and `riff dashboard --stop` run the same script from any shell.
- **PID file:** `~/.riff/dashboard.pid` — written at start, removed at `--stop`. A stale PID (process gone) is treated as not-running and cleaned up.
- **Idempotent start:** if `GET /api/projects` already responds, the command auto-registers cwd and opens the browser without touching the running process.
- **Auto-registration** uses the backend's dedupe behavior, the registry won't grow duplicates if the cwd was already added.
- **Bootstrap (plain-language explanations)** runs lazily on first visit per project, progress shows in the UI. May take 30s to 3min depending on phase count.
- **Profile changes** (e.g. `style.explanation_level`, `user.narrative_language`): edit `profile.yaml`, then `riff dashboard --stop && riff dashboard` (or `/riff:dashboard --stop && /riff:dashboard`) to pick them up.
- **Read-only UI.** To run a phase, use `/riff:next` in the terminal. Live changes flow back to the dashboard via file-watcher.

---
description: Start (or attach to) the local web dashboard, auto-register the current project, and open the browser
allowed-tools: Bash
argument-hint: [--stop]
---

# /riff:dashboard

Start the local Bun dashboard (or attach to a running one), register the current project into the registry, and open the browser at this project's kanban view. Re-running is idempotent: it never kills/restarts a healthy server.

Pass `--stop` to terminate the running server.

## Steps

1. **Parse args.** If `$ARGUMENTS` contains `--stop`, jump to the **Stop** section. Otherwise continue.

2. **Verify this is a RIFF project.** `.planning/` must exist in cwd. If not, print and STOP:
   ```
   Not a RIFF project (no .planning/ in current directory). Run /riff:init first, or cd into a RIFF project.
   ```

3. **Verify Bun is installed.**
   ```bash
   command -v bun >/dev/null 2>&1 || { echo "Bun is required. Install: curl -fsSL https://bun.sh/install | bash"; exit 1; }
   ```

4. **Locate the dashboard server.** Path: `$HOME/DEV/frameworks/riff/dashboard/`. If missing, the framework is not properly installed, print an error and STOP.

5. **Run the lifecycle block.** This single Bash block handles state-dir setup, health probe, optional server start, auto-registration of cwd, and browser open.

   ```bash
   set -e

   DASHBOARD_DIR="$HOME/DEV/frameworks/riff/dashboard"
   STATE_DIR="$HOME/.riff"
   PID_FILE="$STATE_DIR/dashboard.pid"
   LOG_FILE="$DASHBOARD_DIR/.last-run.log"
   URL="http://localhost:4000"
   PROJECT_PATH="$(pwd)"

   mkdir -p "$STATE_DIR"

   # First-run dependency install
   if [ ! -d "$DASHBOARD_DIR/node_modules" ]; then
     echo "First run: installing dashboard dependencies..."
     (cd "$DASHBOARD_DIR" && bun install) || { echo "bun install failed"; exit 1; }
   fi

   # Is the dashboard already up?
   server_up() { curl -fsS "$URL/api/projects" >/dev/null 2>&1; }
   pid_alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }

   RUNNING=0
   if server_up; then
     RUNNING=1
   elif [ -f "$PID_FILE" ]; then
     # PID file exists but server is not responding. Check if the process is alive.
     STALE_PID=$(cat "$PID_FILE" 2>/dev/null || true)
     if pid_alive "$STALE_PID"; then
       # Process alive but not serving health, give it a brief grace window.
       for _ in 1 2 3; do
         sleep 1
         if server_up; then RUNNING=1; break; fi
       done
     fi
     [ "$RUNNING" -eq 1 ] || rm -f "$PID_FILE"
   fi

   if [ "$RUNNING" -eq 0 ]; then
     # Not running: start detached. nohup + disown survives the slash command.
     (
       cd "$DASHBOARD_DIR"
       nohup bun run start > "$LOG_FILE" 2>&1 &
       echo $! > "$PID_FILE"
       disown
     )
     # Wait up to 5s for /api/projects.
     for _ in 1 2 3 4 5; do
       if server_up; then RUNNING=1; break; fi
       sleep 1
     done
     if [ "$RUNNING" -eq 0 ]; then
       echo "Dashboard failed to come up within 5s. Logs: $LOG_FILE"
       exit 1
     fi
   fi

   # Auto-register cwd. Backend dedupes by path, safe to call every time.
   REGISTRY_JSON=$(curl -fsS -X POST "$URL/api/projects" \
     -H "Content-Type: application/json" \
     --data "{\"path\":\"$PROJECT_PATH\"}" 2>/dev/null || true)

   # Resolve slug from the registry response (handles disambiguated slugs like "foo-2").
   SLUG=$(printf '%s' "$REGISTRY_JSON" | python3 -c "
   import json,sys,os
   try:
       data=json.load(sys.stdin)
   except Exception:
       sys.exit(0)
   target=os.path.realpath('$PROJECT_PATH')
   for entry in data.get('registry', []):
       if os.path.realpath(entry.get('root','')) == target:
           print(entry.get('slug',''))
           break
   " 2>/dev/null || true)

   if [ -z "$SLUG" ]; then
     # Fallback: derive slug locally (matches slugFromPath = basename().toLowerCase()).
     SLUG=$(basename "$PROJECT_PATH" | tr '[:upper:]' '[:lower:]')
   fi

   PROJECT_URL="$URL/#/projects/$SLUG"
   open "$PROJECT_URL" 2>/dev/null || xdg-open "$PROJECT_URL" 2>/dev/null || echo "Open $PROJECT_URL in your browser."

   echo "Dashboard running at $URL (project: $SLUG)"
   echo "Logs: $LOG_FILE"
   echo "Stop: /riff:dashboard --stop"
   ```

## Stop

Run this block when `--stop` is passed.

```bash
PID_FILE="$HOME/.riff/dashboard.pid"

if [ ! -f "$PID_FILE" ]; then
  # Nothing to stop (no PID file). Try a port-level kill as a last resort, then exit clean.
  PORT_PID=$(lsof -tiTCP:4000 -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$PORT_PID" ]; then
    kill "$PORT_PID" 2>/dev/null || true
    echo "Dashboard stopped (port-level, no PID file)."
  else
    echo "Dashboard not running."
  fi
  exit 0
fi

PID=$(cat "$PID_FILE" 2>/dev/null || true)
if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
  # Give it a moment to exit, then SIGKILL if still alive.
  for _ in 1 2 3; do
    sleep 1
    kill -0 "$PID" 2>/dev/null || break
  done
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  echo "Dashboard stopped (PID $PID)."
else
  echo "Dashboard not running (stale PID file removed)."
fi

rm -f "$PID_FILE"
```

## Notes

- **PID file:** `~/.riff/dashboard.pid` — written at start, removed at `--stop`. A stale PID (process gone) is treated as not-running and cleaned up.
- **Idempotent start:** if `GET /api/projects` already responds, the command auto-registers cwd and opens the browser without touching the running process.
- **Auto-registration** uses the backend's dedupe behavior, the registry won't grow duplicates if the cwd was already added.
- **Bootstrap (plain-language explanations)** runs lazily on first visit per project, progress shows in the UI. May take 30s to 3min depending on phase count.
- **Profile changes** (e.g. `style.explanation_level`, `user.narrative_language`): edit `profile.yaml`, then `/riff:dashboard --stop && /riff:dashboard` to pick them up.
- **Read-only UI.** To run a phase, use `/riff:next` in the terminal. Live changes flow back to the dashboard via file-watcher.

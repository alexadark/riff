---
description: Open the local web dashboard for the current project (kanban + plain-language phase explanations)
allowed-tools: Bash
---

# /riff:dashboard

Spawn the local Bun server and open the dashboard in the browser. The dashboard reads the current project's `.planning/` and `ROADMAP.yaml`, and shows phases as a kanban with plain-language explanations at the level configured in `profile.yaml`.

## Steps

1. **Verify this is a RIFF project.** Check that `.planning/` exists in cwd. If not, print:
   ```
   Not a RIFF project (no .planning/ in current directory). Run /riff:init first, or cd into a RIFF project.
   ```
   And STOP.

2. **Verify Bun is installed.**
   ```bash
   command -v bun >/dev/null 2>&1 || { echo "Bun is required. Install: curl -fsSL https://bun.sh/install | bash"; exit 1; }
   ```

3. **Locate the dashboard server.** Path: `~/DEV/frameworks/riff/dashboard/`. If missing, the framework is not properly installed — print an error and STOP.

4. **Install dependencies on first run.**
   ```bash
   DASHBOARD_DIR="$HOME/DEV/frameworks/riff/dashboard"
   if [ ! -d "$DASHBOARD_DIR/node_modules" ]; then
     echo "First run: installing dashboard dependencies..."
     (cd "$DASHBOARD_DIR" && bun install) || { echo "bun install failed"; exit 1; }
   fi
   ```

5. **Stop any existing server on port 4000** (so re-running `/riff:dashboard` is idempotent).
   ```bash
   PORT_PID=$(lsof -tiTCP:4000 -sTCP:LISTEN 2>/dev/null || true)
   if [ -n "$PORT_PID" ]; then
     kill "$PORT_PID" 2>/dev/null || true
     sleep 1
   fi
   ```

6. **Start the server in the background** with the current project as `PROJECT_ROOT`. Use `nohup` + `disown` so the process survives this command's lifetime, and redirect logs to a file.
   ```bash
   PROJECT_ROOT="$(pwd)"
   LOG_FILE="$DASHBOARD_DIR/.last-run.log"
   (cd "$DASHBOARD_DIR" && PROJECT_ROOT="$PROJECT_ROOT" nohup bun run start > "$LOG_FILE" 2>&1 &)
   ```

7. **Wait for the server to come up** (max 5s).
   ```bash
   for i in 1 2 3 4 5; do
     if curl -fsS http://localhost:4000/api/project > /dev/null 2>&1; then break; fi
     sleep 1
   done
   ```

8. **Open the dashboard in the default browser.**
   ```bash
   open http://localhost:4000 2>/dev/null || xdg-open http://localhost:4000 2>/dev/null || echo "Open http://localhost:4000 in your browser."
   ```

9. **Report.**
   ```
   Dashboard running at http://localhost:4000 for project: <project name>
   Logs: ~/DEV/frameworks/riff/dashboard/.last-run.log
   Stop: lsof -tiTCP:4000 -sTCP:LISTEN | xargs kill
   ```

## Notes

- First launch on a project with existing phases triggers a bootstrap that generates plain-language explanations for each phase via `claude --print`. Progress is visible in the dashboard UI. May take 30s to 3min depending on phase count.
- Failed explanation generations show a placeholder + retry button in the UI. The dashboard never blocks on errors.
- Profile is read once at server start. If you edit `profile.yaml` (e.g., change `dashboard.level`), re-run `/riff:dashboard` to pick up the change.
- The dashboard is read-only. To run a phase, use `/riff:next` in the terminal as usual. The dashboard will reflect changes live via file-watcher.

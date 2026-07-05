#!/usr/bin/env bash
# RIFF dashboard lifecycle: start/attach or stop the local Bun dashboard.
# Single source of truth shared by the `riff dashboard` CLI command and the
# `/riff:dashboard` slash command. Run from a RIFF project root.
#
# Usage:
#   dashboard.sh            Start (or attach to) the dashboard, register cwd, open browser.
#   dashboard.sh --stop     Terminate the running dashboard.

set -e

URL="http://localhost:4000"
STATE_DIR="$HOME/.riff"
PID_FILE="$STATE_DIR/dashboard.pid"

# ---------------------------------------------------------------------------
# Stop
# ---------------------------------------------------------------------------
if [ "$1" = "--stop" ]; then
  if [ ! -f "$PID_FILE" ]; then
    # Nothing to stop (no PID file). Try a port-level kill as a last resort.
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
  exit 0
fi

# ---------------------------------------------------------------------------
# Start / attach
# ---------------------------------------------------------------------------

# Verify this is a RIFF project.
if [ ! -d .planning ]; then
  echo "Not a RIFF project (no .planning/ in current directory). Run 'riff init' first, or cd into a RIFF project."
  exit 1
fi

# Verify Bun is installed.
command -v bun >/dev/null 2>&1 || { echo "Bun is required. Install: curl -fsSL https://bun.sh/install | bash"; exit 1; }

# Resolve framework root: prefer RIFF_FRAMEWORK_ROOT (set by the CLI), then the
# project's .riff/ symlink, then ~/.config/riff/config.yaml's framework_path,
# then the legacy ~/DEV path.
RIFF_ROOT=""
if [ -n "$RIFF_FRAMEWORK_ROOT" ] && [ -d "$RIFF_FRAMEWORK_ROOT/dashboard" ]; then
  RIFF_ROOT="$RIFF_FRAMEWORK_ROOT"
fi
if [ -z "$RIFF_ROOT" ] && { [ -L .riff ] || [ -d .riff ]; }; then
  RIFF_ROOT=$(cd .riff 2>/dev/null && pwd -P)
fi
if [ -z "$RIFF_ROOT" ] && [ -f "$HOME/.config/riff/config.yaml" ]; then
  RIFF_ROOT=$(awk '/^framework_path:/ { sub(/^framework_path:[[:space:]]*/, ""); gsub(/^"|"$/, ""); print; exit }' "$HOME/.config/riff/config.yaml")
fi
if [ -z "$RIFF_ROOT" ] || [ ! -d "$RIFF_ROOT/dashboard" ]; then
  RIFF_ROOT="$HOME/DEV/frameworks/riff"
fi

DASHBOARD_DIR="$RIFF_ROOT/dashboard"
if [ ! -d "$DASHBOARD_DIR" ]; then
  echo "Dashboard directory not found at $DASHBOARD_DIR. Framework not properly installed."
  exit 1
fi

LOG_FILE="$DASHBOARD_DIR/.last-run.log"
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
  # Not running: start detached. nohup + disown survives the caller.
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
echo "Stop: riff dashboard --stop"

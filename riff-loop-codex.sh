#!/bin/bash
# RIFF Loop (Codex) - Unattended execution (Ralph loop)
#
# Mirrors riff-loop.sh but invokes Codex per-iteration instead of Claude Code.
# Each iteration: reads state from disk, picks next AFK task, runs codex exec.
# Stop conditions are identical to riff-loop.sh — source of truth: commands/loop.md.
#
# Usage:
#   ./riff-loop-codex.sh [options] [project-path]
#   ./riff-loop-codex.sh -n 1               # loop once (test a single iteration)
#   ./riff-loop-codex.sh -n 3 ./myapp       # 3 iterations on ./myapp
#   ./riff-loop-codex.sh                    # default: up to 20 iterations in current dir
#
# Options:
#   -n <count>   Maximum number of iterations (overrides RIFF_MAX_ITERATIONS)
#
# Prerequisites:
#   - Codex CLI installed and authenticated (CODEX_BIN or codex in PATH)
#   - RIFF framework initialized in the project (riff init --harness codex done)
#   - ROADMAP.yaml exists with phases
#
# Environment variables:
#   CODEX_BIN            - Codex executable (default: codex)
#   RIFF_MAX_ITERATIONS  - Maximum loop iterations (default: 20, safety limit)
#   RIFF_COOLDOWN        - Seconds between iterations (default: 5)

set -e

CODEX_PID=""
CONTEXT_FILE=""

# Per-loop session identifier so concurrent loop processes (or stale markers
# from a prior run) don't cross-trigger each other's LOOP_STOP detection.
LOOP_ID="$$_$(date -u +%s)"

# Cleanup trap — kill Codex child process on Ctrl+C / SIGTERM.
cleanup() {
  if [ -n "$CODEX_PID" ] && kill -0 "$CODEX_PID" 2>/dev/null; then
    kill -TERM "$CODEX_PID" 2>/dev/null || true
    sleep 2
    kill -KILL "$CODEX_PID" 2>/dev/null || true
  fi
  [ -n "$CONTEXT_FILE" ] && rm -f "$CONTEXT_FILE"
  exit 130
}
trap cleanup INT TERM

# Parse options
FLAG_ITERATIONS=""
while getopts "n:" opt; do
  case $opt in
    n) FLAG_ITERATIONS="$OPTARG" ;;
    *) echo "Usage: ./riff-loop-codex.sh [-n iterations] [project-path]"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

# Configuration
PROJECT_PATH="${1:-.}"
MAX_ITERATIONS="${FLAG_ITERATIONS:-${RIFF_MAX_ITERATIONS:-20}}"
COOLDOWN="${RIFF_COOLDOWN:-5}"
CODEX_BIN="${CODEX_BIN:-codex}"
ITERATION=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

notify() {
  local message="$1"
  echo -e "${BLUE}[RIFF Loop Codex]${NC} $message"
}

cd "$PROJECT_PATH"

if [ ! -f "ROADMAP.yaml" ]; then
  echo -e "${RED}Error: ROADMAP.yaml not found. Run riff init --harness codex and $riff:start first.${NC}"
  exit 1
fi

if [ ! -d ".planning" ]; then
  echo -e "${RED}Error: .planning/ not found. Run riff init --harness codex first.${NC}"
  exit 1
fi

# Resolve the riff-codex.mjs script path.
CODEX_MJS=""
if [ -f ".riff/scripts/riff-codex.mjs" ]; then
  CODEX_MJS=".riff/scripts/riff-codex.mjs"
elif [ -f "$SCRIPT_DIR/scripts/riff-codex.mjs" ]; then
  CODEX_MJS="$SCRIPT_DIR/scripts/riff-codex.mjs"
else
  echo -e "${RED}Error: riff-codex.mjs not found. Run riff init --harness codex first.${NC}"
  exit 1
fi

# Clear stale LOOP_STOP markers owned by this process or in legacy unscoped form.
if [ -f STATE.md ] && grep -qE "LOOP_STOP(:|\[$LOOP_ID\]:)" STATE.md 2>/dev/null; then
  notify "Clearing stale LOOP_STOP markers from previous run."
  tmp=$(mktemp) && grep -vE "LOOP_STOP(:|\[$LOOP_ID\]:)" STATE.md > "$tmp" && mv "$tmp" STATE.md
fi

notify "Starting RIFF Codex loop in $(pwd)"
notify "Max iterations: $MAX_ITERATIONS | Cooldown: ${COOLDOWN}s | Codex: $CODEX_BIN"

# Main loop
while [ $ITERATION -lt $MAX_ITERATIONS ]; do
  ITERATION=$((ITERATION + 1))

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo -e "${GREEN}  RIFF Codex Loop - Iteration $ITERATION/$MAX_ITERATIONS${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo ""

  # Count phases by status + mode + provider_mode using a single awk pass.
  # AFK-eligible = mode:AFK OR (mode:HITL AND provider_mode:sandbox).
  # Source of truth: commands/loop.md § HITL vs sandbox-HITL.
  eval "$(awk '
    function flush() {
      if (status=="") return
      if (status=="todo") { todo++ }
      if (status=="blocked") { blocked++ }
      if (status=="todo" && (mode=="AFK" || (mode=="HITL" && provider=="sandbox"))) { afk_todo++ }
      status=""; mode=""; provider=""
    }
    /^[[:space:]]*-[[:space:]]*id:/ { flush() }
    /^[[:space:]]*status:/ { s=$0; sub(/.*status:[[:space:]]*/,"",s); gsub(/["'"'"'[:space:]]/,"",s); status=s }
    /^[[:space:]]*provider_mode:/ { p=$0; sub(/.*provider_mode:[[:space:]]*/,"",p); gsub(/["'"'"'[:space:]]/,"",p); provider=p; next }
    /^[[:space:]]*mode:/ { m=$0; sub(/.*mode:[[:space:]]*/,"",m); gsub(/["'"'"'[:space:]]/,"",m); mode=m }
    END { flush(); printf "TODO_COUNT=%d\nBLOCKED_COUNT=%d\nAFK_TODO_COUNT=%d\n", todo+0, blocked+0, afk_todo+0 }
  ' ROADMAP.yaml 2>/dev/null)"

  if [ "$TODO_COUNT" -eq 0 ]; then
    notify "All phases complete! Build finished." "done"
    break
  fi

  if [ "$BLOCKED_COUNT" -gt 0 ] && [ "$TODO_COUNT" -le "$BLOCKED_COUNT" ]; then
    notify "All remaining phases are blocked. Human intervention needed."
    break
  fi

  if [ "$TODO_COUNT" -gt 0 ] && [ "$AFK_TODO_COUNT" -eq 0 ]; then
    notify "Only production-provider HITL phases remain. Human presence required."
    break
  fi

  notify "Iteration $ITERATION: generating context pack for next phase..."

  # Write context pack for the next AFK-eligible phase to a temp file.
  CONTEXT_FILE=$(mktemp /tmp/riff-loop-codex-XXXXXX.md)

  # Generate the context pack (next capability = execute, picks the next todo phase).
  # We use the existing status command to find the next phase, then generate execute context.
  NEXT_PHASE_CMD=$(node "$CODEX_MJS" status 2>/dev/null | grep 'Next safe command:' | sed 's/.*Next safe command: //')
  if [ -z "$NEXT_PHASE_CMD" ]; then
    notify "Could not determine next phase from status. Stopping."
    break
  fi

  # Extract phase id from command like /riff:plan 3-my-phase
  NEXT_PHASE_ID=$(echo "$NEXT_PHASE_CMD" | awk '{print $2}')
  if [ -z "$NEXT_PHASE_ID" ]; then
    notify "No phase id found in: $NEXT_PHASE_CMD. Stopping."
    break
  fi

  # Build the Codex prompt for this iteration — mirrors riff-loop.sh's approach:
  # fresh context pack per iteration, stop conditions written to STATE.md.
  ITER_MARKER="### riff-loop-codex iteration $ITERATION start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "" >> STATE.md
  echo "$ITER_MARKER" >> STATE.md

  cat > "$CONTEXT_FILE" << RIFF_PROMPT
You are running in RIFF loop (AFK mode) using the Codex adapter.

Run the next AFK-eligible RIFF phase using these constraints:
- Eligible phases: mode: AFK OR (mode: HITL AND provider_mode: sandbox). Skip production-provider HITL phases.
- Run: node $CODEX_MJS next --run (if available) OR run the individual gates manually in order: plan, execute, scope-check, code-review, security-review, docs-check, hooks, dashboard-metadata, finalize for phase $NEXT_PHASE_ID.
- On Confident/Likely assumptions: proceed without asking.
- On Unclear assumptions: write "LOOP_STOP[$LOOP_ID]: unclear assumptions" to STATE.md and exit.
- On R3 deviation: write "LOOP_STOP[$LOOP_ID]: R3 architecture change needed" to STATE.md and exit.
- On verification FAIL: write "LOOP_STOP[$LOOP_ID]: verification failed" to STATE.md and exit.
- On security CRITICAL/HIGH: write "LOOP_STOP[$LOOP_ID]: security issue" to STATE.md and exit.
- After successful completion: commit and exit normally.
- Never auto-merge PRs. The user reviews and merges manually.
RIFF_PROMPT

  notify "Iteration $ITERATION: running Codex for phase $NEXT_PHASE_ID..."

  set +e
  "$CODEX_BIN" exec --full-auto - < "$CONTEXT_FILE" &
  CODEX_PID=$!
  wait "$CODEX_PID"
  CODEX_EXIT=$?
  set -e

  rm -f "$CONTEXT_FILE"
  CONTEXT_FILE=""

  if [ "$CODEX_EXIT" -eq 0 ]; then
    echo -e "${GREEN}Iteration $ITERATION: agent finished.${NC}"
  else
    notify "Iteration $ITERATION failed with error (exit $CODEX_EXIT). Stopping loop."
    break
  fi

  # Check for LOOP_STOP markers written after the iteration marker.
  STOP_REASON=$(awk -v marker="$ITER_MARKER" -v loop_id="$LOOP_ID" '
    $0==marker { seen=1; next }
    seen && (index($0, "LOOP_STOP[" loop_id "]") || index($0, "LOOP_STOP:")) { print; exit }
  ' STATE.md 2>/dev/null)
  if [ -n "$STOP_REASON" ]; then
    notify "Loop stopped: $STOP_REASON"
    break
  fi

  # Check if all phases are done.
  REMAINING=$(grep -c 'status: todo' ROADMAP.yaml 2>/dev/null || echo "0")
  if [ "$REMAINING" -eq 0 ]; then
    notify "All phases complete! Build finished."
    break
  fi

  if [ $ITERATION -lt $MAX_ITERATIONS ]; then
    echo -e "${BLUE}Cooldown: ${COOLDOWN}s before next iteration...${NC}"
    sleep "$COOLDOWN"
  fi
done

echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  RIFF Codex Loop Complete${NC}"
echo -e "${GREEN}  Iterations: $ITERATION${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"

notify "Loop finished after $ITERATION iterations."

#!/bin/bash
# RIFF Loop - Unattended execution (Ralph loop)
#
# Spawns a fresh Claude Code agent per iteration.
# Each iteration: reads state from disk, picks next AFK task, executes /riff:next.
# Stops on: verification failure, R3 deviation, security issue, all done, or error.
#
# Usage:
#   ./riff-loop.sh [options] [project-path]
#   ./riff-loop.sh -n 1                    # loop once (test a single iteration)
#   ./riff-loop.sh -n 3 ./myapp            # 3 iterations on ./myapp
#   ./riff-loop.sh                          # default: up to 20 iterations in current dir
#
# Options:
#   -n <count>   Maximum number of iterations (overrides RIFF_MAX_ITERATIONS)
#
# Prerequisites:
#   - Claude Code CLI installed and authenticated
#   - RIFF framework initialized in the project (/riff:init done)
#   - ROADMAP.yaml exists with phases
#   - Telegram bot configured for notifications (optional, see README)
#
# Environment variables:
#   RIFF_TELEGRAM_BOT_TOKEN  - Telegram bot token for notifications
#   RIFF_TELEGRAM_CHAT_ID    - Telegram chat ID for notifications
#   RIFF_MAX_ITERATIONS      - Maximum loop iterations (default: 20, safety limit)
#   RIFF_COOLDOWN            - Seconds between iterations (default: 5)
#   RIFF_MODEL               - Model to use (default: claude-opus-4-6)

set -e

CLAUDE_PID=""
PROMPT_FILE=""

# Per-loop session identifier so concurrent loop processes (or stale markers
# from a prior run) don't cross-trigger each other's LOOP_STOP detection.
LOOP_ID="$$_$(date -u +%s)"

# Cleanup trap - kill Claude child process on Ctrl+C / SIGTERM
cleanup() {
  if [ -n "$CLAUDE_PID" ] && kill -0 "$CLAUDE_PID" 2>/dev/null; then
    kill -TERM "$CLAUDE_PID" 2>/dev/null || true
    sleep 2
    kill -KILL "$CLAUDE_PID" 2>/dev/null || true
  fi
  [ -n "$PROMPT_FILE" ] && rm -f "$PROMPT_FILE"
  exit 130
}
trap cleanup INT TERM

# Parse options
FLAG_ITERATIONS=""
while getopts "n:" opt; do
  case $opt in
    n) FLAG_ITERATIONS="$OPTARG" ;;
    *) echo "Usage: ./riff-loop.sh [-n iterations] [project-path]"; exit 1 ;;
  esac
done
shift $((OPTIND - 1))

# Configuration
PROJECT_PATH="${1:-.}"
MAX_ITERATIONS="${FLAG_ITERATIONS:-${RIFF_MAX_ITERATIONS:-20}}"
COOLDOWN="${RIFF_COOLDOWN:-5}"
MODEL="${RIFF_MODEL:-claude-opus-4-6}"
ITERATION=0

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Notification function
notify() {
  local message="$1"
  local level="${2:-info}" # info, warn, error, done

  echo -e "${BLUE}[RIFF Loop]${NC} $message"

  # Telegram notification
  if [ -n "$RIFF_TELEGRAM_BOT_TOKEN" ] && [ -n "$RIFF_TELEGRAM_CHAT_ID" ]; then
    local emoji=""
    case "$level" in
      info) emoji="🎸" ;;
      warn) emoji="⚠️" ;;
      error) emoji="🛑" ;;
      done) emoji="✅" ;;
    esac

    curl -s -X POST "https://api.telegram.org/bot${RIFF_TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${RIFF_TELEGRAM_CHAT_ID}" \
      -d "text=${emoji} RIFF: ${message}" \
      -d "parse_mode=Markdown" > /dev/null 2>&1 || true
  fi
}

# Display banner
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/templates/banner.sh"

# Check prerequisites
cd "$PROJECT_PATH"

# Detect main branch once (reliable fallback chain)
MAIN_BRANCH=$(git remote show origin 2>/dev/null | awk '/HEAD branch/ {print $NF}') \
  || MAIN_BRANCH=$(git symbolic-ref --short HEAD 2>/dev/null) \
  || MAIN_BRANCH="main"

if [ ! -f "ROADMAP.yaml" ]; then
  echo -e "${RED}Error: ROADMAP.yaml not found. Run /riff:init and /riff:start first.${NC}"
  exit 1
fi

if [ ! -d ".planning" ]; then
  echo -e "${RED}Error: .planning/ not found. Run /riff:init first.${NC}"
  exit 1
fi

# Clear stale LOOP_STOP markers OWNED BY THIS PROCESS or in legacy unscoped
# form. Markers from other loop sessions (LOOP_STOP[<other-id>]:) are left in
# place so concurrent loops don't clobber each other's stop signals.
if [ -f STATE.md ] && grep -qE "LOOP_STOP(:|\[$LOOP_ID\]:)" STATE.md 2>/dev/null; then
  notify "Clearing stale LOOP_STOP markers from previous run." "info"
  tmp=$(mktemp) && grep -vE "LOOP_STOP(:|\[$LOOP_ID\]:)" STATE.md > "$tmp" && mv "$tmp" STATE.md
fi

notify "Starting RIFF loop in $(pwd)" "info"
notify "Max iterations: $MAX_ITERATIONS | Cooldown: ${COOLDOWN}s | Model: $MODEL" "info"

# Main loop
while [ $ITERATION -lt $MAX_ITERATIONS ]; do
  ITERATION=$((ITERATION + 1))

  echo ""
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo -e "${GREEN}  RIFF Loop - Iteration $ITERATION/$MAX_ITERATIONS${NC}"
  echo -e "${GREEN}═══════════════════════════════════════════${NC}"
  echo ""

  # Count phases by status + mode + provider_mode using a single awk pass.
  # AFK-eligible = mode:AFK OR (mode:HITL AND provider_mode:sandbox). Sandbox
  # HITL phases run inside the loop via the browser-automation skill; only
  # production-provider HITL phases pause the loop. See commands/loop.md
  # § HITL vs sandbox-HITL and agents/planner.md § provider_mode.
  #
  # We flush the previous phase ONLY when we hit the next `- id:` line (or EOF),
  # not as soon as status+mode are set — otherwise a `provider_mode:` line that
  # appears after `mode:` would be missed.
  eval "$(awk '
    function flush() {
      if (status=="") return
      if (status=="todo") { todo++ }
      if (status=="blocked") { blocked++ }
      if (status=="todo" && (mode=="AFK" || (mode=="HITL" && provider=="sandbox"))) { afk_todo++ }
      status=""; mode=""; provider=""
    }
    /^[[:space:]]*-[[:space:]]*id:/ { flush() }
    /^[[:space:]]*status:/ { s=$0; sub(/.*status:[[:space:]]*/,"",s); gsub(/["'\''[:space:]]/,"",s); status=s }
    /^[[:space:]]*provider_mode:/ { p=$0; sub(/.*provider_mode:[[:space:]]*/,"",p); gsub(/["'\''[:space:]]/,"",p); provider=p; next }
    /^[[:space:]]*mode:/ { m=$0; sub(/.*mode:[[:space:]]*/,"",m); gsub(/["'\''[:space:]]/,"",m); mode=m }
    END { flush(); printf "TODO_COUNT=%d\nBLOCKED_COUNT=%d\nAFK_TODO_COUNT=%d\n", todo+0, blocked+0, afk_todo+0 }
  ' ROADMAP.yaml 2>/dev/null)"

  if [ "$TODO_COUNT" -eq 0 ]; then
    notify "All phases complete! Build finished." "done"
    break
  fi

  if [ "$BLOCKED_COUNT" -gt 0 ] && [ "$TODO_COUNT" -le "$BLOCKED_COUNT" ]; then
    notify "All remaining phases are blocked. Human intervention needed." "error"
    break
  fi

  if [ "$TODO_COUNT" -gt 0 ] && [ "$AFK_TODO_COUNT" -eq 0 ]; then
    notify "Only production-provider HITL phases remain. Human presence required for: real OAuth, real payment, MFA, DNS cutover, or irreversible migrations. Sandbox-HITL phases (provider_mode: sandbox) would have been counted as AFK-eligible." "warn"
    break
  fi

  # Run /riff:next in a fresh Claude Code instance
  # The agent reads state from disk, picks next AFK task, executes
  notify "Iteration $ITERATION: Running /riff:next..." "info"

  # Mark iteration boundary so we only react to LOOP_STOP markers written THIS iteration
  ITER_MARKER="### riff-loop iteration $ITERATION start $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "" >> STATE.md
  echo "$ITER_MARKER" >> STATE.md

  # Create a temporary prompt file for this iteration. Heredoc is unquoted so
  # $LOOP_ID interpolates — Claude will tag every LOOP_STOP marker with the
  # current loop session id, which keeps stop signals from different loops
  # (or stale legacy markers) from cross-triggering.
  PROMPT_FILE=$(mktemp)
  cat > "$PROMPT_FILE" << RIFF_PROMPT
You are running in RIFF loop (AFK mode). Execute /riff:next with these constraints:
- Eligible phases: mode: AFK OR (mode: HITL AND provider_mode: sandbox). Production-provider HITL phases are NOT eligible and must be skipped.
- For sandbox-HITL phases: route any provider verification through the user-level browser-automation skill using a headless driver (Lightpanda or agent-browser). Capture screenshots + console transcript into the phase SUMMARY.md under a "## Sandbox verification" block. Use sandbox/test credentials only. If browser-automation is unavailable or cannot run headlessly, write "LOOP_STOP[$LOOP_ID]: sandbox verification unavailable — falling back to HITL" to STATE.md and exit.
- On Confident/Likely assumptions: proceed without asking
- On Unclear assumptions: write "LOOP_STOP[$LOOP_ID]: unclear assumptions" to STATE.md and exit
- On R3 deviation: write "LOOP_STOP[$LOOP_ID]: R3 architecture change needed" to STATE.md and exit
- On verification FAIL: write "LOOP_STOP[$LOOP_ID]: verification failed" to STATE.md and exit
- On security CRITICAL/HIGH: write "LOOP_STOP[$LOOP_ID]: security issue" to STATE.md and exit
- After successful completion: exit normally
- Branch workflow: create branch riff/phase-N-slug, commit per task, create PR, then STOP
- Never auto-merge PRs. The user reviews and merges manually after the loop completes.
RIFF_PROMPT

  # Execute with Claude Code CLI (synchronous, foreground)
  # --settings: AFK allowlist (Bash prefix allow + denylist + dangerous-command-guard hook).
  # Replaces --dangerously-skip-permissions so prompt-injection in repo content
  # cannot escalate to host destruction. See references/AFK-SAFETY.md.
  AFK_SETTINGS="$SCRIPT_DIR/templates/settings.afk.json"
  if [ ! -f "$AFK_SETTINGS" ]; then
    notify "AFK settings missing at $AFK_SETTINGS. Refusing to run without sandboxed permissions." "error"
    exit 1
  fi
  PRE_SPAWN_BRANCH=$(git branch --show-current)

  set +e
  claude -p "$(cat "$PROMPT_FILE")" \
    --model "$MODEL" \
    --settings "$AFK_SETTINGS" 2>&1 &
  CLAUDE_PID=$!
  wait "$CLAUDE_PID"
  CLAUDE_EXIT=$?
  set -e

  rm -f "$PROMPT_FILE"
  PROMPT_FILE=""

  if [ "$CLAUDE_EXIT" -eq 0 ]; then
    echo -e "${GREEN}Iteration $ITERATION: agent finished.${NC}"
  else
    notify "Iteration $ITERATION failed with error (exit $CLAUDE_EXIT). Stopping loop." "error"
    git checkout "$MAIN_BRANCH" 2>/dev/null || true
    break
  fi

  # Ensure we're back on main after the agent finishes (PR created but not merged)
  CURRENT_BRANCH=$(git branch --show-current)
  if [ "$CURRENT_BRANCH" != "$MAIN_BRANCH" ]; then
    echo -e "${YELLOW}Warning: agent left us on branch '$CURRENT_BRANCH'. Returning to $MAIN_BRANCH.${NC}"
    if [ -n "$(git status --porcelain)" ]; then
      git stash push -m "riff-loop: uncommitted changes from branch $CURRENT_BRANCH (iteration $ITERATION)" || true
      echo -e "${YELLOW}Warning: uncommitted changes stashed. Recover with: git stash list${NC}"
    fi
    git checkout "$MAIN_BRANCH"
    git pull origin "$MAIN_BRANCH" 2>/dev/null || true
  fi

  # Check if the loop should stop — only consider LOOP_STOP lines written
  # AFTER the iteration marker AND owned by this loop session (or in legacy
  # unscoped form, in case Claude drops the namespace tag). Trade-off: the
  # legacy arm risks cross-triggering on a concurrent loop's bare marker, but
  # we'd rather over-stop than miss a real stop signal (e.g. security issue).
  STOP_REASON=$(awk -v marker="$ITER_MARKER" -v loop_id="$LOOP_ID" '
    $0==marker { seen=1; next }
    seen && (index($0, "LOOP_STOP[" loop_id "]") || index($0, "LOOP_STOP:")) { print; exit }
  ' STATE.md 2>/dev/null)
  if [ -n "$STOP_REASON" ]; then
    notify "Loop stopped: $STOP_REASON" "warn"
    break
  fi

  # Check if all phases are now done
  REMAINING=$(grep -c 'status: todo' ROADMAP.yaml 2>/dev/null || echo "0")
  if [ "$REMAINING" -eq 0 ]; then
    notify "All phases complete! Build finished." "done"
    break
  fi

  # Cooldown between iterations
  if [ $ITERATION -lt $MAX_ITERATIONS ]; then
    echo -e "${BLUE}Cooldown: ${COOLDOWN}s before next iteration...${NC}"
    sleep "$COOLDOWN"
  fi
done

# Check for framework modifications
if [ -d ".riff" ] && [ -d ".riff/.git" ]; then
  RIFF_CHANGES=$(cd .riff && git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  if [ "$RIFF_CHANGES" -gt 0 ]; then
    echo ""
    echo -e "${YELLOW}═══════════════════════════════════════════${NC}"
    echo -e "${YELLOW}  Framework Changes Pending Review${NC}"
    echo -e "${YELLOW}═══════════════════════════════════════════${NC}"
    echo ""
    (cd .riff && git status --short)
    echo ""
    echo -e "${YELLOW}Review:  cd .riff && git diff${NC}"
    echo -e "${YELLOW}Accept:  cd .riff && git add -A && git commit -m \"learn: description\" && git push${NC}"
    echo -e "${YELLOW}Discard: cd .riff && git checkout .${NC}"
    echo ""
    notify "Framework has $RIFF_CHANGES pending changes. Review before pushing." "warn"
  fi
fi

# Final status
echo ""
echo -e "${GREEN}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}  RIFF Loop Complete${NC}"
echo -e "${GREEN}  Iterations: $ITERATION${NC}"
echo -e "${GREEN}═══════════════════════════════════════════${NC}"

notify "Loop finished after $ITERATION iterations." "info"

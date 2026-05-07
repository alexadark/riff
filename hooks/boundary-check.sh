#!/bin/bash
# RIFF Boundary Check - PostToolUse hook for Edit/Write
# Checks if the modified file is within the current task's boundary list
# Configured as a Claude Code PostToolUse hook in .claude/settings.json

FILE_PATH="$1"

# Read the active phase from the sidecar file (written by /riff:next Step 2b,
# cleared by Step 0 at the start of every run and Step 8c on local_no_ff merge).
# This replaces the previous mtime heuristic which broke under github_button
# strategy (STATE.md was not updated until the next run's Step 0).
ACTIVE_PHASE_FILE=".planning/active-phase.txt"

if [ ! -f "$ACTIVE_PHASE_FILE" ]; then
  # No active phase declared - skip check (probably /riff:quick or manual edit)
  exit 0
fi

ACTIVE_PHASE=$(cat "$ACTIVE_PHASE_FILE")
CURRENT_PLAN=".planning/phases/$ACTIVE_PHASE/PLAN.md"

if [ ! -f "$CURRENT_PLAN" ]; then
  # Plan not yet written - skip check
  exit 0
fi

# Extract boundary files from the plan (read from "Boundaries:" until next heading or blank line)
BOUNDARIES=$(awk '/^[#]*.*Boundaries/,/^($|#)/' "$CURRENT_PLAN" 2>/dev/null | grep '`' | sed 's/.*`\([^`]*\)`.*/\1/' || true)

if [ -z "$BOUNDARIES" ]; then
  # No boundaries defined - skip check
  exit 0
fi

# Check if the modified file is in the boundary list
RELATIVE_PATH=$(echo "$FILE_PATH" | sed "s|$(pwd)/||")

if echo "$BOUNDARIES" | grep -qF "$RELATIVE_PATH"; then
  exit 0
else
  echo "RIFF WARNING: $RELATIVE_PATH is outside task boundaries."
  echo "Allowed files: $BOUNDARIES"
  echo "If this is intentional, log it as an R2 deviation."

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  bash "$SCRIPT_DIR/log-warning.sh" "boundary" "$FILE_PATH" "Outside task boundaries. Allowed: $BOUNDARIES"
  exit 0  # Warning only, don't block
fi

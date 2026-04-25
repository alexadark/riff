#!/bin/bash
# RIFF Boundary Check - PostToolUse hook for Edit/Write
# Checks if the modified file is within the current task's boundary list
# Configured as a Claude Code PostToolUse hook in .claude/settings.json

FILE_PATH="$1"

# Find the current active PLAN.md
CURRENT_PLAN=$(find .planning/phases -name "PLAN.md" -newer STATE.md 2>/dev/null | head -1)

if [ -z "$CURRENT_PLAN" ]; then
  # No active plan - skip check (probably /riff:quick or manual edit)
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

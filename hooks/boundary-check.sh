#!/bin/bash
# RIFF Boundary Check - PostToolUse hook for Edit/Write/apply_patch
# Checks if the modified file is within the current task's boundary list
# Wired in .claude/settings.json (Claude) and ~/.codex/hooks.json (Codex).
# Reads JSON payload on stdin; falls back to $1 for legacy invocation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/extract-files.sh"
source "$SCRIPT_DIR/lib/scratch-mode.sh"
riff_extract_files "$@"

# Resolve project root from payload cwd; fall back to current pwd. boundary list
# is rooted in the project, so we cd into RIFF_CWD before reading .planning/.
PROJECT_ROOT="${RIFF_CWD:-$(pwd)}"
cd "$PROJECT_ROOT" 2>/dev/null || true

ACTIVE_PHASE_FILE=".planning/active-phase.txt"
if [ ! -f "$ACTIVE_PHASE_FILE" ]; then
  exit 0
fi

ACTIVE_PHASE=$(cat "$ACTIVE_PHASE_FILE")
CURRENT_PLAN=".planning/phases/$ACTIVE_PHASE/PLAN.md"

if [ ! -f "$CURRENT_PLAN" ]; then
  exit 0
fi

# Extract boundary files from the plan. Range starts at the Boundaries
# header and ends on the first blank line. (Previously also terminated on
# `#`, which collapsed the range to the header line itself.)
BOUNDARIES=$(awk '/^#+.*Boundaries/,/^$/' "$CURRENT_PLAN" 2>/dev/null | grep '`' | sed 's/.*`\([^`]*\)`.*/\1/' || true)

if [ -z "$BOUNDARIES" ]; then
  exit 0
fi

check_file() {
  local FILE_PATH="$1"
  local RELATIVE_PATH
  RELATIVE_PATH=$(echo "$FILE_PATH" | sed "s|$PROJECT_ROOT/||")

  if echo "$BOUNDARIES" | grep -qF "$RELATIVE_PATH"; then
    return 0
  fi

  riff_scratch_banner
  echo "RIFF WARNING: $RELATIVE_PATH is outside task boundaries."
  echo "Allowed files: $BOUNDARIES"
  echo "If this is intentional, log it as an R2 deviation."

  bash "$SCRIPT_DIR/log-warning.sh" "boundary" "$FILE_PATH" "Outside task boundaries. Allowed: $BOUNDARIES"
  riff_scratch_reconcile_append "boundary" "$FILE_PATH" "Outside task boundaries. Allowed: $BOUNDARIES"
}

for FILE_PATH in "${RIFF_FILES[@]}"; do
  check_file "$FILE_PATH"
done

exit 0

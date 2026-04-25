#!/bin/bash
# RIFF Warning Accumulator
# Called by all hooks to persist warnings for end-of-phase review
#
# Usage: bash log-warning.sh <hook-name> <file-path> <message>
# Output: appends to .planning/warnings.log
#
# The verifier agent reads this file during phase verification.
# Cleared at the start of each new phase by /riff:next.

HOOK_NAME="$1"
FILE_PATH="$2"
shift 2
MESSAGE="$*"

# Find project root (where .planning/ lives)
PROJECT_ROOT="."
if [ -d ".planning" ]; then
  PROJECT_ROOT="."
elif [ -d "../.planning" ]; then
  PROJECT_ROOT=".."
else
  # No .planning directory - not a RIFF project, skip
  exit 0
fi

LOG_FILE="$PROJECT_ROOT/.planning/warnings.log"

# Create log file if it doesn't exist
if [ ! -f "$LOG_FILE" ]; then
  echo "# RIFF Warnings (reviewed by verifier at end of phase)" > "$LOG_FILE"
  echo "# Auto-cleared at phase start. Do not edit manually." >> "$LOG_FILE"
  echo "" >> "$LOG_FILE"
fi

# Append warning with timestamp
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
echo "[$TIMESTAMP] [$HOOK_NAME] $FILE_PATH" >> "$LOG_FILE"
echo "  $MESSAGE" >> "$LOG_FILE"
echo "" >> "$LOG_FILE"

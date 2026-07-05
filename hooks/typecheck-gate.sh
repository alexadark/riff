#!/bin/bash
# RIFF Typecheck Gate - PostToolUse hook for Edit/Write on .ts/.tsx files
# Runs tsc --noEmit after TypeScript file edits to catch type errors early
# Configured as a Claude Code PostToolUse hook in .claude/settings.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/extract-files.sh"
riff_extract_files "$@"

FILE_PATH=""
for candidate in "${RIFF_FILES[@]}"; do
  [[ "$candidate" == *"/.planning/"* ]] && continue
  if [[ "$candidate" =~ \.(ts|tsx)$ ]]; then
    FILE_PATH="$candidate"
    break
  fi
done

# Only run for TypeScript files
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Check if tsc is available
if ! command -v npx &> /dev/null; then
  exit 0
fi

# Check if tsconfig exists
if [ ! -f "tsconfig.json" ]; then
  exit 0
fi

# Skip-on-recent-failure cache: if tsc just timed out, give the toolchain
# a cooldown window so interactive flow isn't bricked by a stuck process.
GATE_NAME="typecheck"
CACHE_DIR=".planning/.gate-cache"
CACHE_FILE="$CACHE_DIR/$GATE_NAME.timeout"
COOLDOWN=300

if [ -f "$CACHE_FILE" ]; then
  LAST=$(cat "$CACHE_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  AGE=$((NOW - LAST))
  if [ "$AGE" -ge 0 ] && [ "$AGE" -lt "$COOLDOWN" ]; then
    REMAINING=$((COOLDOWN - AGE))
    echo "RIFF Typecheck: skipped (cooldown ${REMAINING}s remaining after recent timeout)"
    exit 0
  fi
fi

# Pick a timeout binary: macOS users often have only `gtimeout` (coreutils via brew).
TIMEOUT_BIN=""
if command -v timeout &> /dev/null; then
  TIMEOUT_BIN="timeout"
elif command -v gtimeout &> /dev/null; then
  TIMEOUT_BIN="gtimeout"
fi

# Run typecheck (quick, no emit)
if [ -n "$TIMEOUT_BIN" ]; then
  OUTPUT=$($TIMEOUT_BIN 60 npx tsc --noEmit 2>&1)
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 124 ]; then
    mkdir -p "$CACHE_DIR" 2>/dev/null && date +%s > "$CACHE_FILE" 2>/dev/null
    echo "RIFF Typecheck: timed out after 60s — skipping for next ${COOLDOWN}s."
    exit 0
  fi
else
  OUTPUT=$(npx tsc --noEmit 2>&1)
  EXIT_CODE=$?
fi

if [ $EXIT_CODE -ne 0 ]; then
  # Filter to only show errors related to the modified file (use relative path for precision)
  RELATIVE_PATH=$(echo "$FILE_PATH" | sed "s|$(pwd)/||")
  RELEVANT=$(echo "$OUTPUT" | grep -F "$RELATIVE_PATH" || true)
  if [ -n "$RELEVANT" ]; then
    echo "RIFF Typecheck: errors in modified file:"
    echo "$RELEVANT"
  else
    echo "RIFF Typecheck: type errors detected (may be pre-existing):"
    echo "$OUTPUT" | head -10
  fi
  # Don't block - just inform
  exit 0
fi

exit 0

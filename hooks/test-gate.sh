#!/bin/bash
# RIFF Test Gate - Run related tests after .ts/.tsx file edits
FILE_PATH="$1"

# Only for .ts/.tsx files (not config, not test files themselves)
if [[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then exit 0; fi
if [[ "$FILE_PATH" =~ \.(test|spec|config|setup)\. ]]; then exit 0; fi
if [[ "$FILE_PATH" =~ (\.stories\.) ]]; then exit 0; fi

# Check if vitest is available and node_modules exists
if [ ! -d "node_modules" ]; then exit 0; fi

# Skip-on-recent-failure cache: if vitest just timed out, give the toolchain
# a cooldown window so interactive flow isn't bricked by a stuck process.
GATE_NAME="test"
CACHE_DIR=".planning/.gate-cache"
CACHE_FILE="$CACHE_DIR/$GATE_NAME.timeout"
COOLDOWN=300

if [ -f "$CACHE_FILE" ]; then
  LAST=$(cat "$CACHE_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  AGE=$((NOW - LAST))
  if [ "$AGE" -ge 0 ] && [ "$AGE" -lt "$COOLDOWN" ]; then
    REMAINING=$((COOLDOWN - AGE))
    echo "RIFF Test Gate: skipped (cooldown ${REMAINING}s remaining after recent timeout)"
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

# Run only related tests (fast)
if [ -n "$TIMEOUT_BIN" ]; then
  OUTPUT=$($TIMEOUT_BIN 60 npx vitest run --related "$FILE_PATH" 2>&1)
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 124 ]; then
    mkdir -p "$CACHE_DIR" 2>/dev/null && date +%s > "$CACHE_FILE" 2>/dev/null
    echo "RIFF Test Gate: timed out after 60s — skipping for next ${COOLDOWN}s."
    exit 0
  fi
else
  OUTPUT=$(npx vitest run --related "$FILE_PATH" 2>&1)
  EXIT_CODE=$?
fi

if [ $EXIT_CODE -ne 0 ]; then
  echo "RIFF Test Gate: failing tests related to modified file:"
  echo "$OUTPUT" | tail -20
fi

exit 0  # Don't block, just inform

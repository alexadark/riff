#!/bin/bash
# RIFF Typecheck Gate - PostToolUse hook for Edit/Write on .ts/.tsx files
# Runs tsc --noEmit after TypeScript file edits to catch type errors early
# Configured as a Claude Code PostToolUse hook in .claude/settings.json

FILE_PATH="$1"

# Only run for TypeScript files
if [[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then
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

# Run typecheck (quick, no emit)
OUTPUT=$(npx tsc --noEmit 2>&1)
EXIT_CODE=$?

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

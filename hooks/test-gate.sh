#!/bin/bash
# RIFF Test Gate - Run related tests after .ts/.tsx file edits
FILE_PATH="$1"

# Only for .ts/.tsx files (not config, not test files themselves)
if [[ ! "$FILE_PATH" =~ \.(ts|tsx)$ ]]; then exit 0; fi
if [[ "$FILE_PATH" =~ \.(test|spec|config|setup)\. ]]; then exit 0; fi
if [[ "$FILE_PATH" =~ (\.stories\.) ]]; then exit 0; fi

# Check if vitest is available and node_modules exists
if [ ! -d "node_modules" ]; then exit 0; fi

# Run only related tests (fast)
OUTPUT=$(npx vitest run --related "$FILE_PATH" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "RIFF Test Gate: failing tests related to modified file:"
  echo "$OUTPUT" | tail -20
fi

exit 0  # Don't block, just inform

#!/bin/bash
# RIFF Lint Gate - PostToolUse hook for Edit/Write on JS/TS files
# Runs the project's linter after edits to catch quality issues early
# Configured as a Claude Code PostToolUse hook in .claude/settings.json

FILE_PATH="$1"

# Only run for JS/TS files
if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  exit 0
fi

# Skip test files and config files
if [[ "$FILE_PATH" =~ \.(test|spec|config)\.(ts|tsx|js|jsx)$ ]]; then
  exit 0
fi

# Detect linter: Biome > ESLint (check project config). Use a bash array for
# the command so quoting survives flags or paths with spaces.
LINTER=""
LINT_CMD=()

if [ -f "biome.json" ] || [ -f "biome.jsonc" ]; then
  if command -v npx &> /dev/null; then
    LINTER="Biome"
    LINT_CMD=(npx @biomejs/biome check --no-errors-on-unmatched)
  fi
elif [ -f ".eslintrc" ] || [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ] || [ -f ".eslintrc.cjs" ] || [ -f "eslint.config.js" ] || [ -f "eslint.config.mjs" ] || [ -f "eslint.config.ts" ]; then
  if command -v npx &> /dev/null; then
    LINTER="ESLint"
    LINT_CMD=(npx eslint --no-error-on-unmatched-pattern)
  fi
fi

if [ -z "$LINTER" ]; then
  # No linter configured in project - skip silently
  exit 0
fi

# Skip-on-recent-failure cache: if the linter just timed out, give the toolchain
# a cooldown window so interactive flow isn't bricked by a stuck process.
GATE_NAME="lint"
CACHE_DIR=".planning/.gate-cache"
CACHE_FILE="$CACHE_DIR/$GATE_NAME.timeout"
COOLDOWN=300

if [ -f "$CACHE_FILE" ]; then
  LAST=$(cat "$CACHE_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  AGE=$((NOW - LAST))
  if [ "$AGE" -ge 0 ] && [ "$AGE" -lt "$COOLDOWN" ]; then
    REMAINING=$((COOLDOWN - AGE))
    echo "RIFF Lint ($LINTER): skipped (cooldown ${REMAINING}s remaining after recent timeout)"
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

# Run linter on the modified file only
if [ -n "$TIMEOUT_BIN" ]; then
  OUTPUT=$("$TIMEOUT_BIN" 60 "${LINT_CMD[@]}" "$FILE_PATH" 2>&1)
  EXIT_CODE=$?
  if [ "$EXIT_CODE" -eq 124 ]; then
    mkdir -p "$CACHE_DIR" 2>/dev/null && date +%s > "$CACHE_FILE" 2>/dev/null
    echo "RIFF Lint ($LINTER): timed out after 60s — skipping for next ${COOLDOWN}s."
    exit 0
  fi
else
  OUTPUT=$("${LINT_CMD[@]}" "$FILE_PATH" 2>&1)
  EXIT_CODE=$?
fi

if [ $EXIT_CODE -ne 0 ]; then
  echo "RIFF Lint ($LINTER): issues in modified file:"
  echo "$OUTPUT" | head -20
  # Don't block - just inform
  exit 0
fi

exit 0

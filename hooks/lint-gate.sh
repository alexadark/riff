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

# Detect linter: Biome > ESLint (check project config)
LINTER=""
LINT_CMD=""

if [ -f "biome.json" ] || [ -f "biome.jsonc" ]; then
  if command -v npx &> /dev/null; then
    LINTER="Biome"
    LINT_CMD="npx @biomejs/biome check --no-errors-on-unmatched"
  fi
elif [ -f ".eslintrc" ] || [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ] || [ -f ".eslintrc.cjs" ] || [ -f "eslint.config.js" ] || [ -f "eslint.config.mjs" ] || [ -f "eslint.config.ts" ]; then
  if command -v npx &> /dev/null; then
    LINTER="ESLint"
    LINT_CMD="npx eslint --no-error-on-unmatched-pattern"
  fi
fi

if [ -z "$LINTER" ]; then
  # No linter configured in project - skip silently
  exit 0
fi

# Run linter on the modified file only
OUTPUT=$($LINT_CMD "$FILE_PATH" 2>&1)
EXIT_CODE=$?

if [ $EXIT_CODE -ne 0 ]; then
  echo "RIFF Lint ($LINTER): issues in modified file:"
  echo "$OUTPUT" | head -20
  # Don't block - just inform
  exit 0
fi

exit 0

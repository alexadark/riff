#!/bin/bash
# RIFF Orphan File Check - Pre-commit hook (added to security-scan chain)
# Checks if newly added source files are imported/referenced somewhere
# Rule: Verifier's "#1 silent failure" is orphaned files
#
# This runs as part of the pre-commit chain. At commit time,
# both the new file and its import should be staged.

set -e

YELLOW='\033[1;33m'
NC='\033[0m'

# Get newly added files (not modified, only Added)
NEW_FILES=$(git diff --cached --name-only --diff-filter=A 2>/dev/null || true)

if [ -z "$NEW_FILES" ]; then
  exit 0
fi

ORPHANS=0

for file in $NEW_FILES; do
  # Only check source files (not configs, not tests, not types)
  if [[ ! "$file" =~ \.(ts|tsx|js|jsx)$ ]]; then
    continue
  fi

  # Skip index/barrel files, test files, config files, type declaration files
  BASENAME=$(basename "$file")
  if [[ "$BASENAME" =~ ^(index|barrel)\. ]] || \
     [[ "$BASENAME" =~ \.(test|spec|config|d)\. ]] || \
     [[ "$BASENAME" =~ ^(vite|tsconfig|tailwind|postcss|eslint|biome) ]]; then
    continue
  fi

  # Skip files in known non-import locations
  if [[ "$file" =~ (scripts/|migrations/|seeds/|fixtures/|__tests__/) ]]; then
    continue
  fi

  # Get the module name (filename without extension) for import search
  MODULE_NAME="${BASENAME%.*}"

  # Check if this file is imported anywhere in staged files or existing codebase
  # Search in staged content first
  STAGED_IMPORT=$(git diff --cached -U0 2>/dev/null | grep -c "from.*['\"].*${MODULE_NAME}['\"]" || true)

  if [ "$STAGED_IMPORT" -gt 0 ]; then
    continue
  fi

  # Search in existing codebase
  EXISTING_IMPORT=$(grep -rl "from.*['\"].*${MODULE_NAME}['\"]" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" . 2>/dev/null | head -1 || true)

  if [ -n "$EXISTING_IMPORT" ]; then
    continue
  fi

  # Check for route convention (framework auto-imports like React Router file-based routing)
  if [[ "$file" =~ (routes/|pages/|app/) ]]; then
    continue
  fi

  if [ $ORPHANS -eq 0 ]; then
    echo -e "  ${YELLOW}WARNING: Orphan file(s) detected (not imported anywhere):${NC}"
  fi
  echo -e "    ${YELLOW}$file${NC}"
  ORPHANS=$((ORPHANS + 1))

  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  bash "$SCRIPT_DIR/log-warning.sh" "orphan-file" "$file" "New file not imported anywhere. Verify wiring."
done

if [ $ORPHANS -gt 0 ]; then
  echo "  These files are not imported by any other file. Verify they're wired correctly."
fi

# Warning only - don't block
exit 0

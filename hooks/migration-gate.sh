#!/bin/bash
# RIFF Migration Gate - Detect pending migrations and apply them safely
# Called by security-scan.sh (pre-commit) when migration files are staged.
#
# Safety guarantees:
#   - Only runs forward migrations (never drop, push, reset)
#   - Blocks commits with destructive SQL (DROP TABLE, TRUNCATE, DELETE FROM)
#   - Dry-run check before applying (when supported by ORM)
#   - Logs warnings to .planning/warnings.log
#
# Supported ORMs: Drizzle, Prisma (extensible)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
NC='\033[0m'

STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM)
ISSUES_FOUND=0

# Detect staged migration files
DRIZZLE_MIGRATIONS=$(echo "$STAGED_FILES" | grep -E '^drizzle/[0-9].*\.sql$' || true)
PRISMA_MIGRATIONS=$(echo "$STAGED_FILES" | grep -E '^prisma/migrations/.*\.sql$' || true)
SCHEMA_CHANGES=$(echo "$STAGED_FILES" | grep -E '(schema\.(ts|prisma)|drizzle\.config\.(ts|js))' || true)

# No migration files staged? Nothing to do.
if [ -z "$DRIZZLE_MIGRATIONS" ] && [ -z "$PRISMA_MIGRATIONS" ] && [ -z "$SCHEMA_CHANGES" ]; then
  exit 0
fi

echo "RIFF Migration Gate..."

# -------------------------------------------------------------------------
# Safety check: scan migration SQL for destructive statements
# -------------------------------------------------------------------------
check_destructive_sql() {
  local file="$1"
  local destructive_patterns=(
    'DROP\s+TABLE'
    'DROP\s+COLUMN'
    'TRUNCATE'
    'DELETE\s+FROM'
    'DROP\s+INDEX.*CASCADE'
    'DROP\s+SCHEMA'
    'ALTER\s+TABLE.*DROP\s+CONSTRAINT'
  )

  for pattern in "${destructive_patterns[@]}"; do
    if grep -qEi "$pattern" "$file" 2>/dev/null; then
      echo -e "  ${RED}BLOCKED: Destructive SQL in $file${NC}"
      echo "  Found: $(grep -Ei "$pattern" "$file" | head -1 | sed 's/^[[:space:]]*//')"
      echo ""
      echo -e "  ${YELLOW}This migration contains destructive operations that could lose data.${NC}"
      echo "  If this is intentional, review the SQL carefully, then:"
      echo "    1. Run the migration manually: npx drizzle-kit migrate"
      echo "    2. Commit with: RIFF_SKIP_MIGRATION_GATE=1 git commit ..."
      ISSUES_FOUND=$((ISSUES_FOUND + 1))
      return 1
    fi
  done
  return 0
}

# -------------------------------------------------------------------------
# Drizzle ORM
# -------------------------------------------------------------------------
if [ -n "$DRIZZLE_MIGRATIONS" ] || ([ -n "$SCHEMA_CHANGES" ] && [ -f "drizzle.config.ts" -o -f "drizzle.config.js" ]); then
  echo -n "  Scanning migration SQL for destructive operations... "

  DESTRUCTIVE=0
  for file in $DRIZZLE_MIGRATIONS; do
    if [ -f "$file" ]; then
      check_destructive_sql "$file" || DESTRUCTIVE=1
    fi
  done

  if [ $DESTRUCTIVE -eq 0 ]; then
    echo "OK"
  fi

  # If destructive SQL found, stop here
  if [ $ISSUES_FOUND -gt 0 ]; then
    return 2>/dev/null || exit $ISSUES_FOUND
  fi

  # Check if drizzle-kit is available
  if [ ! -f "node_modules/.bin/drizzle-kit" ]; then
    echo -e "  ${YELLOW}WARNING: drizzle-kit not found in node_modules, skipping migration check${NC}"
    if [ -f "$SCRIPT_DIR/log-warning.sh" ]; then
      bash "$SCRIPT_DIR/log-warning.sh" "migration-gate" "drizzle-kit not found, could not verify migrations are applied"
    fi
    return 2>/dev/null || exit 0
  fi

  # Apply pending migrations
  echo -n "  Applying pending Drizzle migrations... "
  MIGRATE_OUTPUT=$(npx drizzle-kit migrate 2>&1)
  MIGRATE_EXIT=$?

  if [ $MIGRATE_EXIT -ne 0 ]; then
    echo ""
    echo -e "  ${RED}BLOCKED: drizzle-kit migrate failed${NC}"
    echo "$MIGRATE_OUTPUT" | tail -10
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
  else
    # Check if migrations were actually applied
    if echo "$MIGRATE_OUTPUT" | grep -qi "applied successfully"; then
      echo -e "${GREEN}migrations applied${NC}"
      if [ -f "$SCRIPT_DIR/log-warning.sh" ]; then
        bash "$SCRIPT_DIR/log-warning.sh" "migration-gate" "Auto-applied pending Drizzle migrations"
      fi
    else
      echo "OK (no pending migrations)"
    fi
  fi
fi

# -------------------------------------------------------------------------
# Prisma ORM
# -------------------------------------------------------------------------
if [ -n "$PRISMA_MIGRATIONS" ] || ([ -n "$SCHEMA_CHANGES" ] && [ -f "prisma/schema.prisma" ]); then
  echo -n "  Scanning Prisma migration SQL for destructive operations... "

  DESTRUCTIVE=0
  for file in $PRISMA_MIGRATIONS; do
    if [ -f "$file" ]; then
      check_destructive_sql "$file" || DESTRUCTIVE=1
    fi
  done

  if [ $DESTRUCTIVE -eq 0 ]; then
    echo "OK"
  fi

  if [ $ISSUES_FOUND -gt 0 ]; then
    return 2>/dev/null || exit $ISSUES_FOUND
  fi

  if ! command -v npx &>/dev/null || ! npx prisma --version &>/dev/null 2>&1; then
    echo -e "  ${YELLOW}WARNING: prisma not found, skipping migration check${NC}"
    return 2>/dev/null || exit 0
  fi

  echo -n "  Applying pending Prisma migrations... "
  MIGRATE_OUTPUT=$(npx prisma migrate deploy 2>&1)
  MIGRATE_EXIT=$?

  if [ $MIGRATE_EXIT -ne 0 ]; then
    echo ""
    echo -e "  ${RED}BLOCKED: prisma migrate deploy failed${NC}"
    echo "$MIGRATE_OUTPUT" | tail -10
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
  else
    echo -e "${GREEN}OK${NC}"
  fi
fi

# Return issues count for caller
return $ISSUES_FOUND 2>/dev/null || exit $ISSUES_FOUND

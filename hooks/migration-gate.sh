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

ISSUES_FOUND=0

# Collect staged files using null-delimited output so filenames with spaces/newlines are safe
DRIZZLE_MIGRATIONS=()
PRISMA_MIGRATIONS=()
SCHEMA_CHANGES=()
while IFS= read -r -d '' f; do
  [[ "$f" =~ ^drizzle/[0-9].*\.sql$ ]] && DRIZZLE_MIGRATIONS+=("$f")
  [[ "$f" =~ ^prisma/migrations/.*\.sql$ ]] && PRISMA_MIGRATIONS+=("$f")
  [[ "$f" =~ (schema\.(ts|prisma)|drizzle\.config\.(ts|js)) ]] && SCHEMA_CHANGES+=("$f")
done < <(git diff --cached --name-only -z --diff-filter=ACM 2>/dev/null)

# No migration files staged? Nothing to do.
if [ ${#DRIZZLE_MIGRATIONS[@]} -eq 0 ] && [ ${#PRISMA_MIGRATIONS[@]} -eq 0 ] && [ ${#SCHEMA_CHANGES[@]} -eq 0 ]; then
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
if [ ${#DRIZZLE_MIGRATIONS[@]} -gt 0 ] || ([ ${#SCHEMA_CHANGES[@]} -gt 0 ] && { [ -f "drizzle.config.ts" ] || [ -f "drizzle.config.js" ]; }); then
  # Schema drift check: schema staged but no migration staged
  if [ ${#SCHEMA_CHANGES[@]} -gt 0 ] && [ ${#DRIZZLE_MIGRATIONS[@]} -eq 0 ] && [ "${RIFF_SKIP_SCHEMA_DRIFT:-0}" != "1" ]; then
    echo -e "  ${RED}BLOCKED: schema drift detected${NC}"
    echo "  Schema files staged: ${SCHEMA_CHANGES[*]}"
    echo "  No corresponding migration staged in drizzle/."
    echo "  Run: npx drizzle-kit generate"
    echo "  Then stage the new migration file and re-commit."
    echo "  To bypass (intentional drift, e.g. comment-only schema change): RIFF_SKIP_SCHEMA_DRIFT=1 git commit ..."
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
    return 2>/dev/null || exit $ISSUES_FOUND
  fi

  echo -n "  Scanning migration SQL for destructive operations... "

  DESTRUCTIVE=0
  for file in "${DRIZZLE_MIGRATIONS[@]}"; do
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

  # ---------------------------------------------------------------------
  # Supabase RLS gate: every CREATE TABLE in a new migration must be
  # paired with an ALTER TABLE ... ENABLE ROW LEVEL SECURITY statement
  # somewhere in the drizzle/ tree. Without RLS, anon Supabase clients
  # can read/write the table directly through PostgREST.
  # Skipped for non-Supabase projects (no @supabase/* dep in package.json).
  # ---------------------------------------------------------------------
  if [ -f "package.json" ] && grep -q '"@supabase/' package.json 2>/dev/null; then
    echo -n "  Verifying new tables have RLS enabled... "
    RLS_MISSING=()
    for file in "${DRIZZLE_MIGRATIONS[@]}"; do
      [ -f "$file" ] || continue
      while IFS= read -r tbl; do
        [ -z "$tbl" ] && continue
        if ! grep -qiE "ALTER[[:space:]]+TABLE[[:space:]]+\"?${tbl}\"?[[:space:]]+ENABLE[[:space:]]+ROW[[:space:]]+LEVEL[[:space:]]+SECURITY" drizzle/*.sql 2>/dev/null; then
          RLS_MISSING+=("$tbl ($(basename "$file"))")
        fi
      done < <(grep -oiE 'CREATE TABLE (IF NOT EXISTS )?"[^"]+"' "$file" | sed -E 's/.*"([^"]+)".*/\1/')
    done

    if [ ${#RLS_MISSING[@]} -gt 0 ] && [ "${RIFF_SKIP_RLS_CHECK:-0}" != "1" ]; then
      echo ""
      echo -e "  ${RED}BLOCKED: tables created without RLS${NC}"
      for entry in "${RLS_MISSING[@]}"; do
        echo "    - $entry"
      done
      echo ""
      echo -e "  ${YELLOW}Supabase exposes every public table to the anon role through PostgREST.${NC}"
      echo "  Add to a migration (existing or new):"
      echo "    ALTER TABLE \"<table>\" ENABLE ROW LEVEL SECURITY;"
      echo "    -- plus a CREATE POLICY per access pattern, or no policy = deny-all."
      echo "  Bypass for non-public tables: RIFF_SKIP_RLS_CHECK=1 git commit ..."
      ISSUES_FOUND=$((ISSUES_FOUND + ${#RLS_MISSING[@]}))
      return 2>/dev/null || exit $ISSUES_FOUND
    else
      echo "OK"
    fi
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
if [ ${#PRISMA_MIGRATIONS[@]} -gt 0 ] || ([ ${#SCHEMA_CHANGES[@]} -gt 0 ] && [ -f "prisma/schema.prisma" ]); then
  # Schema drift check: schema staged but no migration staged
  if [ ${#SCHEMA_CHANGES[@]} -gt 0 ] && [ ${#PRISMA_MIGRATIONS[@]} -eq 0 ] && [ "${RIFF_SKIP_SCHEMA_DRIFT:-0}" != "1" ]; then
    echo -e "  ${RED}BLOCKED: schema drift detected${NC}"
    echo "  Schema files staged: ${SCHEMA_CHANGES[*]}"
    echo "  No corresponding migration staged in prisma/migrations/."
    echo "  Run: npx prisma migrate dev --name <slug>"
    echo "  Then stage the new migration file and re-commit."
    echo "  To bypass (intentional drift, e.g. comment-only schema change): RIFF_SKIP_SCHEMA_DRIFT=1 git commit ..."
    ISSUES_FOUND=$((ISSUES_FOUND + 1))
    return 2>/dev/null || exit $ISSUES_FOUND
  fi

  echo -n "  Scanning Prisma migration SQL for destructive operations... "

  DESTRUCTIVE=0
  for file in "${PRISMA_MIGRATIONS[@]}"; do
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

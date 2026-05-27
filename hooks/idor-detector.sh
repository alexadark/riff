#!/bin/bash
# RIFF IDOR Pattern Detector - PostToolUse hook for Edit/Write/apply_patch
# Detects database queries using an ID parameter without user scoping
# Rule: "No IDOR: always scope queries to the authenticated user"
# Wired in .claude/settings.json (Claude) and ~/.codex/hooks.json (Codex).
# Reads JSON payload on stdin; falls back to $1 for legacy invocation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/extract-files.sh"
riff_extract_files "$@"

check_file() {
  local FILE_PATH="$1"

  if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
    return 0
  fi

  if [[ "$FILE_PATH" =~ \.(test|spec|config)\. ]]; then
    return 0
  fi

  if echo "$FILE_PATH" | grep -qEi '(component|hook|util|type|interface|style|css|layout|ui/)'; then
    return 0
  fi

  local DANGEROUS_LINES
  DANGEROUS_LINES=$(grep -n \
    -e 'params\.id\|params\..*Id\|searchParams.*id' \
    "$FILE_PATH" 2>/dev/null || true)

  if [ -z "$DANGEROUS_LINES" ]; then
    return 0
  fi

  local USER_SCOPE_PATTERNS=(
    "userId"
    "user\.id"
    "user_id"
    "session\.user"
    "currentUser"
    "ctx\.user"
    "req\.user"
    "ownerId"
    "owner_id"
    "createdBy"
    "created_by"
    "authorId"
    "author_id"
  )

  for pattern in "${USER_SCOPE_PATTERNS[@]}"; do
    if grep -q "$pattern" "$FILE_PATH" 2>/dev/null; then
      return 0
    fi
  done

  echo "RIFF IDOR Detector: database query with external ID but no user scoping."
  echo "  File: $FILE_PATH"
  echo "  Found ID from params/request:"
  echo "$DANGEROUS_LINES" | head -5 | sed 's/^/    /'
  echo "  Ensure queries are scoped to the authenticated user (e.g., WHERE userId = user.id)."

  local LINES_SUMMARY
  LINES_SUMMARY=$(echo "$DANGEROUS_LINES" | head -3 | tr '\n' ' ')
  bash "$SCRIPT_DIR/log-warning.sh" "idor" "$FILE_PATH" "DB query with external ID, no user scoping: $LINES_SUMMARY"
}

for FILE_PATH in "${RIFF_FILES[@]}"; do
  check_file "$FILE_PATH"
done

exit 0

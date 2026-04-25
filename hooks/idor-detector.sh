#!/bin/bash
# RIFF IDOR Pattern Detector - PostToolUse hook for Edit/Write
# Detects database queries using an ID parameter without user scoping
# Rule: "No IDOR: always scope queries to the authenticated user"
# Configured as a Claude Code PostToolUse hook in .claude/settings.json

FILE_PATH="$1"

# Only check source files
if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  exit 0
fi

# Skip test/config files
if [[ "$FILE_PATH" =~ \.(test|spec|config)\. ]]; then
  exit 0
fi

# Skip files that clearly aren't data access (components, utils, types)
if echo "$FILE_PATH" | grep -qEi '(component|hook|util|type|interface|style|css|layout|ui/)'; then
  exit 0
fi

# Patterns that indicate a DB query using an external ID
# These are the dangerous ones: taking an ID from params/request and querying directly
DANGEROUS_LINES=$(grep -n \
  -e 'params\.id\|params\..*Id\|searchParams.*id' \
  "$FILE_PATH" 2>/dev/null || true)

if [ -z "$DANGEROUS_LINES" ]; then
  exit 0
fi

# Now check if the file also has user scoping
USER_SCOPE_PATTERNS=(
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
    # User scoping exists - likely fine
    exit 0
  fi
done

echo "RIFF IDOR Detector: database query with external ID but no user scoping."
echo "  File: $FILE_PATH"
echo "  Found ID from params/request:"
echo "$DANGEROUS_LINES" | head -5 | sed 's/^/    /'
echo "  Ensure queries are scoped to the authenticated user (e.g., WHERE userId = user.id)."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINES_SUMMARY=$(echo "$DANGEROUS_LINES" | head -3 | tr '\n' ' ')
bash "$SCRIPT_DIR/log-warning.sh" "idor" "$FILE_PATH" "DB query with external ID, no user scoping: $LINES_SUMMARY"
exit 0

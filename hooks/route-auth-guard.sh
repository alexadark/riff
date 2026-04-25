#!/bin/bash
# RIFF Route Auth Guard - PostToolUse hook for Edit/Write
# Checks that route/API handler files include auth checks
# Rule: "Auth checks on every protected route"
# Configured as a Claude Code PostToolUse hook in .claude/settings.json

FILE_PATH="$1"

# Only check route-like files (common conventions)
if ! echo "$FILE_PATH" | grep -qEi '(route|api|action|loader|handler|middleware)'; then
  exit 0
fi

# Only check source files
if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
  exit 0
fi

# Skip test files
if [[ "$FILE_PATH" =~ \.(test|spec)\. ]]; then
  exit 0
fi

# Skip files that are clearly public (login, register, health, public)
BASENAME=$(basename "$FILE_PATH")
if echo "$BASENAME" | grep -qEi '(login|register|signup|sign-up|health|public|webhook|cron|_index)'; then
  exit 0
fi

# Check for common auth patterns
AUTH_PATTERNS=(
  "requireUserId"
  "requireUser"
  "getUser"
  "getUserId"
  "requireAuth"
  "isAuthenticated"
  "authenticate"
  "protect"
  "withAuth"
  "authGuard"
  "session\.user"
  "currentUser"
  "ctx\.user"
  "req\.user"
  "auth()"
  "getSession"
  "requireSession"
  "verifyToken"
  "supabase.*auth"
  "clerk"
)

for pattern in "${AUTH_PATTERNS[@]}"; do
  if grep -q "$pattern" "$FILE_PATH" 2>/dev/null; then
    exit 0
  fi
done

# Check for the escape hatch comment before warning
if grep -qi '// public route\|// no auth\|// unauthenticated' "$FILE_PATH" 2>/dev/null; then
  exit 0
fi

# No auth pattern found
echo "RIFF Auth Guard: no auth check detected in route file."
echo "  File: $FILE_PATH"
echo "  Expected one of: requireUserId, requireAuth, getSession, etc."
echo "  If this is a public route, add a comment: // public route"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/log-warning.sh" "route-auth" "$FILE_PATH" "No auth check detected. Expected: requireUserId, requireAuth, getSession, etc."
exit 0

#!/bin/bash
# RIFF Route Auth Guard - PostToolUse hook for Edit/Write/apply_patch
# Checks that route/API handler files include auth checks
# Rule: "Auth checks on every protected route"
# Wired in .claude/settings.json (Claude) and ~/.codex/hooks.json (Codex).
# Reads JSON payload on stdin; falls back to $1 for legacy invocation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/extract-files.sh"
source "$SCRIPT_DIR/lib/scratch-mode.sh"
riff_extract_files "$@"

check_file() {
  local FILE_PATH="$1"

  if ! echo "$FILE_PATH" | grep -qEi '(route|api|action|loader|handler|middleware)'; then
    return 0
  fi

  if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
    return 0
  fi

  if [[ "$FILE_PATH" =~ \.(test|spec)\. ]]; then
    return 0
  fi

  local BASENAME
  BASENAME=$(basename "$FILE_PATH")
  if echo "$BASENAME" | grep -qEi '(login|register|signup|sign-up|health|public|webhook|cron|_index)'; then
    return 0
  fi

  local AUTH_PATTERNS=(
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
      return 0
    fi
  done

  if grep -qi '// public route\|// no auth\|// unauthenticated' "$FILE_PATH" 2>/dev/null; then
    return 0
  fi

  riff_scratch_banner
  echo "RIFF Auth Guard: no auth check detected in route file."
  echo "  File: $FILE_PATH"
  echo "  Expected one of: requireUserId, requireAuth, getSession, etc."
  echo "  If this is a public route, add a comment: // public route"

  bash "$SCRIPT_DIR/log-warning.sh" "route-auth" "$FILE_PATH" "No auth check detected. Expected: requireUserId, requireAuth, getSession, etc."
  riff_scratch_reconcile_append "route-auth" "$FILE_PATH" "No auth check detected. Expected: requireUserId, requireAuth, getSession, etc."
}

for FILE_PATH in "${RIFF_FILES[@]}"; do
  check_file "$FILE_PATH"
done

exit 0

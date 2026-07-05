#!/usr/bin/env bash
# RIFF Destructive Command Guard. PreToolUse hook for Bash.
# Reads PreToolUse JSON from stdin and parses .tool_input.command.
# Exits 2 to block. Configured in templates/settings*.json.
#
# Advisory guard for interactive sessions: blocks the most dangerous patterns
# but the user can re-prompt to override.

INPUT="$(cat)"
if command -v jq >/dev/null 2>&1; then
  COMMAND="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
else
  COMMAND="$(printf '%s' "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)"[[:space:]]*,.*/\1/p' | head -n1)"
fi

if [ -z "$COMMAND" ]; then
  exit 0
fi

DANGEROUS_PATTERNS=(
  "rm[[:space:]]+(-[^[:space:]]*r[^[:space:]]*f|-[^[:space:]]*f[^[:space:]]*r|-f[^[:space:]]*-r|-r[^[:space:]]*-f|--recursive)"
  "rm[[:space:]]+[^;&|]*[[:space:]]-[^[:space:]]*r[^[:space:]]*[[:space:]]+/"
  "find[[:space:]].*-delete"
  "(^|[[:space:]])(:[[:space:]]*)?>[[:space:]]*[^[:space:]]+"
  "dd[[:space:]].*of="
  "git reset --hard"
  "git push --force"
  "git push -f"
  "git checkout \.( |$)"
  "git checkout -- \.( |$)"
  "git clean -f"
  "git clean -fd"
  "git clean -fdx"
  "git branch -D"
  "git add \.\( \|$\)"
  "git add -A"
  "git add --all"
  "drop table"
  "drop database"
  "truncate table"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -Eqi "$pattern"; then
    echo "RIFF BLOCKED: Destructive command detected: $pattern" >&2
    echo "This command could cause irreversible damage." >&2
    echo "If you need to run this, ask the user for explicit confirmation first." >&2
    exit 2
  fi
done

exit 0

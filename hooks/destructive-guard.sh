#!/bin/bash
# RIFF Destructive Command Guard - PreToolUse hook for Bash
# Blocks dangerous commands that could cause irreversible damage
# Configured as a Claude Code PreToolUse hook in .claude/settings.json

COMMAND="$1"

# Patterns that should be blocked without explicit confirmation
DANGEROUS_PATTERNS=(
  "rm -rf"
  "rm -r /"
  "git reset --hard"
  "git push --force"
  "git push -f"
  "git checkout ."
  "git checkout -- ."
  "git clean -f"
  "git clean -fd"
  "git branch -D"
  "git add \."
  "git add -A"
  "git add --all"
  "drop table"
  "drop database"
  "truncate table"
)

for pattern in "${DANGEROUS_PATTERNS[@]}"; do
  if echo "$COMMAND" | grep -qi "$pattern"; then
    echo "RIFF BLOCKED: Destructive command detected: $pattern"
    echo "This command could cause irreversible damage."
    echo "If you need to run this, ask the user for explicit confirmation first."
    exit 2  # Exit code 2 = block the tool call
  fi
done

exit 0

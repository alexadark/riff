#!/bin/bash
# RIFF TODO Orphan Guard - PostToolUse hook for Edit/Write
# Checks that any // TODO comment has a matching seed or issue reference
# Rule: "No // TODO without a matching seed or issue"
# Configured as a Claude Code PostToolUse hook in .claude/settings.json

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/extract-files.sh"
riff_extract_files "$@"

for FILE_PATH in "${RIFF_FILES[@]}"; do
  [[ "$FILE_PATH" == *"/.planning/"* ]] && continue

  # Only check source files
  if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx|py|go|rs)$ ]]; then
    continue
  fi

  # Find TODO comments in the file (excluding legitimate patterns)
  TODOS=$(grep -n '//\s*TODO\|#\s*TODO\|/\*\s*TODO' "$FILE_PATH" 2>/dev/null || true)

  if [ -z "$TODOS" ]; then
    continue
  fi

  # Check each TODO for a reference (seed, issue number, or ticket)
  ORPHANS=""
  while IFS= read -r line; do
    # Valid TODOs reference: seed(name), #123, JIRA-123, or a file path
    if ! echo "$line" | grep -qEi '(seed\(|#[0-9]+|[A-Z]+-[0-9]+|\.md)'; then
      ORPHANS="$ORPHANS\n  $line"
    fi
  done <<< "$TODOS"

  if [ -n "$ORPHANS" ]; then
    MSG="Orphan TODO(s) without seed/issue reference:$ORPHANS -- Add: // TODO seed(name) or // TODO #123"
    echo "RIFF TODO Guard: orphan TODO(s) found without seed/issue reference:"
    echo -e "$ORPHANS"

    bash "$SCRIPT_DIR/log-warning.sh" "todo-orphan" "$FILE_PATH" "$MSG"
  fi
done

exit 0

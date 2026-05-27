#!/usr/bin/env bash
# Shared payload parser for RIFF PostToolUse hooks.
# Source this script at the top of a hook, call `riff_extract_files "$@"`,
# then iterate over RIFF_FILES (absolute paths) and use RIFF_CWD if needed.
#
# Handles three input shapes:
#   1. Claude Code Write/Edit  → JSON on stdin, tool_input.file_path (absolute)
#   2. Codex CLI apply_patch   → JSON on stdin, tool_input.command (patch text,
#                                 multiple files, paths relative to cwd)
#   3. Legacy/manual           → positional arg $1 (single absolute path)
#
# See protocols/HOOKS.md for the captured payload contracts.

riff_extract_files() {
  RIFF_FILES=()
  RIFF_CWD="$(pwd)"

  local payload=""
  if [ ! -t 0 ]; then
    payload="$(timeout 1 cat 2>/dev/null || true)"
  fi

  if [ -n "$payload" ] && command -v jq >/dev/null 2>&1; then
    local tool_name cwd
    tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // ""' 2>/dev/null)"
    cwd="$(printf '%s' "$payload" | jq -r '.cwd // ""' 2>/dev/null)"
    [ -n "$cwd" ] && RIFF_CWD="$cwd"

    case "$tool_name" in
      Write|Edit)
        local fp
        fp="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.absolute_path // ""' 2>/dev/null)"
        [ -n "$fp" ] && RIFF_FILES+=("$fp")
        ;;
      apply_patch)
        local patch_text f
        patch_text="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null)"
        while IFS= read -r f; do
          [ -z "$f" ] && continue
          case "$f" in
            /*) RIFF_FILES+=("$f") ;;
            *)  RIFF_FILES+=("$RIFF_CWD/$f") ;;
          esac
        done < <(printf '%s\n' "$patch_text" | awk '/^\*\*\* (Update|Add|Delete) File: / { sub(/^\*\*\* [A-Za-z]+ File: /, ""); print }')
        ;;
    esac
  fi

  if [ ${#RIFF_FILES[@]} -eq 0 ] && [ -n "${1:-}" ]; then
    RIFF_FILES=("$1")
  fi
}

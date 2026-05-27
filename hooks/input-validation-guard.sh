#!/bin/bash
# RIFF Input Validation Guard - PostToolUse hook for Edit/Write/apply_patch
# Checks that API handlers validate input with a schema
# Rule: "Validate all user input at system boundaries"
# Wired in .claude/settings.json (Claude) and ~/.codex/hooks.json (Codex).
# Reads JSON payload on stdin; falls back to $1 for legacy invocation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/extract-files.sh"
riff_extract_files "$@"

check_file() {
  local FILE_PATH="$1"

  if ! echo "$FILE_PATH" | grep -qEi '(route|api|action|handler)'; then
    return 0
  fi

  if [[ ! "$FILE_PATH" =~ \.(ts|tsx|js|jsx)$ ]]; then
    return 0
  fi

  if [[ "$FILE_PATH" =~ \.(test|spec)\. ]]; then
    return 0
  fi

  local HAS_BODY_READ=false
  local BODY_PATTERNS=(
    "request\.json"
    "request\.formData"
    "req\.body"
    "request\.body"
    "await request"
    "formData"
    "JSON\.parse"
    "body:"
  )

  for pattern in "${BODY_PATTERNS[@]}"; do
    if grep -q "$pattern" "$FILE_PATH" 2>/dev/null; then
      HAS_BODY_READ=true
      break
    fi
  done

  if [ "$HAS_BODY_READ" = false ]; then
    return 0
  fi

  local VALIDATION_PATTERNS=(
    "\.parse("
    "\.safeParse("
    "\.parseAsync("
    "\.safeParseAsync("
    "validate("
    "validateSync("
    "Joi\."
    "yup\."
    "ajv"
    "class-validator"
    "typebox"
    "valibot"
    "arktype"
    "Schema\."
  )

  for pattern in "${VALIDATION_PATTERNS[@]}"; do
    if grep -q "$pattern" "$FILE_PATH" 2>/dev/null; then
      return 0
    fi
  done

  echo "RIFF Validation Guard: request body read without schema validation."
  echo "  File: $FILE_PATH"
  echo "  Add Zod/Valibot/etc. validation before processing user input."

  bash "$SCRIPT_DIR/log-warning.sh" "input-validation" "$FILE_PATH" "Request body read without schema validation (Zod/Valibot/etc.)"
}

for FILE_PATH in "${RIFF_FILES[@]}"; do
  check_file "$FILE_PATH"
done

exit 0

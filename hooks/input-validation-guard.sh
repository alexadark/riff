#!/bin/bash
# RIFF Input Validation Guard - PostToolUse hook for Edit/Write
# Checks that API handlers validate input with a schema
# Rule: "Validate all user input at system boundaries"
# Configured as a Claude Code PostToolUse hook in .claude/settings.json

FILE_PATH="$1"

# Only check API/route handler files
if ! echo "$FILE_PATH" | grep -qEi '(route|api|action|handler)'; then
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

# Check if file reads request body (POST/PUT/PATCH handlers)
HAS_BODY_READ=false
BODY_PATTERNS=(
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

# If no body reading detected, this might be a GET-only handler - skip
if [ "$HAS_BODY_READ" = false ]; then
  exit 0
fi

# Check for validation patterns
VALIDATION_PATTERNS=(
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
    exit 0
  fi
done

echo "RIFF Validation Guard: request body read without schema validation."
echo "  File: $FILE_PATH"
echo "  Add Zod/Valibot/etc. validation before processing user input."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$SCRIPT_DIR/log-warning.sh" "input-validation" "$FILE_PATH" "Request body read without schema validation (Zod/Valibot/etc.)"
exit 0

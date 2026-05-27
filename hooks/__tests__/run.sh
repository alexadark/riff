#!/usr/bin/env bash
# Test harness for dual-runtime RIFF hooks.
# For each adapted hook, pipes both a Claude (Write/Edit) and a Codex
# (apply_patch) payload and asserts the warning is emitted (or not).
#
# Run: bash hooks/__tests__/run.sh
# Exit code: 0 if all pass, 1 otherwise.

set -u

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "$TESTS_DIR/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

PASS=0
FAIL=0
FAILURES=()

# Build a Claude Write payload pointing at $WORK_DIR/$1
claude_payload() {
  local rel="$1"
  jq -nc --arg fp "$WORK_DIR/$rel" --arg cwd "$WORK_DIR" '
    {
      cwd: $cwd,
      hook_event_name: "PostToolUse",
      tool_name: "Write",
      tool_input: { file_path: $fp, content: "" }
    }
  '
}

# Build a Codex apply_patch payload referencing $1 (relative path)
codex_payload() {
  local rel="$1"
  local patch
  patch=$'*** Begin Patch\n*** Update File: '"$rel"$'\n@@\n-old\n+new\n*** End Patch\n'
  jq -nc --arg cwd "$WORK_DIR" --arg cmd "$patch" '
    {
      cwd: $cwd,
      hook_event_name: "PostToolUse",
      tool_name: "apply_patch",
      tool_input: { command: $cmd }
    }
  '
}

# Run a hook with a given payload and check output against a pattern.
# Args: <name> <hook.sh> <payload-json> <expect: "warn"|"clean"> <pattern>
check() {
  local name="$1" hook="$2" payload="$3" expect="$4" pattern="$5"
  local out
  out="$(printf '%s' "$payload" | bash "$HOOKS_DIR/$hook" 2>&1)"
  local matched=0
  if echo "$out" | grep -q "$pattern"; then matched=1; fi

  case "$expect" in
    warn)
      if [ "$matched" = "1" ]; then
        echo "  PASS  $name"
        PASS=$((PASS + 1))
      else
        echo "  FAIL  $name (expected warning matching: $pattern)"
        echo "        got: ${out:-<empty>}"
        FAIL=$((FAIL + 1))
        FAILURES+=("$name")
      fi
      ;;
    clean)
      if [ "$matched" = "0" ]; then
        echo "  PASS  $name"
        PASS=$((PASS + 1))
      else
        echo "  FAIL  $name (expected silent pass, got warning)"
        echo "        got: $out"
        FAIL=$((FAIL + 1))
        FAILURES+=("$name")
      fi
      ;;
  esac
}

echo "=== idor-detector ==="
mkdir -p "$WORK_DIR/routes"
cat > "$WORK_DIR/routes/leak.ts" <<'TS'
export async function loader({ params }) {
  return db.query("SELECT * FROM items WHERE id = ?", [params.id]);
}
TS
cat > "$WORK_DIR/routes/safe.ts" <<'TS'
export async function loader({ params, request }) {
  const userId = await requireUserId(request);
  return db.query("SELECT * FROM items WHERE id = ? AND userId = ?", [params.id, userId]);
}
TS
check "claude: vulnerable file → warn"  idor-detector.sh  "$(claude_payload routes/leak.ts)"  warn   "IDOR Detector"
check "claude: scoped file → clean"     idor-detector.sh  "$(claude_payload routes/safe.ts)"  clean  "IDOR Detector"
check "codex: vulnerable file → warn"   idor-detector.sh  "$(codex_payload routes/leak.ts)"   warn   "IDOR Detector"
check "codex: scoped file → clean"      idor-detector.sh  "$(codex_payload routes/safe.ts)"   clean  "IDOR Detector"

echo "=== route-auth-guard ==="
cat > "$WORK_DIR/routes/private.route.ts" <<'TS'
export async function action({ request }) {
  const body = await request.json();
  return { ok: true };
}
TS
cat > "$WORK_DIR/routes/private-authed.route.ts" <<'TS'
export async function action({ request }) {
  const userId = await requireUserId(request);
  return { ok: true };
}
TS
check "claude: no auth → warn"          route-auth-guard.sh  "$(claude_payload routes/private.route.ts)"         warn   "Auth Guard"
check "claude: with auth → clean"       route-auth-guard.sh  "$(claude_payload routes/private-authed.route.ts)"  clean  "Auth Guard"
check "codex: no auth → warn"           route-auth-guard.sh  "$(codex_payload routes/private.route.ts)"          warn   "Auth Guard"

echo "=== input-validation-guard ==="
cat > "$WORK_DIR/routes/api.unvalidated.ts" <<'TS'
export async function action({ request }) {
  const body = await request.json();
  await db.insert(body);
}
TS
cat > "$WORK_DIR/routes/api.validated.ts" <<'TS'
import { z } from "zod";
const Schema = z.object({ name: z.string() });
export async function action({ request }) {
  const body = Schema.parse(await request.json());
  await db.insert(body);
}
TS
check "claude: no validation → warn"    input-validation-guard.sh  "$(claude_payload routes/api.unvalidated.ts)"  warn   "Validation Guard"
check "claude: with parse → clean"      input-validation-guard.sh  "$(claude_payload routes/api.validated.ts)"    clean  "Validation Guard"
check "codex: no validation → warn"     input-validation-guard.sh  "$(codex_payload routes/api.unvalidated.ts)"   warn   "Validation Guard"

echo "=== boundary-check ==="
# Boundary check requires .planning/active-phase.txt + a PLAN.md with Boundaries
mkdir -p "$WORK_DIR/.planning/phases/P1-test"
echo "P1-test" > "$WORK_DIR/.planning/active-phase.txt"
cat > "$WORK_DIR/.planning/phases/P1-test/PLAN.md" <<'MD'
# Plan

## Boundaries
- `src/allowed.ts`

## Goal
test
MD
mkdir -p "$WORK_DIR/src"
touch "$WORK_DIR/src/allowed.ts" "$WORK_DIR/src/outside.ts"
check "claude: in-boundary → clean"     boundary-check.sh  "$(claude_payload src/allowed.ts)"  clean  "outside task boundaries"
check "claude: out-of-boundary → warn"  boundary-check.sh  "$(claude_payload src/outside.ts)"  warn   "outside task boundaries"
check "codex: out-of-boundary → warn"   boundary-check.sh  "$(codex_payload src/outside.ts)"   warn   "outside task boundaries"

echo ""
echo "=== Summary ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  printf '    - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0

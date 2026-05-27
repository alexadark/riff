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
# Honors RIFF_SCRATCH_MODE / RIFF_WAVE_ID if set in the caller's env.
check() {
  local name="$1" hook="$2" payload="$3" expect="$4" pattern="$5"
  local out
  out="$(printf '%s' "$payload" | env RIFF_SCRATCH_MODE="${RIFF_SCRATCH_MODE:-}" RIFF_WAVE_ID="${RIFF_WAVE_ID:-}" bash "$HOOKS_DIR/$hook" 2>&1)"
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

echo "=== scratch-mode ==="
# Same vulnerable files as above, but with RIFF_SCRATCH_MODE=1. Hooks must
# still emit the warning AND append a line to
# .planning/followups/SECURITY-WTEST-RECONCILE.md.
SCRATCH_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR" "$SCRATCH_DIR"' EXIT
mkdir -p "$SCRATCH_DIR/routes"
cat > "$SCRATCH_DIR/routes/leak.ts" <<'TS'
export async function loader({ params }) {
  return db.query("SELECT * FROM items WHERE id = ?", [params.id]);
}
TS

scratch_check() {
  local name="$1" hook="$2" rel="$3" pattern="$4"
  local payload
  payload=$(jq -nc --arg fp "$SCRATCH_DIR/$rel" --arg cwd "$SCRATCH_DIR" '
    { cwd: $cwd, hook_event_name: "PostToolUse", tool_name: "Write",
      tool_input: { file_path: $fp, content: "" } }
  ')
  local out
  out="$(printf '%s' "$payload" | env RIFF_SCRATCH_MODE=1 RIFF_WAVE_ID=WTEST bash "$HOOKS_DIR/$hook" 2>&1)"
  if echo "$out" | grep -q "$pattern" && echo "$out" | grep -q "SCRATCH MODE"; then
    echo "  PASS  $name (banner + warning)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL  $name (expected banner + warning matching: $pattern)"
    echo "        got: ${out:-<empty>}"
    FAIL=$((FAIL + 1))
    FAILURES+=("$name")
  fi
}

scratch_check "idor: scratch banner + reconcile" idor-detector.sh routes/leak.ts "IDOR Detector"

RECONCILE="$SCRATCH_DIR/.planning/followups/SECURITY-WTEST-RECONCILE.md"
if [ -f "$RECONCILE" ] && grep -q "idor" "$RECONCILE"; then
  echo "  PASS  idor: SECURITY-WTEST-RECONCILE.md created with entry"
  PASS=$((PASS + 1))
else
  echo "  FAIL  idor: SECURITY-WTEST-RECONCILE.md missing or empty"
  if [ -f "$RECONCILE" ]; then sed 's/^/        /' "$RECONCILE"; fi
  FAIL=$((FAIL + 1))
  FAILURES+=("idor reconcile file")
fi

# Sanity: without scratch mode, no reconcile file should be created elsewhere.
SCRATCH_DIR2="$(mktemp -d)"
mkdir -p "$SCRATCH_DIR2/routes"
cat > "$SCRATCH_DIR2/routes/leak.ts" <<'TS'
export async function loader({ params }) {
  return db.query("SELECT * FROM items WHERE id = ?", [params.id]);
}
TS
no_scratch_payload=$(jq -nc --arg fp "$SCRATCH_DIR2/routes/leak.ts" --arg cwd "$SCRATCH_DIR2" '
  { cwd: $cwd, hook_event_name: "PostToolUse", tool_name: "Write",
    tool_input: { file_path: $fp, content: "" } }
')
out=$(printf '%s' "$no_scratch_payload" | env -u RIFF_SCRATCH_MODE -u RIFF_WAVE_ID bash "$HOOKS_DIR/idor-detector.sh" 2>&1)
if ! ls "$SCRATCH_DIR2/.planning/followups/" >/dev/null 2>&1; then
  echo "  PASS  idor: no reconcile file when scratch mode is off"
  PASS=$((PASS + 1))
else
  echo "  FAIL  idor: reconcile file was created without scratch mode"
  FAIL=$((FAIL + 1))
  FAILURES+=("idor: unwanted reconcile")
fi
rm -rf "$SCRATCH_DIR2"

echo "=== reconcile-diff ==="
RD_DIR="$(mktemp -d)"
(cd "$RD_DIR" && git init -q && git config user.email t@t.t && git config user.name t && mkdir -p routes && echo "// seed" > routes/seed.ts && git add -A && git commit -q -m seed)
RD_BASE=$(git -C "$RD_DIR" rev-parse HEAD)
cat > "$RD_DIR/routes/leak.ts" <<'TS'
export async function loader({ params }) { return db.query("SELECT * FROM items WHERE id = ?", [params.id]); }
TS
git -C "$RD_DIR" add routes/leak.ts && git -C "$RD_DIR" commit -q -m wave
RD_OUT=$(bash "$HOOKS_DIR/lib/reconcile-diff.sh" "$RD_BASE" HEAD "$RD_DIR" 2>&1)
if echo "$RD_OUT" | grep -q 'FINDING|idor-detector' && echo "$RD_OUT" | grep -q 'FINDING|route-auth-guard' && echo "$RD_OUT" | grep -q 'SUMMARY|files_scanned=1|findings=2'; then
  echo "  PASS  reconcile-diff: flags idor + route-auth on vulnerable diff"; PASS=$((PASS + 1))
else
  echo "  FAIL  reconcile-diff: unexpected output"; echo "$RD_OUT" | sed 's/^/        /'; FAIL=$((FAIL + 1)); FAILURES+=("reconcile-diff")
fi
rm -rf "$RD_DIR"

echo ""
echo "=== Summary ==="
echo "  $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  printf '    - %s\n' "${FAILURES[@]}"
  exit 1
fi
exit 0

#!/bin/bash
# Test RIFF hooks with known-bad inputs.
# Each hook gets at least one bad case. Exits 0 if all hooks behave correctly.
set -e

HOOKS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RIFF_ROOT="$(cd "$HOOKS_DIR/.." && pwd)"

pass() { echo "  ✓ $1"; }
fail() { echo "  ✗ $1"; exit 1; }

# Create an isolated temp git repo so we can stage files without touching the real one.
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Stub `npx` so security-scan does not actually run vitest/tsc.
STUB_BIN="$WORK/bin"
mkdir -p "$STUB_BIN"
cat > "$STUB_BIN/npx" <<'EOF'
#!/bin/bash
exit 0
EOF
chmod +x "$STUB_BIN/npx"
export PATH="$STUB_BIN:$PATH"

cd "$WORK"
git init -q
git config user.email "test@riff.local"
git config user.name "riff-test"
git commit --allow-empty -q -m "init"

stage() {
  local path="$1"
  local content="$2"
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$content" > "$path"
  git add "$path"
}

reset_index() {
  git rm -rf --cached -q . >/dev/null 2>&1 || true
  rm -rf app REGISTRY.md test.ts test.txt .env
}

run_hook() {
  # Run a hook, capture exit + output.
  local script="$1"; shift
  set +e
  HOOK_OUTPUT=$(bash "$script" "$@" 2>&1)
  HOOK_EXIT=$?
  set -e
}

###############################################################################
echo "Testing security-scan.sh (secrets)..."
reset_index
stage "src/leak.ts" 'const k = "sk-abcdefghijklmnopqrstuv1234"'
run_hook "$HOOKS_DIR/security-scan.sh"
[ "$HOOK_EXIT" -ne 0 ] || fail "secrets-check did not block OpenAI-style key"
echo "$HOOK_OUTPUT" | grep -q "BLOCKED: Possible secret" || fail "no BLOCKED message for secret"
pass "blocked OpenAI-style key"

###############################################################################
echo "Testing security-scan.sh (any type warning)..."
reset_index
stage "src/typed.ts" 'export const f = (x: any) => x'
run_hook "$HOOKS_DIR/security-scan.sh"
echo "$HOOK_OUTPUT" | grep -q "'any' type" || fail "any-type check did not warn"
pass "warned on 'any' type"

###############################################################################
echo "Testing security-scan.sh (console.log warning)..."
reset_index
stage "src/log.ts" 'console.log("debug")'
run_hook "$HOOKS_DIR/security-scan.sh"
echo "$HOOK_OUTPUT" | grep -q "console.log" || fail "console.log check did not warn"
pass "warned on console.log"

###############################################################################
echo "Testing security-scan.sh (.env block)..."
reset_index
stage ".env" 'FOO=bar'
run_hook "$HOOKS_DIR/security-scan.sh"
[ "$HOOK_EXIT" -ne 0 ] || fail ".env file was not blocked"
pass "blocked staged .env file"

###############################################################################
echo "Testing registry-reminder.sh (surface change without REGISTRY.md)..."
reset_index
stage "app/routes/new.tsx" 'export default function R(){return null}'
run_hook "$HOOKS_DIR/registry-reminder.sh"
[ "$HOOK_EXIT" -ne 0 ] || fail "registry-reminder did not block surface change"
echo "$HOOK_OUTPUT" | grep -q "REGISTRY.md not updated" || fail "no warning text"
pass "blocked surface change without REGISTRY.md update"

echo "Testing registry-reminder.sh (passes when REGISTRY.md is staged)..."
stage "REGISTRY.md" '# registry'
run_hook "$HOOKS_DIR/registry-reminder.sh"
[ "$HOOK_EXIT" -eq 0 ] || fail "registry-reminder blocked even though REGISTRY.md was staged"
pass "passes when REGISTRY.md updated alongside surface change"

echo "Testing registry-reminder.sh (RIFF_SKIP_REGISTRY=1 bypass)..."
reset_index
stage "app/routes/skip.tsx" 'export default function R(){return null}'
RIFF_SKIP_REGISTRY=1 run_hook "$HOOKS_DIR/registry-reminder.sh"
# Note: current script still exits 1 because the bypass branch only fires inside the warning block.
# We assert the documented behavior: with the env set, exit code is 0.
if [ "$HOOK_EXIT" -ne 0 ]; then
  fail "RIFF_SKIP_REGISTRY=1 did not bypass the hook"
fi
pass "RIFF_SKIP_REGISTRY=1 bypasses the hook"

###############################################################################
echo "Testing commit-msg.sh (no-op: never blocks any format)..."
MSG_FILE="$WORK/.git/COMMIT_EDITMSG.test"
echo "feat: any normal message" > "$MSG_FILE"
run_hook "$HOOKS_DIR/commit-msg.sh" "$MSG_FILE"
[ "$HOOK_EXIT" -eq 0 ] || fail "commit-msg blocked a normal message"
pass "commit-msg is a no-op and never blocks"

echo ""
echo "All hook tests passed."

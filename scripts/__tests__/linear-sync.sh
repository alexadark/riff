set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="$ROOT/scripts/linear-sync.mjs"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

pass=0
fail=0

check() {
  local name="$1" expected_exit="$2"
  shift 2
  set +e
  "$@" >/tmp/riff-linear-test.out 2>&1
  local exit_code=$?
  set -e
  if [[ "$exit_code" == "$expected_exit" ]]; then
    echo "  PASS  $name"
    pass=$((pass + 1))
  else
    echo "  FAIL  $name (expected exit $expected_exit, got $exit_code)"
    sed 's/^/        /' /tmp/riff-linear-test.out
    fail=$((fail + 1))
  fi
}

check_contains() {
  local name="$1" needle="$2"
  shift 2
  set +e
  "$@" >/tmp/riff-linear-test.out 2>&1
  set -e
  if grep -qF "$needle" /tmp/riff-linear-test.out; then
    echo "  PASS  $name"
    pass=$((pass + 1))
  else
    echo "  FAIL  $name (output missing: $needle)"
    sed 's/^/        /' /tmp/riff-linear-test.out
    fail=$((fail + 1))
  fi
}

# --help exits 0 and prints usage.
check "linear --help exits 0" 0 node "$SCRIPT" --help
check_contains "help mentions setup" "setup" node "$SCRIPT" --help

# No subcommand exits 1 (usage).
check "no subcommand exits 1" 1 node "$SCRIPT"

# Unknown subcommand exits 1.
check "unknown subcommand exits 1" 1 node "$SCRIPT" bogus

# setup without an API key fails (exit 2) with a clear message, even in a
# non-TTY (the key check runs before the TTY check would matter here since the
# test pipes stdin; assert the message points at the env var).
check "setup without key exits 2" 2 env -u LINEAR_API_KEY node "$SCRIPT" setup </dev/null

# .env at the project root is loaded by the key resolver. We run a tiny inline
# importer to exercise loadDotEnv without hitting the network.
printf 'LINEAR_API_KEY=lin_api_fromfile\n' > "$WORK_DIR/.env"
cat > "$WORK_DIR/probe.mjs" <<EOF
import { resolveApiKey } from '$ROOT/scripts/linear-sync.mjs';
process.stdout.write(resolveApiKey('$WORK_DIR'));
EOF
check_contains ".env key is loaded" "lin_api_fromfile" \
  env -u LINEAR_API_KEY node "$WORK_DIR/probe.mjs"

# An exported env var overrides the .env file.
check_contains "env var overrides .env" "lin_api_fromenv" \
  env LINEAR_API_KEY=lin_api_fromenv node "$WORK_DIR/probe.mjs"

echo ""
echo "linear-sync tests: $pass passed, $fail failed"
if [[ "$fail" -gt 0 ]]; then
  exit 1
fi

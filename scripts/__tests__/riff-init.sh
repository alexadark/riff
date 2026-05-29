#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

node "$ROOT/riff" init --project-root "$WORK_DIR" --scope scratch --no-onboard >/tmp/riff-init-test.out

fail() {
  echo "  FAIL  $1"
  sed 's/^/        /' /tmp/riff-init-test.out
  exit 1
}

[[ -L "$WORK_DIR/.riff" ]] || fail ".riff symlink missing"
[[ -d "$WORK_DIR/.claude/commands/riff" ]] || fail ".claude commands missing"
[[ -d "$WORK_DIR/.claude/skills" ]] || fail ".claude skills missing"
[[ -L "$WORK_DIR/.claude/skills/incident" ]] || fail "incident skill symlink missing"
[[ "$(readlink "$WORK_DIR/.claude/skills/incident")" == "../../.riff/skills/incident" ]] || fail "incident skill symlink target wrong"
[[ -f "$WORK_DIR/.claude/settings.json" ]] || fail ".claude/settings.json missing"
[[ -f "$WORK_DIR/.planning/config.json" ]] || fail ".planning/config.json missing"
grep -q '"scope": "scratch"' "$WORK_DIR/.planning/config.json" || fail "scope not scratch"
[[ ! -e "$WORK_DIR/.codex" ]] || fail ".codex should not be installed"
[[ ! -e "$WORK_DIR/.commandcode" ]] || fail ".commandcode should not be installed"
! grep -R "lint-gate" "$WORK_DIR/.claude/settings.json" >/dev/null || fail "lint gate wired in settings"
grep -q "compaction-checkpoint.sh" "$WORK_DIR/.claude/settings.json" || fail "compaction hook missing"
node -e '
const fs = require("fs");
const settings = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const session = JSON.stringify(settings.hooks.SessionStart || []);
const preCompact = JSON.stringify(settings.hooks.PreCompact || []);
if (session.includes("compaction-checkpoint.sh")) process.exit(1);
if (!preCompact.includes("compaction-checkpoint.sh")) process.exit(2);
' "$WORK_DIR/.claude/settings.json" || fail "compaction hook is not PreCompact-only"
grep -q '^.riff/$' "$WORK_DIR/.gitignore" || fail ".riff missing from gitignore"
grep -q '^.planning/debug/$' "$WORK_DIR/.gitignore" || fail ".planning/debug missing from gitignore"
grep -q 'RIFF-INSTALL:START' "$WORK_DIR/CLAUDE.md" || fail "CLAUDE.md section missing"

echo "riff-init test: passed"

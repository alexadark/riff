#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
WORK_DIR="$TEST_DIR/project"
OUTSIDE_DIR="$TEST_DIR/outside"
HOME_DIR="$TEST_DIR/home"
CODEX_HOME_DIR="$TEST_DIR/codex-home"
FRAMEWORK_COPY="$TEST_DIR/framework-copy"
mkdir -p "$WORK_DIR/.agents/skills" "$WORK_DIR/.codex/agents" "$WORK_DIR/.claude/commands/riff" "$WORK_DIR/.claude/agents/riff" "$WORK_DIR/.claude/hooks/riff" "$WORK_DIR/.claude/skills" "$OUTSIDE_DIR" "$HOME_DIR" "$CODEX_HOME_DIR" "$FRAMEWORK_COPY"
trap 'rm -rf "$TEST_DIR"' EXIT

cp -R "$ROOT/agents" "$ROOT/commands" "$ROOT/hooks" "$ROOT/skills" "$ROOT/templates" "$ROOT/protocols" "$ROOT/scripts" "$ROOT/CLAUDE.md" "$ROOT/riff" "$ROOT/riff-resync.sh" "$FRAMEWORK_COPY/"
FRAMEWORK_COPY="$(cd "$FRAMEWORK_COPY" && pwd -P)"
printf 'semantic_role = "worker"\nroute_class = "undeclared"\n' > "$FRAMEWORK_COPY/agents/codex/undeclared.toml"

declared_routes() {
  node --input-type=module - "$FRAMEWORK_COPY" <<'NODE'
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const frameworkRoot = process.argv[2];
const { ROUTE_PORTFOLIO } = await import(pathToFileURL(path.join(frameworkRoot, 'scripts/lib/runtime-routes.mjs')).href);
process.stdout.write(`${ROUTE_PORTFOLIO.map((route) => route.file).join('\n')}\n`);
NODE
}

printf 'user skill\n' > "$WORK_DIR/.agents/skills/user-skill"
printf 'user route\n' > "$WORK_DIR/.codex/agents/user-route.toml"
printf 'claude user file\n' > "$WORK_DIR/.claude/user-file"
ln -s "$OUTSIDE_DIR" "$WORK_DIR/.agents/skills/user-skill-link"
ln -s "$OUTSIDE_DIR" "$WORK_DIR/.codex/agents/user-route-link"
ln -s "$OUTSIDE_DIR" "$WORK_DIR/.claude/user-link"
printf 'colliding skill sentinel\n' > "$OUTSIDE_DIR/skill-sentinel"
printf 'colliding agent sentinel\n' > "$OUTSIDE_DIR/agent-sentinel"
printf 'colliding command sentinel\n' > "$OUTSIDE_DIR/command-sentinel"
printf 'colliding hook sentinel\n' > "$OUTSIDE_DIR/hook-sentinel"
ln -s "$OUTSIDE_DIR/skill-sentinel" "$WORK_DIR/.claude/skills/incident"
ln -s "$OUTSIDE_DIR/agent-sentinel" "$WORK_DIR/.claude/agents/riff/debugger.md"
ln -s "$OUTSIDE_DIR/command-sentinel" "$WORK_DIR/.claude/commands/riff/debug.md"
ln -s "$OUTSIDE_DIR/hook-sentinel" "$WORK_DIR/.claude/hooks/riff/compaction-checkpoint.sh"
printf 'home sentinel\n' > "$HOME_DIR/sentinel"
printf 'codex home sentinel\n' > "$CODEX_HOME_DIR/sentinel"

HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$WORK_DIR" --scope scratch --no-onboard >/tmp/riff-init-test.out

fail() {
  echo "  FAIL  $1"
  sed 's/^/        /' /tmp/riff-init-test.out
  exit 1
}

grep -q 'runtime files:.*claude + codex' /tmp/riff-init-test.out || fail "init output omitted project-local Codex files"
! grep -qi 'no project install' /tmp/riff-init-test.out || fail "init output still claims no project Codex install"

assert_init_rejects_symlink() {
  local label="$1"
  local relative="$2"
  local rejected="$TEST_DIR/reject-$label"
  local outside="$TEST_DIR/outside-$label"
  mkdir -p "$rejected" "$outside" "$(dirname "$rejected/$relative")"
  printf 'external sentinel\n' > "$outside/sentinel"
  ln -s "$outside/sentinel" "$rejected/$relative"
  if HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$rejected" --scope scratch --no-onboard >/tmp/riff-init-test.out 2>&1; then
    fail "init followed symlinked $relative"
  fi
  [[ "$(<"$outside/sentinel")" == 'external sentinel' ]] || fail "init changed external $relative target"
}

assert_init_rejects_directory_symlink() {
  local label="$1"
  local relative="$2"
  local rejected="$TEST_DIR/reject-$label"
  local outside="$TEST_DIR/outside-$label"
  mkdir -p "$rejected" "$outside"
  printf 'external sentinel\n' > "$outside/sentinel"
  ln -s "$outside" "$rejected/$relative"
  if HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$rejected" --scope scratch --no-onboard >/tmp/riff-init-test.out 2>&1; then
    fail "init followed symlinked $relative directory"
  fi
  [[ "$(<"$outside/sentinel")" == 'external sentinel' ]] || fail "init changed external $relative target"
}

[[ -L "$WORK_DIR/.riff" ]] || fail ".riff symlink missing"
[[ -d "$WORK_DIR/.claude/commands/riff" ]] || fail ".claude commands missing"
[[ -d "$WORK_DIR/.claude/skills" ]] || fail ".claude skills missing"
[[ -L "$WORK_DIR/.claude/skills/incident" ]] || fail "colliding skill symlink changed"
[[ "$(readlink "$WORK_DIR/.claude/skills/incident")" == "$OUTSIDE_DIR/skill-sentinel" ]] || fail "colliding skill symlink target changed"
[[ -L "$WORK_DIR/.claude/skills/next" ]] || fail "intended skill link missing"
[[ "$(readlink "$WORK_DIR/.claude/skills/next")" == "../../.riff/skills/next" ]] || fail "intended skill link target wrong"
[[ -L "$WORK_DIR/.claude/skills/resync" ]] || fail "resync Claude skill link missing"
[[ "$(readlink "$WORK_DIR/.claude/skills/resync")" == "../../.riff/skills/resync" ]] || fail "resync Claude skill link target wrong"
[[ -L "$WORK_DIR/.agents/skills/resync" ]] || fail "resync Codex skill link missing"
[[ "$(readlink "$WORK_DIR/.agents/skills/resync")" == "../../.riff/skills/resync" ]] || fail "resync Codex skill link target wrong"
[[ -L "$WORK_DIR/.claude/skills/wave" ]] || fail "wave Claude skill link missing"
[[ "$(readlink "$WORK_DIR/.claude/skills/wave")" == "../../.riff/skills/wave" ]] || fail "wave Claude skill link target wrong"
[[ -L "$WORK_DIR/.agents/skills/wave" ]] || fail "wave Codex skill link missing"
[[ "$(readlink "$WORK_DIR/.agents/skills/wave")" == "../../.riff/skills/wave" ]] || fail "wave Codex skill link target wrong"
[[ -L "$WORK_DIR/.claude/agents/riff/debugger.md" ]] || fail "colliding agent symlink changed"
[[ "$(readlink "$WORK_DIR/.claude/agents/riff/debugger.md")" == "$OUTSIDE_DIR/agent-sentinel" ]] || fail "colliding agent symlink target changed"
[[ -L "$WORK_DIR/.claude/commands/riff/debug.md" ]] || fail "colliding command symlink changed"
[[ "$(readlink "$WORK_DIR/.claude/commands/riff/debug.md")" == "$OUTSIDE_DIR/command-sentinel" ]] || fail "colliding command symlink target changed"
[[ -L "$WORK_DIR/.claude/hooks/riff/compaction-checkpoint.sh" ]] || fail "colliding hook symlink changed"
[[ "$(readlink "$WORK_DIR/.claude/hooks/riff/compaction-checkpoint.sh")" == "$OUTSIDE_DIR/hook-sentinel" ]] || fail "colliding hook symlink target changed"
[[ "$(<"$OUTSIDE_DIR/skill-sentinel")" == 'colliding skill sentinel' ]] || fail "colliding skill sentinel changed"
[[ "$(<"$OUTSIDE_DIR/agent-sentinel")" == 'colliding agent sentinel' ]] || fail "colliding agent sentinel changed"
[[ "$(<"$OUTSIDE_DIR/command-sentinel")" == 'colliding command sentinel' ]] || fail "colliding command sentinel changed"
[[ "$(<"$OUTSIDE_DIR/hook-sentinel")" == 'colliding hook sentinel' ]] || fail "colliding hook sentinel changed"
while IFS= read -r skill_dir; do
  skill="$(basename "$skill_dir")"
  [[ -L "$WORK_DIR/.claude/skills/$skill" ]] || fail "Claude skill link missing: $skill"
  [[ -L "$WORK_DIR/.agents/skills/$skill" ]] || fail "Codex skill link missing: $skill"
done < <(find "$ROOT/skills" -mindepth 1 -maxdepth 1 -type d -print)
[[ -f "$WORK_DIR/.claude/settings.json" ]] || fail ".claude/settings.json missing"
[[ -f "$WORK_DIR/.planning/config.json" ]] || fail ".planning/config.json missing"
grep -q '"scope": "scratch"' "$WORK_DIR/.planning/config.json" || fail "scope not scratch"
[[ -d "$WORK_DIR/.codex/agents" ]] || fail ".codex/agents missing"
[[ -f "$WORK_DIR/.codex/agents/riff-controller-routine.toml" ]] || fail "Codex controller route copy missing"
[[ ! -L "$WORK_DIR/.codex/agents/riff-controller-routine.toml" ]] || fail "Codex route must be a regular file"
while IFS= read -r route_file; do
  source="$FRAMEWORK_COPY/agents/codex/$route_file"
  name="riff-$(basename "$source")"
  [[ -f "$WORK_DIR/.codex/agents/$name" ]] || fail "Codex route copy missing: $name"
  [[ "$(sed -n '1p' "$WORK_DIR/.codex/agents/$name")" == '# RIFF-INSTALL: codex-agent' ]] || fail "Codex route ownership marker missing: $name"
  source_spec="$(sed -n -E 's/^[[:space:]]*role_spec_path[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p' "$source")"
  expected_spec="$FRAMEWORK_COPY/$source_spec"
  installed_spec="$(sed -n -E 's/^[[:space:]]*role_spec_path[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p' "$WORK_DIR/.codex/agents/$name")"
  [[ "$installed_spec" == "$expected_spec" ]] || fail "Codex route role_spec_path does not target relocated framework: $name"
done < <(declared_routes)
[[ ! -e "$WORK_DIR/.codex/agents/riff-undeclared.toml" ]] || fail "init installed an undeclared Codex route"

owned_route="$WORK_DIR/.codex/agents/riff-controller-routine.toml"
printf '# RIFF-INSTALL: codex-agent\nrole_spec_path = "stale-route"\n' > "$owned_route"
owned_stale_route="$WORK_DIR/.codex/agents/riff-retired.toml"
printf '# RIFF-INSTALL: codex-agent\nstale route\n' > "$owned_stale_route"
HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$WORK_DIR" --scope scratch --no-onboard >/tmp/riff-init-test.out 2>&1 || fail "init failed to update an owned Codex route"
[[ "$(sed -n '1p' "$owned_route")" == '# RIFF-INSTALL: codex-agent' ]] || fail "owned Codex route marker was lost during update"
updated_spec="$(sed -n -E 's/^[[:space:]]*role_spec_path[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p' "$owned_route")"
[[ "$updated_spec" == "$FRAMEWORK_COPY/protocols/RIFF-NEXT.md" ]] || fail "owned Codex route was not updated"
[[ ! -e "$owned_stale_route" ]] || fail "init did not remove an owned stale Codex route"

unowned_route="$WORK_DIR/.codex/agents/riff-planner-routine.toml"
printf 'unowned route sentinel\n' > "$unowned_route"
HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$WORK_DIR" --scope scratch --no-onboard >/tmp/riff-init-test.out 2>&1 || fail "init failed while preserving an unowned Codex route"
[[ "$(cat "$unowned_route")" == 'unowned route sentinel' ]] || fail "init overwrote an unowned Codex route"
grep -q "preserving unowned Codex route collision: .*riff-planner-routine.toml" /tmp/riff-init-test.out || fail "init did not surface the unowned Codex route collision"

[[ ! -e "$WORK_DIR/.commandcode" ]] || fail ".commandcode should not be installed"
[[ "$(<"$WORK_DIR/.agents/skills/user-skill")" == 'user skill' ]] || fail "unrelated Codex skill file changed"
[[ -L "$WORK_DIR/.agents/skills/user-skill-link" ]] || fail "unrelated Codex skill symlink changed"
[[ "$(<"$WORK_DIR/.codex/agents/user-route.toml")" == 'user route' ]] || fail "unrelated Codex route changed"
[[ -L "$WORK_DIR/.codex/agents/user-route-link" ]] || fail "unrelated Codex route symlink changed"
[[ "$(<"$WORK_DIR/.claude/user-file")" == 'claude user file' ]] || fail "unrelated Claude file changed"
[[ -L "$WORK_DIR/.claude/user-link" ]] || fail "unrelated Claude symlink changed"
[[ "$(<"$HOME_DIR/sentinel")" == 'home sentinel' ]] || fail "HOME sentinel changed"
[[ "$(<"$CODEX_HOME_DIR/sentinel")" == 'codex home sentinel' ]] || fail "CODEX_HOME sentinel changed"
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

for runtime in agents codex; do
  assert_init_rejects_directory_symlink "runtime-$runtime" ".$runtime"
done
assert_init_rejects_directory_symlink 'claude-root' '.claude'
assert_init_rejects_directory_symlink 'planning-root' '.planning'
assert_init_rejects_directory_symlink 'git-root' '.git'
assert_init_rejects_symlink 'claude-md' 'CLAUDE.md'
assert_init_rejects_symlink 'gitignore' '.gitignore'
assert_init_rejects_symlink 'planning-config' '.planning/config.json'
assert_init_rejects_symlink 'planning-profile' '.planning/profile.yaml'
assert_init_rejects_symlink 'claude-settings' '.claude/settings.json'

foreign_riff="$TEST_DIR/reject-foreign-riff"
foreign_target="$TEST_DIR/foreign-riff-target"
mkdir -p "$foreign_riff" "$foreign_target"
ln -s "$foreign_target" "$foreign_riff/.riff"
if HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$foreign_riff" --scope scratch --no-onboard >/tmp/riff-init-test.out 2>&1; then
  fail "init accepted a foreign .riff symlink"
fi
[[ "$(readlink "$foreign_riff/.riff")" == "$foreign_target" ]] || fail "init replaced a foreign .riff symlink"
[[ ! -e "$foreign_riff/.claude" ]] || fail "init installed links through a foreign .riff symlink"
! grep -q 'already correct' /tmp/riff-init-test.out || fail "foreign .riff symlink was reported as already correct"

directory_riff="$TEST_DIR/reject-directory-riff"
mkdir -p "$directory_riff/.riff"
if HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$directory_riff" --scope scratch --no-onboard >/tmp/riff-init-test.out 2>&1; then
  fail "init accepted a real .riff directory"
fi
[[ -d "$directory_riff/.riff" ]] || fail "init replaced a real .riff directory"
[[ ! -e "$directory_riff/.claude" ]] || fail "init installed files with a real .riff directory"

assert_init_rejects_codex_route_symlink() {
  local label="$1"
  local target_mode="$2"
  local rejected="$TEST_DIR/reject-codex-route-$label"
  local target
  mkdir -p "$rejected"
  HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$rejected" --scope scratch --no-onboard >/tmp/riff-init-test.out 2>&1 || fail "initial init failed for Codex route symlink regression: $label"

  local route="$rejected/.codex/agents/riff-reviewer-routine.toml"
  rm "$route"
  if [[ "$target_mode" == "in-root" ]]; then
    target="$rejected/.codex/agents/route-target-$label"
    printf 'in-root Codex route target\n' > "$target"
    ln -s "route-target-$label" "$route"
  else
    target="$OUTSIDE_DIR/codex-route-target-$label"
    printf 'outside Codex route target\n' > "$target"
    ln -s "$target" "$route"
  fi
  local expected_link
  expected_link="$(readlink "$route")"
  if HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$rejected" --scope scratch --no-onboard >/tmp/riff-init-test.out 2>&1; then
    fail "init accepted expected-name Codex route symlink: $label"
  fi
  [[ -L "$route" ]] || fail "init replaced expected-name Codex route symlink: $label"
  [[ "$(readlink "$route")" == "$expected_link" ]] || fail "init changed Codex route symlink target: $label"
  [[ -f "$target" ]] || fail "init removed Codex route symlink target: $label"
  ! grep -q '^RIFF installed$' /tmp/riff-init-test.out || fail "init reported success after Codex route symlink rejection: $label"
}

assert_init_rejects_codex_route_symlink 'in-root' 'in-root'
assert_init_rejects_codex_route_symlink 'outside' 'outside'

echo "riff-init test: passed"

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TEST_DIR="$(mktemp -d)"
PROJECT="$TEST_DIR/project"
OUTSIDE="$TEST_DIR/outside"
HOME_DIR="$TEST_DIR/home"
CODEX_HOME_DIR="$TEST_DIR/codex-home"
FRAMEWORK_COPY="$TEST_DIR/framework-copy"
HOSTILE_FRAMEWORK="$TEST_DIR/hostile-framework"
FOREIGN_PROJECT="$TEST_DIR/foreign-project"
mkdir -p "$PROJECT" "$OUTSIDE" "$HOME_DIR" "$CODEX_HOME_DIR" "$FRAMEWORK_COPY" "$HOSTILE_FRAMEWORK" "$FOREIGN_PROJECT"
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
cp -R "$ROOT/agents" "$ROOT/commands" "$ROOT/hooks" "$ROOT/skills" "$ROOT/templates" "$ROOT/protocols" "$ROOT/scripts" "$ROOT/CLAUDE.md" "$ROOT/riff" "$ROOT/riff-resync.sh" "$HOSTILE_FRAMEWORK/"
HOSTILE_FRAMEWORK="$(cd "$HOSTILE_FRAMEWORK" && pwd -P)"

fail() {
  echo "  FAIL  $1"
  sed 's/^/        /' /tmp/riff-resync-test.out
  exit 1
}

snapshot_tree() {
  local root="$1"
  find "$root" -mindepth 1 -print | sort | while IFS= read -r path; do
    local relative="${path#"$root"/}"
    if [ -L "$path" ]; then
      printf 'L %s %s\n' "$relative" "$(readlink "$path")"
    elif [ -f "$path" ]; then
      printf 'F %s\n' "$relative"
      cat "$path"
      printf '\n-- RIFF RESYNC SNAPSHOT END --\n'
    else
      printf 'D %s\n' "$relative"
    fi
  done
}

HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$PROJECT" --scope scratch --no-onboard >/tmp/riff-resync-test.out

printf 'stale route\n' > "$PROJECT/.codex/agents/riff-stale.toml"
printf '# RIFF-INSTALL: codex-agent\nstale route\n' > "$PROJECT/.codex/agents/riff-retired.toml"
printf 'unrelated route\n' > "$PROJECT/.codex/agents/user-route.toml"
printf 'unrelated skill\n' > "$PROJECT/.agents/skills/user-skill"
printf 'claude user file\n' > "$PROJECT/.claude/user-file"
ln -s "$OUTSIDE" "$PROJECT/.codex/agents/user-route-link"
ln -s "$OUTSIDE" "$PROJECT/.agents/skills/user-skill-link"
ln -s "$OUTSIDE" "$PROJECT/.claude/user-link"
printf 'home sentinel\n' > "$HOME_DIR/sentinel"
printf 'codex home sentinel\n' > "$CODEX_HOME_DIR/sentinel"

printf 'colliding skill sentinel\n' > "$OUTSIDE/skill-sentinel"
printf 'colliding agent sentinel\n' > "$OUTSIDE/agent-sentinel"
printf 'colliding command sentinel\n' > "$OUTSIDE/command-sentinel"
printf 'colliding hook sentinel\n' > "$OUTSIDE/hook-sentinel"
rm "$PROJECT/.agents/skills/incident"
rm "$PROJECT/.claude/agents/riff/debugger.md"
rm "$PROJECT/.claude/commands/riff/debug.md"
rm "$PROJECT/.claude/hooks/riff/compaction-checkpoint.sh"
ln -s '../../../outside/skill-sentinel' "$PROJECT/.agents/skills/incident"
ln -s '../../../../outside/agent-sentinel' "$PROJECT/.claude/agents/riff/debugger.md"
ln -s '../../../../outside/command-sentinel' "$PROJECT/.claude/commands/riff/debug.md"
ln -s '../../../../outside/hook-sentinel' "$PROJECT/.claude/hooks/riff/compaction-checkpoint.sh"
rm "$PROJECT/.agents/skills/next"
rm "$PROJECT/.claude/agents/riff/reviewer.md"
rm "$PROJECT/.claude/commands/riff/status.md"
rm "$PROJECT/.claude/hooks/riff/registry-reminder.sh"
rm "$PROJECT/.codex/agents/riff-controller-routine.toml"
ln -s '../../../../outside/missing-command.md' "$PROJECT/.claude/commands/riff/ghost.md"
ln -s '../../../outside/missing-skill' "$PROJECT/.agents/skills/ghost-skill"
ln -s '../../../.riff/commands/removed-command.md' "$PROJECT/.claude/commands/riff/removed-command.md"
ln -s '../../.riff/skills/removed-skill' "$PROJECT/.agents/skills/removed-skill"

(cd "$PROJECT" && HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" "$FRAMEWORK_COPY/riff" resync) >/tmp/riff-resync-test.out 2>&1

[[ -L "$PROJECT/.agents/skills/incident" ]] || fail "resync did not restore deleted RIFF skill link"
[[ "$(readlink "$PROJECT/.agents/skills/incident")" == '../../../outside/skill-sentinel' ]] || fail "colliding skill symlink changed"
[[ -L "$PROJECT/.agents/skills/next" ]] || fail "resync did not restore deleted RIFF skill link"
[[ "$(readlink "$PROJECT/.agents/skills/next")" == '../../.riff/skills/next' ]] || fail "restored RIFF skill link target wrong"
[[ -L "$PROJECT/.agents/skills/resync" ]] || fail "resync did not install the shared RIFF resync skill"
[[ "$(readlink "$PROJECT/.agents/skills/resync")" == '../../.riff/skills/resync' ]] || fail "resynced Codex resync skill link target wrong"
[[ -L "$PROJECT/.claude/skills/resync" ]] || fail "resync did not install the shared Claude resync skill"
[[ "$(readlink "$PROJECT/.claude/skills/resync")" == '../../.riff/skills/resync' ]] || fail "resynced Claude resync skill link target wrong"
[[ -L "$PROJECT/.agents/skills/wave" ]] || fail "resync did not install the Codex wave skill"
[[ "$(readlink "$PROJECT/.agents/skills/wave")" == '../../.riff/skills/wave' ]] || fail "resynced Codex wave skill link target wrong"
[[ -L "$PROJECT/.claude/skills/wave" ]] || fail "resync did not install the Claude wave skill"
[[ "$(readlink "$PROJECT/.claude/skills/wave")" == '../../.riff/skills/wave' ]] || fail "resynced Claude wave skill link target wrong"
[[ -L "$PROJECT/.claude/agents/riff/debugger.md" ]] || fail "colliding agent symlink changed"
[[ "$(readlink "$PROJECT/.claude/agents/riff/debugger.md")" == '../../../../outside/agent-sentinel' ]] || fail "colliding agent symlink target changed"
[[ -L "$PROJECT/.claude/commands/riff/debug.md" ]] || fail "colliding command symlink changed"
[[ "$(readlink "$PROJECT/.claude/commands/riff/debug.md")" == '../../../../outside/command-sentinel' ]] || fail "colliding command symlink target changed"
[[ -L "$PROJECT/.claude/hooks/riff/compaction-checkpoint.sh" ]] || fail "colliding hook symlink changed"
[[ "$(readlink "$PROJECT/.claude/hooks/riff/compaction-checkpoint.sh")" == '../../../../outside/hook-sentinel' ]] || fail "colliding hook symlink target changed"
[[ -L "$PROJECT/.claude/agents/riff/reviewer.md" ]] || fail "resync did not restore deleted RIFF agent link"
[[ "$(readlink "$PROJECT/.claude/agents/riff/reviewer.md")" == '../../../.riff/agents/reviewer.md' ]] || fail "restored RIFF agent link target wrong"
[[ -L "$PROJECT/.claude/commands/riff/status.md" ]] || fail "resync did not restore deleted RIFF command link"
[[ "$(readlink "$PROJECT/.claude/commands/riff/status.md")" == '../../../.riff/commands/status.md' ]] || fail "restored RIFF command link target wrong"
[[ -L "$PROJECT/.claude/hooks/riff/registry-reminder.sh" ]] || fail "resync did not restore deleted RIFF hook link"
[[ "$(readlink "$PROJECT/.claude/hooks/riff/registry-reminder.sh")" == '../../../.riff/hooks/registry-reminder.sh' ]] || fail "restored RIFF hook link target wrong"
[[ "$(<"$OUTSIDE/skill-sentinel")" == 'colliding skill sentinel' ]] || fail "colliding skill sentinel changed"
[[ "$(<"$OUTSIDE/agent-sentinel")" == 'colliding agent sentinel' ]] || fail "colliding agent sentinel changed"
[[ "$(<"$OUTSIDE/command-sentinel")" == 'colliding command sentinel' ]] || fail "colliding command sentinel changed"
[[ "$(<"$OUTSIDE/hook-sentinel")" == 'colliding hook sentinel' ]] || fail "colliding hook sentinel changed"
[[ -L "$PROJECT/.claude/commands/riff/ghost.md" ]] || fail "unrelated dangling command symlink was removed"
[[ "$(readlink "$PROJECT/.claude/commands/riff/ghost.md")" == '../../../../outside/missing-command.md' ]] || fail "unrelated dangling command symlink target changed"
[[ -L "$PROJECT/.agents/skills/ghost-skill" ]] || fail "unrelated dangling skill symlink was removed"
[[ "$(readlink "$PROJECT/.agents/skills/ghost-skill")" == '../../../outside/missing-skill' ]] || fail "unrelated dangling skill symlink target changed"
[[ ! -L "$PROJECT/.claude/commands/riff/removed-command.md" ]] || fail "owned dangling command symlink was not removed"
[[ ! -L "$PROJECT/.agents/skills/removed-skill" ]] || fail "owned dangling skill symlink was not removed"
[[ -f "$PROJECT/.codex/agents/riff-controller-routine.toml" ]] || fail "resync did not restore deleted Codex route"
controller_spec="$(sed -n -E 's/^[[:space:]]*role_spec_path[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p' "$PROJECT/.codex/agents/riff-controller-routine.toml")"
[[ "$controller_spec" == "$FRAMEWORK_COPY/protocols/RIFF-NEXT.md" ]] || fail "restored Codex route does not target relocated framework"
while IFS= read -r route_file; do
  source="$FRAMEWORK_COPY/agents/codex/$route_file"
  name="riff-$(basename "$source")"
  [[ "$(sed -n '1p' "$PROJECT/.codex/agents/$name")" == '# RIFF-INSTALL: codex-agent' ]] || fail "Codex route ownership marker missing after resync: $name"
  source_spec="$(sed -n -E 's/^[[:space:]]*role_spec_path[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p' "$source")"
  expected_spec="$FRAMEWORK_COPY/$source_spec"
  installed_spec="$(sed -n -E 's/^[[:space:]]*role_spec_path[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p' "$PROJECT/.codex/agents/$name")"
  [[ "$installed_spec" == "$expected_spec" ]] || fail "resynced Codex route does not target relocated framework: $name"
done < <(declared_routes)
[[ ! -e "$PROJECT/.codex/agents/riff-undeclared.toml" ]] || fail "resync installed an undeclared Codex route"

owned_route="$PROJECT/.codex/agents/riff-controller-routine.toml"
printf '# RIFF-INSTALL: codex-agent\nrole_spec_path = "stale-route"\n' > "$owned_route"
(cd "$PROJECT" && HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" "$FRAMEWORK_COPY/riff" resync) >/tmp/riff-resync-test.out 2>&1 || fail "resync failed to update an owned Codex route"
[[ "$(sed -n '1p' "$owned_route")" == '# RIFF-INSTALL: codex-agent' ]] || fail "owned Codex route marker was lost during resync"
updated_spec="$(sed -n -E 's/^[[:space:]]*role_spec_path[[:space:]]*=[[:space:]]*"([^"]+)"[[:space:]]*$/\1/p' "$owned_route")"
[[ "$updated_spec" == "$FRAMEWORK_COPY/protocols/RIFF-NEXT.md" ]] || fail "owned Codex route was not updated by resync"

unowned_route="$PROJECT/.codex/agents/riff-planner-routine.toml"
printf 'unowned route sentinel\n' > "$unowned_route"
(cd "$PROJECT" && HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" "$FRAMEWORK_COPY/riff" resync) >/tmp/riff-resync-test.out 2>&1 || fail "resync failed while preserving an unowned Codex route"
[[ "$(cat "$unowned_route")" == 'unowned route sentinel' ]] || fail "resync overwrote an unowned Codex route"
grep -q "preserving unowned Codex route collision: .*riff-planner-routine.toml" /tmp/riff-resync-test.out || fail "resync did not surface the unowned Codex route collision"

[[ "$(<"$PROJECT/.codex/agents/riff-stale.toml")" == 'stale route' ]] || fail "stale Codex route was deleted"
[[ ! -e "$PROJECT/.codex/agents/riff-retired.toml" ]] || fail "resync did not remove an owned stale Codex route"
[[ "$(<"$PROJECT/.codex/agents/user-route.toml")" == 'unrelated route' ]] || fail "unrelated Codex route changed"
[[ -L "$PROJECT/.codex/agents/user-route-link" ]] || fail "unrelated Codex route symlink changed"
[[ "$(<"$PROJECT/.agents/skills/user-skill")" == 'unrelated skill' ]] || fail "unrelated Codex skill changed"
[[ -L "$PROJECT/.agents/skills/user-skill-link" ]] || fail "unrelated Codex skill symlink changed"
[[ "$(<"$PROJECT/.claude/user-file")" == 'claude user file' ]] || fail "unrelated Claude file changed"
[[ -L "$PROJECT/.claude/user-link" ]] || fail "unrelated Claude symlink changed"
[[ "$(<"$HOME_DIR/sentinel")" == 'home sentinel' ]] || fail "HOME sentinel changed"
[[ "$(<"$CODEX_HOME_DIR/sentinel")" == 'codex home sentinel' ]] || fail "CODEX_HOME sentinel changed"

for runtime in agents codex; do
  rejected="$TEST_DIR/reject-$runtime"
  outside="$TEST_DIR/outside-$runtime"
  mkdir -p "$rejected" "$outside"
  printf 'runtime sentinel\n' > "$outside/sentinel"
  ln -s "$PROJECT/.riff" "$rejected/.riff"
  ln -s "$outside" "$rejected/.$runtime"
  if (cd "$rejected" && HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" "$FRAMEWORK_COPY/riff" resync) >/tmp/riff-resync-test.out 2>&1; then
    fail "resync followed symlinked .$runtime parent"
  fi
  [[ "$(<"$outside/sentinel")" == 'runtime sentinel' ]] || fail "resync changed external .$runtime target"
done

rejected="$TEST_DIR/reject-claude"
outside="$TEST_DIR/outside-claude"
mkdir -p "$rejected" "$outside"
printf 'claude sentinel\n' > "$outside/sentinel"
ln -s "$PROJECT/.riff" "$rejected/.riff"
ln -s "$outside" "$rejected/.claude"
if (cd "$rejected" && HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" "$FRAMEWORK_COPY/riff" resync) >/tmp/riff-resync-test.out 2>&1; then
  fail "resync followed symlinked .claude parent"
fi
[[ "$(<"$outside/sentinel")" == 'claude sentinel' ]] || fail "resync changed external .claude target"

assert_resync_rejects_codex_route_symlink() {
  local label="$1"
  local target_mode="$2"
  local rejected="$TEST_DIR/reject-codex-route-$label"
  local target
  mkdir -p "$rejected"
  HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$rejected" --scope scratch --no-onboard >/tmp/riff-resync-test.out 2>&1 || fail "initial init failed for Codex route symlink regression: $label"

  local route="$rejected/.codex/agents/riff-reviewer-routine.toml"
  rm "$route"
  if [[ "$target_mode" == "in-root" ]]; then
    target="$rejected/.codex/agents/route-target-$label"
    printf 'in-root Codex route target\n' > "$target"
    ln -s "route-target-$label" "$route"
  else
    target="$OUTSIDE/codex-route-target-$label"
    printf 'outside Codex route target\n' > "$target"
    ln -s "$target" "$route"
  fi
  local expected_link
  expected_link="$(readlink "$route")"
  if (cd "$rejected" && HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" "$FRAMEWORK_COPY/riff" resync) >/tmp/riff-resync-test.out 2>&1; then
    fail "resync accepted expected-name Codex route symlink: $label"
  fi
  [[ -L "$route" ]] || fail "resync replaced expected-name Codex route symlink: $label"
  [[ "$(readlink "$route")" == "$expected_link" ]] || fail "resync changed Codex route symlink target: $label"
  [[ -f "$target" ]] || fail "resync removed Codex route symlink target: $label"
  ! grep -q '^RIFF resync complete ' /tmp/riff-resync-test.out || fail "resync reported success after Codex route symlink rejection: $label"
}

assert_resync_rejects_codex_route_symlink 'in-root' 'in-root'
assert_resync_rejects_codex_route_symlink 'outside' 'outside'

HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" node "$FRAMEWORK_COPY/riff" init --project-root "$FOREIGN_PROJECT" --scope scratch --no-onboard >/tmp/riff-resync-test.out 2>&1 || fail "initial init failed for foreign framework resync regression"
rm "$FOREIGN_PROJECT/.riff"
ln -s "$HOSTILE_FRAMEWORK" "$FOREIGN_PROJECT/.riff"
foreign_riff_target="$(readlink "$FOREIGN_PROJECT/.riff")"
foreign_skills_before="$(snapshot_tree "$FOREIGN_PROJECT/.agents/skills")"
foreign_claude_before="$(snapshot_tree "$FOREIGN_PROJECT/.claude")"
foreign_codex_before="$(snapshot_tree "$FOREIGN_PROJECT/.codex/agents")"
if (cd "$FOREIGN_PROJECT" && HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" "$FRAMEWORK_COPY/riff" resync) >/tmp/riff-resync-test.out 2>&1; then
  fail "resync accepted a foreign .riff symlink"
fi
grep -Fq "ERROR: .riff symlink resolves to $HOSTILE_FRAMEWORK, expected $FRAMEWORK_COPY; preserving the existing link" /tmp/riff-resync-test.out || fail "resync did not report the foreign .riff framework mismatch"
[[ "$(readlink "$FOREIGN_PROJECT/.riff")" == "$foreign_riff_target" ]] || fail "resync changed the foreign .riff symlink"
[[ "$(snapshot_tree "$FOREIGN_PROJECT/.agents/skills")" == "$foreign_skills_before" ]] || fail "resync changed consumer skills after framework mismatch"
[[ "$(snapshot_tree "$FOREIGN_PROJECT/.claude")" == "$foreign_claude_before" ]] || fail "resync changed Claude adapters after framework mismatch"
[[ "$(snapshot_tree "$FOREIGN_PROJECT/.codex/agents")" == "$foreign_codex_before" ]] || fail "resync changed Codex routes after framework mismatch"

if ! (cd "$FRAMEWORK_COPY" && HOME="$HOME_DIR" CODEX_HOME="$CODEX_HOME_DIR" "$FRAMEWORK_COPY/riff" resync) >/tmp/riff-resync-test.out 2>&1; then
  fail "resync failed in the framework root self mode"
fi
grep -q 'RIFF resync complete .* (mode: self):' /tmp/riff-resync-test.out || fail "resync did not report self mode in the framework root"

echo "riff-resync test: passed"

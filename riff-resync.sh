#!/usr/bin/env bash
# riff-resync.sh — sync per-file symlinks into .claude/{commands,agents,hooks}/riff/
# Two modes:
#   - project mode: run from a project root that has .riff/ symlinking to the framework
#   - self mode:    run from the framework root itself (bootstrap so /riff:onboard works
#                   on a fresh clone of the framework)
# Idempotent. Safe to re-run.

set -euo pipefail

CODEX_ROUTE_MARKER="# RIFF-INSTALL: codex-agent"
SCRIPT_FRAMEWORK_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

# Resync operates from the consumer Git root so runtime paths are unambiguous.
CURRENT_ROOT="$(pwd -P)"
CONSUMER_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$CONSUMER_ROOT" ]; then
  CONSUMER_ROOT="$CURRENT_ROOT"
else
  CONSUMER_ROOT="$(cd "$CONSUMER_ROOT" && pwd -P)"
fi
cd "$CONSUMER_ROOT"

# Detect mode
if [ -L ".riff" ]; then
  MODE="project"
  FRAMEWORK="$(readlink ".riff")"
  case "$FRAMEWORK" in
    /*) ;;
    *) FRAMEWORK="$(pwd)/$FRAMEWORK" ;;
  esac
  if [ ! -d "$FRAMEWORK" ]; then
    echo "ERROR: .riff symlink target does not exist: $FRAMEWORK" >&2
    exit 1
  fi
  FRAMEWORK="$(cd "$FRAMEWORK" && pwd -P)"
  if [ "$FRAMEWORK" != "$SCRIPT_FRAMEWORK_ROOT" ]; then
    echo "ERROR: .riff symlink resolves to $FRAMEWORK, expected $SCRIPT_FRAMEWORK_ROOT; preserving the existing link" >&2
    exit 1
  fi
  SRC_PREFIX=".riff/"
  WANT_PREFIX="../../../.riff/"
elif [ -d "commands" ] && [ -d "agents" ] && [ -d "hooks" ] && [ -f "CLAUDE.md" ]; then
  # Self-bootstrap: we're inside the framework root
  if [ "$CURRENT_ROOT" != "$SCRIPT_FRAMEWORK_ROOT" ]; then
    echo "ERROR: self mode requires current root $SCRIPT_FRAMEWORK_ROOT; got $CURRENT_ROOT" >&2
    exit 1
  fi
  MODE="self"
  FRAMEWORK="$SCRIPT_FRAMEWORK_ROOT"
  SRC_PREFIX=""
  WANT_PREFIX="../../../"
else
  echo "ERROR: cannot determine mode in $(pwd)." >&2
  echo "  - In a project root: create .riff symlink to the framework first (or run /riff:init)." >&2
  echo "  - In the framework root: expected commands/, agents/, hooks/ and CLAUDE.md to be present." >&2
  exit 1
fi

fail_runtime_path() {
  echo "ERROR: unsafe runtime path: $1" >&2
  exit 1
}

assert_runtime_path() {
  local relative="$1"
  local current="$CONSUMER_ROOT"
  local component
  local resolved
  local old_ifs="$IFS"
  local -a components
  if [ -z "$relative" ] || [ "$relative" = "." ]; then
    return 0
  fi
  IFS='/' read -r -a components <<< "$relative"
  IFS="$old_ifs"

  for component in "${components[@]}"; do
    [ -z "$component" ] && continue
    case "$component" in
      .|..) fail_runtime_path "$relative" ;;
    esac
    current="$current/$component"
    if [ -L "$current" ]; then
      fail_runtime_path "$relative, symlink component: $current"
    fi
    if [ -e "$current" ]; then
      [ -d "$current" ] || fail_runtime_path "$relative, non-directory component: $current"
      resolved="$(cd "$current" && pwd -P)" || fail_runtime_path "$relative, unresolved component: $current"
      case "$resolved/" in
        "$CONSUMER_ROOT/"*|"$CONSUMER_ROOT") ;;
        *) fail_runtime_path "$relative, component resolves outside $CONSUMER_ROOT: $current" ;;
      esac
    else
      break
    fi
  done
}

ensure_runtime_dir() {
  local relative="$1"
  local current="$CONSUMER_ROOT"
  local component
  local current_relative
  local parent_relative
  local old_ifs="$IFS"
  local -a components
  IFS='/' read -r -a components <<< "$relative"
  IFS="$old_ifs"

  for component in "${components[@]}"; do
    [ -z "$component" ] && continue
    current="$current/$component"
    current_relative="${current#"$CONSUMER_ROOT"/}"
    if [ -L "$current" ]; then
      fail_runtime_path "$relative, symlink component: $current"
    elif [ -e "$current" ]; then
      [ -d "$current" ] || fail_runtime_path "$relative, non-directory component: $current"
    else
      parent_relative="$(dirname "$current_relative")"
      assert_runtime_path "$parent_relative"
      mkdir -- "$current"
    fi
    assert_runtime_path "$current_relative"
  done
}

assert_runtime_parent() {
  local target="$1"
  local parent_relative
  parent_relative="$(dirname "$target")"
  ensure_runtime_dir "$parent_relative"
  assert_runtime_path "$parent_relative"
}

resolve_link_target() {
  local target="$1"
  local current="$2"
  local candidate
  local candidate_parent
  local resolved_parent
  case "$current" in
    /*) candidate="$current" ;;
    *) candidate="$(dirname "$target")/$current" ;;
  esac
  candidate_parent="$(dirname "$candidate")"
  [ -d "$candidate_parent" ] || return 1
  resolved_parent="$(cd "$candidate_parent" 2>/dev/null && pwd -P)" || return 1
  printf '%s/%s\n' "$resolved_parent" "$(basename "$candidate")"
}

is_owned_riff_link() {
  local target="$1"
  local current="$2"
  local want="$3"
  local namespace="$4"
  local name="$5"
  local resolved

  [ "$current" = "$want" ] && return 0
  [ "$MODE" = "project" ] || return 1
  case "$current" in
    */.riff/"$namespace"/"$name") ;;
    *) return 1 ;;
  esac
  if ! resolved="$(resolve_link_target "$target" "$current")"; then
    return 1
  fi
  [ "$resolved" = "$FRAMEWORK/$namespace/$name" ]
}

for runtime_path in .agents .agents/skills .codex .codex/agents .claude; do
  assert_runtime_path "$runtime_path"
done

added=0
removed=0

ensure_runtime_dir .claude/commands/riff
ensure_runtime_dir .claude/agents/riff
ensure_runtime_dir .claude/hooks/riff

ensure_runtime_dir .agents/skills
ensure_runtime_dir .codex/agents

link_skill() {
  local name="$1"
  local target=".agents/skills/$name"
  local want
  if [ "$MODE" = "project" ]; then
    want="../../.riff/skills/$name"
  else
    want="../../skills/$name"
  fi
  local current_skill
  current_skill="$(readlink "$target" 2>/dev/null || true)"
  if [ "$current_skill" != "$want" ]; then
    if [ -e "$target" ] && [ ! -L "$target" ]; then
      continue
    fi
    if [ -L "$target" ]; then
      is_owned_riff_link "$target" "$current_skill" "$want" "skills" "$name" || continue
      assert_runtime_parent "$target"
      rm -- "$target"
    fi
    assert_runtime_parent "$target"
    ln -s -- "$want" "$target"
    added=$((added + 1))
  fi
}

if [ -d "$FRAMEWORK/skills" ]; then
  for skill in "$FRAMEWORK"/skills/*; do
    [ -d "$skill" ] || continue
    link_skill "$(basename "$skill")"
  done
fi

if [ -d "$FRAMEWORK/agents/codex" ]; then
  route_role_spec() {
    local source="$1"
    [ -L "$source" ] && { echo "ERROR: Codex route source is a symlink: $source" >&2; exit 1; }
    node --input-type=module - "$source" "$FRAMEWORK" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , source, frameworkRoot] = process.argv;
const { validateRouteSource } = await import(pathToFileURL(path.join(frameworkRoot, 'scripts/lib/runtime-routes.mjs')).href);
const result = validateRouteSource({ file: source, frameworkRoot });
if (result.errors.length) throw new Error(`Codex route is invalid: ${source}: ${result.errors.join('; ')}`);
const stat = fs.lstatSync(result.roleSpecPath);
if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Codex route role specification is not a regular file: ${result.roleSpecPath}`);
const resolved = fs.realpathSync(result.roleSpecPath);
if (!resolved.startsWith(`${path.resolve(frameworkRoot)}${path.sep}`)) throw new Error(`Codex route role specification escapes the framework root: ${result.roleSpecPath}`);
process.stdout.write(`${resolved}\n`);
NODE
  }

  write_materialized_route() {
    local source="$1"
    local target="$2"
    local role_spec="$3"
    node - "$source" "$target" "$role_spec" "$CODEX_ROUTE_MARKER" <<'NODE'
const fs = require('node:fs');

const [, , source, target, roleSpec, marker] = process.argv;
const text = fs.readFileSync(source, 'utf8');
const pattern = /^(\s*role_spec_path\s*=\s*)(["'])([^"']+)\2(\s*)$/gm;
const matches = [...text.matchAll(pattern)];
if (matches.length !== 1) {
  process.stderr.write(`Codex route must contain exactly one role_spec_path: ${source}\n`);
  process.exit(1);
}
const route = text.replace(pattern, (_match, prefix, _quote, _raw, suffix) => `${prefix}${JSON.stringify(roleSpec)}${suffix}`);
const materialized = `${marker}\n${route}`;
const descriptor = fs.openSync(target, 'wx', 0o600);
try {
  fs.writeFileSync(descriptor, materialized);
} finally {
  fs.closeSync(descriptor);
}
NODE
  }

  is_owned_codex_route() {
    local target="$1"
    [ -f "$target" ] || return 1
    [ "$(sed -n '1p' "$target")" = "$CODEX_ROUTE_MARKER" ]
  }

  copy_route() {
    local source="$1"
    local target="$2"
    local tmp="${target}.$$"
    local role_spec
    if [ -L "$target" ]; then
      echo "ERROR: refusing to replace expected Codex route symlink: $target" >&2
      exit 1
    fi
    if [ -e "$target" ] && [ ! -f "$target" ]; then
      echo "ERROR: refusing to replace unrelated $target" >&2
      exit 1
    fi
    if [ -f "$target" ] && ! is_owned_codex_route "$target"; then
      echo "WARNING: preserving unowned Codex route collision: $target" >&2
      return 1
    fi
    if [ -L "$tmp" ] || [ -e "$tmp" ]; then
      echo "ERROR: temporary Codex route already exists: $tmp" >&2
      exit 1
    fi
    role_spec="$(route_role_spec "$source")"
    assert_runtime_parent "$target"
    write_materialized_route "$source" "$tmp" "$role_spec"
    if [ -L "$tmp" ] || [ ! -f "$tmp" ]; then
      echo "ERROR: temporary Codex route is not a regular file: $tmp" >&2
      exit 1
    fi
    if [ -L "$target" ] || { [ -e "$target" ] && [ ! -f "$target" ]; }; then
      echo "ERROR: destination changed during Codex route copy: $target" >&2
      exit 1
    fi
    assert_runtime_parent "$target"
    mv -f -- "$tmp" "$target"
  }

  route_files="$(node --input-type=module - "$FRAMEWORK" <<'NODE'
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const frameworkRoot = process.argv[2];
const { ROUTE_PORTFOLIO } = await import(pathToFileURL(path.join(frameworkRoot, 'scripts/lib/runtime-routes.mjs')).href);
process.stdout.write(`${ROUTE_PORTFOLIO.map((route) => route.file).join('\n')}\n`);
NODE
)"
  while IFS= read -r route_file; do
    [ -n "$route_file" ] || continue
    source="$FRAMEWORK/agents/codex/$route_file"
    [ -f "$source" ] || { echo "ERROR: missing declared Codex route: $source" >&2; exit 1; }
    name="riff-$(basename "$source")"
    target=".codex/agents/$name"
    if copy_route "$source" "$target"; then
      added=$((added + 1))
    fi
  done <<< "$route_files"
  is_declared_codex_route() {
    local candidate="$1"
    local declared
    while IFS= read -r declared; do
      [ -n "$declared" ] || continue
      if [ "riff-$declared" = "$candidate" ]; then
        return 0
      fi
    done <<< "$route_files"
    return 1
  }
  while IFS= read -r -d '' stale_route; do
    stale_name="$(basename "$stale_route")"
    if is_declared_codex_route "$stale_name"; then continue; fi
    if is_owned_codex_route "$stale_route"; then
      rm -- "$stale_route"
      added=$((added + 1))
    fi
  done < <(find .codex/agents -maxdepth 1 -type f -name 'riff-*.toml' -print0)
fi

link_one() {
  # link_one <source-glob-dir> <target-dir> <ext> [skip_pattern]
  local src_dir="${SRC_PREFIX}$1"
  local target_dir="$2"
  local ext="$3"
  local skip_pattern="${4:-}"
  for f in "$src_dir"/*."$ext"; do
    [ -e "$f" ] || continue
    local name
    name="$(basename "$f")"
    if [ -n "$skip_pattern" ]; then
      case "$name" in
        $skip_pattern) continue ;;
      esac
    fi
    local target="$target_dir/$name"
    local want="${WANT_PREFIX}$1/$name"
    local current
    current="$(readlink "$target" 2>/dev/null || true)"
    if [ -e "$target" ] && [ ! -L "$target" ]; then continue; fi
    if [ -L "$target" ] && ! is_owned_riff_link "$target" "$current" "$want" "$1" "$name"; then continue; fi
    if [ "$current" != "$want" ]; then
      assert_runtime_parent "$target"
      ln -sf "$want" "$target"
      added=$((added + 1))
    fi
  done
}

link_one "commands" ".claude/commands/riff" "md"
link_one "agents"   ".claude/agents/riff"   "md"
# security-scan.sh and commit-msg.sh live in .git/hooks/, not .claude/hooks/riff/
link_one "hooks"    ".claude/hooks/riff"    "sh" "security-scan.sh|commit-msg.sh"

# Cleanup dangling symlinks
for d in .claude/commands/riff .claude/agents/riff .claude/hooks/riff; do
  [ -d "$d" ] || continue
  while IFS= read -r -d '' link; do
    case "$d" in
      .claude/commands/riff) namespace="commands" ;;
      .claude/agents/riff) namespace="agents" ;;
      .claude/hooks/riff) namespace="hooks" ;;
      *) continue ;;
    esac
    name="$(basename "$link")"
    target_value="$(readlink "$link" 2>/dev/null || true)"
    want="${WANT_PREFIX}${namespace}/$name"
    if [ ! -e "$link" ] && is_owned_riff_link "$link" "$target_value" "$want" "$namespace" "$name"; then
      rm "$link"
      echo "  removed dangling: $link"
      removed=$((removed + 1))
    fi
  done < <(find "$d" -maxdepth 1 -type l -print0)
done

while IFS= read -r -d '' link; do
  name="$(basename "$link")"
  target_value="$(readlink "$link" 2>/dev/null || true)"
  if [ "$MODE" = "project" ]; then
    want="../../.riff/skills/$name"
  else
    want="../../skills/$name"
  fi
  if [ ! -e "$link" ] && is_owned_riff_link "$link" "$target_value" "$want" "skills" "$name"; then
    rm "$link"
    echo "  removed dangling: $link"
    removed=$((removed + 1))
  fi
done < <(find .agents/skills -maxdepth 1 -type l -print0 2>/dev/null || true)

# CLAUDE.md drift detection (informational; does NOT auto-apply, project mode only)
drift=""
if [ "$MODE" = "project" ] && [ -f "CLAUDE.md" ] && [ -f ".riff/CLAUDE.md" ]; then
  while IFS= read -r row; do
    phrase="$(printf '%s' "$row" | sed -n 's/^| *"\([^"]*\)".*/\1/p')"
    [ -z "$phrase" ] && continue
    if ! grep -qF "\"$phrase\"" CLAUDE.md; then
      drift="${drift}  - missing: \"$phrase\""$'\n'
    fi
  done < <(grep '^| "' ".riff/CLAUDE.md" || true)
fi

echo "RIFF resync complete in $(pwd) (mode: $MODE):"
echo "  Symlinks added/refreshed: $added"
echo "  Dangling symlinks removed: $removed"
if [ "$MODE" = "project" ]; then
  if [ -n "$drift" ]; then
    echo "  CLAUDE.md drift detected (copy these rows from .riff/CLAUDE.md § Conversational triggers into your project CLAUDE.md):"
    printf '%s' "$drift"
  else
    echo "  CLAUDE.md drift: none"
  fi
fi

if [ -f "$FRAMEWORK/scripts/riff-doctor.mjs" ]; then
  echo "  Doctor:"
  if ! node "$FRAMEWORK/scripts/riff-doctor.mjs"; then
    echo "  riff doctor warning: reference lint failed (warn-only during resync)" >&2
  fi
fi

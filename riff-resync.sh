#!/usr/bin/env bash
# riff-resync.sh — sync per-file symlinks into .claude/{commands,agents,hooks}/riff/
# Two modes:
#   - project mode: run from a project root that has .riff/ symlinking to the framework
#   - self mode:    run from the framework root itself (bootstrap so /riff:onboard works
#                   on a fresh clone of the framework)
# Idempotent. Safe to re-run.

set -euo pipefail

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
  SRC_PREFIX=".riff/"
  WANT_PREFIX="../../../.riff/"
elif [ -d "commands" ] && [ -d "agents" ] && [ -d "hooks" ] && [ -f "CLAUDE.md" ]; then
  # Self-bootstrap: we're inside the framework root
  MODE="self"
  FRAMEWORK="$(pwd)"
  SRC_PREFIX=""
  WANT_PREFIX="../../../"
else
  echo "ERROR: cannot determine mode in $(pwd)." >&2
  echo "  - In a project root: create .riff symlink to the framework first (or run /riff:init)." >&2
  echo "  - In the framework root: expected commands/, agents/, hooks/ and CLAUDE.md to be present." >&2
  exit 1
fi

added=0
removed=0

mkdir -p .claude/commands/riff .claude/agents/riff .claude/hooks/riff

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
    if [ "$current" != "$want" ]; then
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
    if [ ! -e "$link" ]; then
      rm "$link"
      echo "  removed dangling: $link"
      removed=$((removed + 1))
    fi
  done < <(find "$d" -maxdepth 1 -type l -print0)
done

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

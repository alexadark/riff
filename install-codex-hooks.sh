#!/usr/bin/env bash
# Install RIFF PostToolUse hooks into Codex CLI.
#
# Adds the 5 dual-runtime hooks (idor-detector, route-auth-guard,
# input-validation-guard, boundary-check, todo-orphan-guard) to ~/.codex/hooks.json under
# the apply_patch matcher. Idempotent: skips entries that are already
# present. Preserves all other hook entries (auto-sync, notify, etc.).
#
# After running, the next interactive `codex` session prompts to trust
# each new hook. This is a Codex security feature: untrusted hooks are
# silently skipped (see protocols/HOOKS.md § "Hook trust").
#
# Usage: bash install-codex-hooks.sh

set -euo pipefail

CODEX_HOOKS="$HOME/.codex/hooks.json"
RIFF_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$RIFF_ROOT/hooks"
MATCHER='^(Write|Edit|apply_patch)$'

HOOK_NAMES=(
  "idor-detector.sh"
  "route-auth-guard.sh"
  "input-validation-guard.sh"
  "boundary-check.sh"
  "todo-orphan-guard.sh"
)

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required. Install via brew install jq." >&2
  exit 1
fi

mkdir -p "$(dirname "$CODEX_HOOKS")"
if [ ! -f "$CODEX_HOOKS" ]; then
  echo '{"hooks":{"PostToolUse":[]}}' > "$CODEX_HOOKS"
  echo "Created $CODEX_HOOKS"
fi

# Verify all source hooks exist before touching the config.
for name in "${HOOK_NAMES[@]}"; do
  if [ ! -x "$HOOKS_DIR/$name" ]; then
    echo "ERROR: $HOOKS_DIR/$name missing or not executable." >&2
    exit 1
  fi
done

# Ensure the apply_patch matcher group exists. If a group with that exact
# matcher is not present, append a new empty group; otherwise leave the
# existing structure untouched.
tmp="$(mktemp)"
jq --arg matcher "$MATCHER" '
  .hooks.PostToolUse = (.hooks.PostToolUse // []) |
  if (.hooks.PostToolUse | map(.matcher == $matcher) | any) then .
  else .hooks.PostToolUse += [{"matcher": $matcher, "hooks": []}]
  end
' "$CODEX_HOOKS" > "$tmp" && mv "$tmp" "$CODEX_HOOKS"

added=0
skipped=0
for name in "${HOOK_NAMES[@]}"; do
  cmd="$HOOKS_DIR/$name"
  exists="$(jq --arg matcher "$MATCHER" --arg cmd "$cmd" '
    .hooks.PostToolUse[]
    | select(.matcher == $matcher)
    | .hooks
    | map(.command == $cmd)
    | any
  ' "$CODEX_HOOKS")"

  if [ "$exists" = "true" ]; then
    echo "skip   $name (already installed)"
    skipped=$((skipped + 1))
    continue
  fi

  jq --arg matcher "$MATCHER" --arg cmd "$cmd" '
    .hooks.PostToolUse |= map(
      if .matcher == $matcher then
        .hooks += [{"type": "command", "command": $cmd}]
      else .
      end
    )
  ' "$CODEX_HOOKS" > "$tmp" && mv "$tmp" "$CODEX_HOOKS"

  echo "added  $name"
  added=$((added + 1))
done

echo ""
echo "Done. $added added, $skipped already present."

if [ "$added" -gt 0 ]; then
  cat <<'NOTE'

Next: start an interactive `codex` session. Codex will prompt you to
trust each newly added hook. Approve once; the trust persists in
~/.codex/config.toml under [hooks.state]. Until trusted, Codex skips
the hooks silently (apply_patch still works, just unguarded).

Bypass for one-off automation: codex exec --dangerously-bypass-hook-trust ...
NOTE
fi

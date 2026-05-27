#!/usr/bin/env bash
# Re-run the RIFF security PostToolUse hooks against every file changed in a
# git range. Used by /riff:wave Step 6 in `hooks` reconcile mode to verify
# that a wave's commits pass the same gates the live hooks enforce when
# Claude/Codex write files.
#
# Usage:
#   bash hooks/lib/reconcile-diff.sh <base-ref> <head-ref> [project-root]
#
# The hooks themselves are unchanged. We synthesize a Claude-style payload
# per file and pipe it to each hook. RIFF_SCRATCH_MODE is explicitly unset
# so findings surface cleanly even if the wave shipped under scratch mode.
#
# Output (stdout, machine-readable):
#   FINDING|<hook-name>|<absolute-file-path>|<one-line message>
# Plus a trailing summary line:
#   SUMMARY|files_scanned=<n>|findings=<n>
#
# Exit code: 0 (findings are reported, not enforced here; the caller decides
# how to react).

set -u

BASE_REF="${1:-}"
HEAD_REF="${2:-HEAD}"
PROJECT_ROOT="${3:-$(pwd)}"

if [ -z "$BASE_REF" ]; then
  echo "usage: reconcile-diff.sh <base-ref> <head-ref> [project-root]" >&2
  exit 2
fi

cd "$PROJECT_ROOT" 2>/dev/null || {
  echo "ERROR: cannot cd to $PROJECT_ROOT" >&2
  exit 2
}

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq is required" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOKS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

HOOKS=(
  idor-detector.sh
  route-auth-guard.sh
  input-validation-guard.sh
  boundary-check.sh
)

CHANGED_FILES=()
while IFS= read -r f; do
  [ -z "$f" ] && continue
  [ -f "$PROJECT_ROOT/$f" ] || continue
  CHANGED_FILES+=("$f")
done < <(git -C "$PROJECT_ROOT" diff --name-only --diff-filter=ACMR "$BASE_REF" "$HEAD_REF" 2>/dev/null)

FILES_SCANNED=${#CHANGED_FILES[@]}
FINDINGS_COUNT=0

for rel in "${CHANGED_FILES[@]}"; do
  abs="$PROJECT_ROOT/$rel"
  payload=$(jq -nc --arg fp "$abs" --arg cwd "$PROJECT_ROOT" '
    { cwd: $cwd, hook_event_name: "PostToolUse", tool_name: "Write",
      tool_input: { file_path: $fp, content: "" } }
  ')

  for hook in "${HOOKS[@]}"; do
    out=$(printf '%s' "$payload" | env -u RIFF_SCRATCH_MODE -u RIFF_WAVE_ID bash "$HOOKS_DIR/$hook" 2>&1)
    name="${hook%.sh}"
    if echo "$out" | grep -qE 'RIFF (IDOR|Auth|Validation|WARNING)'; then
      msg=$(echo "$out" | head -1 | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
      printf 'FINDING|%s|%s|%s\n' "$name" "$abs" "$msg"
      FINDINGS_COUNT=$((FINDINGS_COUNT + 1))
    fi
  done
done

printf 'SUMMARY|files_scanned=%d|findings=%d\n' "$FILES_SCANNED" "$FINDINGS_COUNT"
exit 0

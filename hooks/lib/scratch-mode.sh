#!/usr/bin/env bash
# Shared helper for RIFF security hooks when `scratch_mode` is active.
# Source this script after lib/extract-files.sh, then call the riff_scratch_*
# functions to decide whether to downgrade a finding and to record it in the
# wave reconcile file.
#
# Activation: env var RIFF_SCRATCH_MODE=1
# Wave id (optional): env var RIFF_WAVE_ID=W{N}  (default: CURRENT)
#
# When active, security hooks should:
#   - keep printing the warning to stdout (visible to Codex/Claude)
#   - append the finding to .planning/followups/SECURITY-W{N}-RECONCILE.md
#   - never escalate to exit 1 (PostToolUse hooks already exit 0; the
#     security-scan pre-commit hook treats BLOCKED findings as WARNING)
#
# The promote flow refuses to flip scope until every non-empty
# SECURITY-*-RECONCILE.md is resolved. See protocols/PROMOTE.md.

riff_scratch_active() {
  [ "${RIFF_SCRATCH_MODE:-0}" = "1" ]
}

riff_scratch_wave_id() {
  printf '%s' "${RIFF_WAVE_ID:-CURRENT}"
}

# Resolve the reconcile file path. Args: [project_root]
riff_scratch_reconcile_path() {
  local root="${1:-${RIFF_CWD:-$(pwd)}}"
  local wave; wave="$(riff_scratch_wave_id)"
  printf '%s/.planning/followups/SECURITY-%s-RECONCILE.md' "$root" "$wave"
}

# Append a finding to SECURITY-W{N}-RECONCILE.md when scratch mode is active.
# No-op otherwise. Best-effort, never fails the calling hook.
# Args: <hook-name> <file-path> <message...>
riff_scratch_reconcile_append() {
  riff_scratch_active || return 0
  local hook="$1" file="$2"
  shift 2 || true
  local msg="$*"
  local root="${RIFF_CWD:-$(pwd)}"
  local path; path="$(riff_scratch_reconcile_path "$root")"
  local dir; dir="$(dirname "$path")"
  mkdir -p "$dir" 2>/dev/null || return 0
  if [ ! -f "$path" ]; then
    {
      printf '# Security reconcile, wave %s\n\n' "$(riff_scratch_wave_id)"
      printf 'Findings flagged by RIFF security hooks while `scratch_mode` was active.\n'
      printf 'They were DOWNGRADED to warnings and not blocking.\n'
      printf '`/riff:promote` (or the conversational "promote to production" trigger)\n'
      printf 'is blocked until this file is empty or deleted.\n\n'
      printf '## Findings\n\n'
    } > "$path"
  fi
  local ts; ts="$(date '+%Y-%m-%d %H:%M:%S')"
  printf -- '- [%s] **%s** `%s`: %s\n' "$ts" "$hook" "$file" "$msg" >> "$path"
}

# Print a SCRATCH banner before a downgraded warning. Hooks can call this
# before their normal `echo "RIFF ... :"` line to make it obvious in the log
# that the finding was tolerated, not enforced.
riff_scratch_banner() {
  riff_scratch_active || return 0
  printf 'RIFF SCRATCH MODE: downgrading the following finding to a warning.\n'
}

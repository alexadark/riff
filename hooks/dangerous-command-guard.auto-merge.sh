#!/usr/bin/env bash
# RIFF AFK Guard — auto-merge variant.
#
# Mirror of hooks/dangerous-command-guard.sh with one additional carve-out:
# permits EXACTLY `gh pr merge <ref> --auto --squash --delete-branch` (any flag
# order) so the AFK loop can schedule chained merges. Every other form of
# `gh pr merge` falls through to the original denylist and is blocked.
#
# Only used when `git.merge_strategy: auto_merge`. Selected by riff-loop.sh
# via templates/settings.afk.auto-merge.json. For all other strategies,
# settings.afk.json + dangerous-command-guard.sh stay in force and `gh pr merge`
# is blocked entirely.
#
# If you edit the base hook, sync the changes here (PATTERNS array, log format).

set -u
umask 077

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
LOG="$PROJECT_DIR/.planning/security-events.log"
mkdir -p "$(dirname "$LOG")" 2>/dev/null || true

INPUT="$(cat)"
if command -v jq >/dev/null 2>&1; then
  CMD="$(printf '%s' "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)"
  SESSION_ID="$(printf '%s' "$INPUT" | jq -r '.session_id // empty' 2>/dev/null)"
else
  CMD="$(printf '%s' "$INPUT" | sed -n 's/.*"command"[[:space:]]*:[[:space:]]*"\(.*\)"[[:space:]]*,.*/\1/p' | head -n1)"
  SESSION_ID=""
fi

if [ -z "$CMD" ]; then
  echo "RIFF AFK guard: empty command, blocking (fail-closed)." >&2
  exit 2
fi

# auto-merge carve-out: permit EXACTLY `gh pr merge <ref> --auto --squash --delete-branch`.
# Flag checks use whitespace word-anchors so substrings like `--automatic` or
# `--auto-rebase` cannot satisfy `--auto`. Flag order is unconstrained (model
# may emit them in any order). Compound-separator check rejects
# `gh pr merge ... && rm -rf .` style payloads that would otherwise smuggle
# destructive commands past the three-flag gate.
if printf '%s' "$CMD" | grep -Eq '^[[:space:]]*gh[[:space:]]+pr[[:space:]]+merge[[:space:]]'; then
  if printf '%s' "$CMD" | grep -Eq -- '(^|[[:space:]])--auto([[:space:]]|$)' \
     && printf '%s' "$CMD" | grep -Eq -- '(^|[[:space:]])--squash([[:space:]]|$)' \
     && printf '%s' "$CMD" | grep -Eq -- '(^|[[:space:]])--delete-branch([[:space:]]|$)' \
     && ! printf '%s' "$CMD" | grep -Eq -- '(&&|\|\||;|\|[^|]|`|\$\()'; then
    exit 0
  fi
fi

PATTERNS=(
  'rm[[:space:]]+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r|--recursive[[:space:]]+--force|--force[[:space:]]+--recursive)([[:space:]]+|$)'
  '\brm[[:space:]]+-rf[[:space:]]+(/|~|\$HOME|\$\{HOME\}|\.\.?($|/))'
  '\bfind[[:space:]]+(/|~|\$HOME)[[:space:]].*-delete'
  '\bfind[[:space:]].*-exec[[:space:]]+rm'

  '\bsudo([[:space:]]|$)'
  '\bsu([[:space:]]|$)'
  '\bdoas([[:space:]]|$)'
  '\bchmod[[:space:]]+(-R[[:space:]]+)?(777|\+s)'
  '\bchown[[:space:]]'

  '(curl|wget|fetch)[[:space:]].*\|[[:space:]]*(bash|sh|zsh)([[:space:]]|$)'
  '(bash|sh|zsh)[[:space:]]+<\([[:space:]]*(curl|wget)'

  '\beval([[:space:]]|$)'
  '^[[:space:]]*\.[[:space:]]+[^/]'
  '\bsource([[:space:]]|$)'
  '\b(bash|sh|zsh)[[:space:]]+-c([[:space:]]|$)'
  '\bbase64[[:space:]]+(-d|--decode)'
  '\|[[:space:]]*base64[[:space:]]+(-d|--decode)'

  '>[[:space:]]*/etc/'
  '>>[[:space:]]*/etc/'
  '>[[:space:]]*/dev/(sd|disk|nvme|hd)'
  '\bdd[[:space:]]+.*of=/dev/'
  '\bmkfs([[:space:]]|\.)'
  '\b(mount|umount|fdisk)([[:space:]]|$)'

  '\bgit[[:space:]]+push[[:space:]]+(.*[[:space:]])?(-f|--force|--force-with-lease)'
  '\bgit[[:space:]]+reset[[:space:]]+--hard'
  '\bgit[[:space:]]+filter-(branch|repo)'
  '\bgit[[:space:]]+clean[[:space:]]+-[a-zA-Z]*[fdx]'

  '\b(npm|pnpm|yarn|bun)[[:space:]]+publish'
  '\b(npm|pnpm)[[:space:]]+install[[:space:]]+-g'
  '\b(npm|pnpm)[[:space:]]+i[[:space:]]+-g'
  '\bpnpm[[:space:]]+add[[:space:]]+-g'

  '\bdocker([[:space:]]|$)'
  '\bkubectl([[:space:]]|$)'
  '\bhelm([[:space:]]|$)'
  '\bsystemctl([[:space:]]|$)'
  '\blaunchctl([[:space:]]|$)'
  '\bcrontab([[:space:]]|$)'
  '\bat[[:space:]]+(-f|now|[0-9])'
  '\bssh([[:space:]]|$)'
  '\bscp([[:space:]]|$)'

  '\bgh[[:space:]]+(auth|secret)([[:space:]]|$)'
  '\bgh[[:space:]]+pr[[:space:]]+merge'
)

MATCHED=""
for pat in "${PATTERNS[@]}"; do
  if printf '%s' "$CMD" | grep -Eq -- "$pat"; then
    MATCHED="$pat"
    break
  fi
done

if [ -n "$MATCHED" ]; then
  TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  esc() {
    printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read())[1:-1])' 2>/dev/null \
      || printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
  }
  printf '{"ts":"%s","event":"bash_blocked","pattern":"%s","command":"%s","cwd":"%s","session_id":"%s","loop_id":"%s"}\n' \
    "$TS" "$(esc "$MATCHED")" "$(esc "$CMD")" "$(esc "$PROJECT_DIR")" "$(esc "$SESSION_ID")" "${LOOP_ID:-}" \
    >> "$LOG"
  chmod 600 "$LOG" 2>/dev/null || true

  cat <<EOF >&2
RIFF AFK guard: command blocked.
Reason: matches denylist pattern.
Pattern: $MATCHED
See: $LOG
EOF
  exit 2
fi

exit 0

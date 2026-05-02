#!/bin/bash
# RIFF Human Notification - dispatches to the channel configured in profile.yaml.
# Usage: bash notify-human.sh "Your message here"
#
# Resolution order for profile.yaml (per references/PROFILE-RESOLUTION.md):
#   1. .planning/profile.yaml      (project override)
#   2. .riff/profile.yaml          (framework default via symlink)
# If neither exists or notifications.channel is missing, defaults to telegram for
# backwards compatibility with pre-channel installs.
#
# Channels:
#   telegram  → POST to the n8n Telegram webhook (current behavior)
#   slack     → POST to notifications.slack_webhook (skipped + warned if missing)
#   email     → send via gws gmail or system mail (skipped + warned if missing)
#   none      → exit 0 silently
#
# Skip + warn means: print a one-line warning to stderr, return 0. Never fail the
# calling phase over a misconfigured notification channel.

set -o pipefail

MESSAGE="$1"
if [ -z "$MESSAGE" ]; then exit 0; fi

# Resolve profile path
PROFILE=""
if [ -f ".planning/profile.yaml" ]; then
  PROFILE=".planning/profile.yaml"
elif [ -f ".riff/profile.yaml" ]; then
  PROFILE=".riff/profile.yaml"
fi

# Extract a top-level-section scalar. Usage: extract <section> <key>
# Reads only lines under "<section>:" until the next non-indented line.
extract() {
  local section="$1" key="$2"
  [ -z "$PROFILE" ] && return 0
  awk -v s="^${section}:" -v k="^[[:space:]]+${key}:" '
    $0 ~ s          { in_s=1; next }
    in_s && /^[^[:space:]]/ { in_s=0 }
    in_s && $0 ~ k  { sub(/^[^:]+:[[:space:]]*/, ""); gsub(/[[:space:]"]/, ""); print; exit }
  ' "$PROFILE"
}

CHANNEL=$(extract notifications channel)
CHANNEL=${CHANNEL:-telegram}

warn() {
  echo "notify-human: $1" >&2
  exit 0
}

# JSON-escape a string for safe embedding in a JSON body.
json_escape() {
  printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null \
    || printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g; s/\r/\\r/g' | awk 'BEGIN{ORS="\\n"} {print}' | sed 's/\\n$//')"
}

case "$CHANNEL" in
  none)
    exit 0
    ;;

  telegram)
    curl -s -X POST "https://n8n.cutzai.com/webhook/claude-telegram-alert" \
      -H "Content-Type: application/json" \
      -d "{\"message\": $(json_escape "$MESSAGE")}" \
      > /dev/null 2>&1
    exit 0
    ;;

  slack)
    WEBHOOK=$(extract notifications slack_webhook)
    [ -z "$WEBHOOK" ] && warn "channel=slack but notifications.slack_webhook is unset, skipping"
    curl -s -X POST "$WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"text\": $(json_escape "$MESSAGE")}" \
      > /dev/null 2>&1
    exit 0
    ;;

  email)
    TO=$(extract notifications email_to)
    [ -z "$TO" ] && warn "channel=email but notifications.email_to is unset, skipping"
    SUBJECT="RIFF: human attention needed"

    if command -v gws >/dev/null 2>&1; then
      RAW=$(printf 'To: %s\nSubject: %s\nContent-Type: text/plain; charset=UTF-8\n\n%s' \
        "$TO" "$SUBJECT" "$MESSAGE" \
        | base64 | tr '+/' '-_' | tr -d '=\n')
      gws gmail users messages send \
        --params '{"userId":"me"}' \
        --json "{\"raw\":\"$RAW\"}" \
        > /dev/null 2>&1
      exit 0
    fi

    if command -v mail >/dev/null 2>&1; then
      printf '%s\n' "$MESSAGE" | mail -s "$SUBJECT" "$TO" > /dev/null 2>&1
      exit 0
    fi

    warn "channel=email but neither gws nor mail is available on PATH, skipping"
    ;;

  *)
    warn "unknown channel '$CHANNEL' in notifications.channel, skipping"
    ;;
esac

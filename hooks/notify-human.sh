#!/bin/bash
# RIFF Human Notification - dispatches to the channel set in profile.yaml.
# Usage: bash notify-human.sh "Your message here"
#
# Resolution order for profile.yaml (per references/PROFILE-RESOLUTION.md):
#   1. .planning/profile.yaml      (project override)
#   2. .riff/profile.yaml          (framework default via symlink)
#
# Channels:
#   telegram → POST to api.telegram.org/bot<TOKEN>/sendMessage
#              requires notifications.telegram_bot_token + notifications.telegram_chat_id
#              See hooks/README.md § Telegram setup for how to create a bot and get these values.
#   email    → gws gmail (if available) or system mail; requires notifications.email_to
#   none     → exit 0 silently
#
# Skip + warn (one-line stderr, exit 0) when a required sub-field is missing,
# the chosen transport is unavailable, the channel value is unknown, or the
# channel field itself is missing. notify-human never fails the calling phase.

set -o pipefail

MESSAGE="$1"
[ -z "$MESSAGE" ] && exit 0

PROFILE=""
[ -f ".planning/profile.yaml" ] && PROFILE=".planning/profile.yaml"
[ -z "$PROFILE" ] && [ -f ".riff/profile.yaml" ] && PROFILE=".riff/profile.yaml"

# Extract a section.key scalar. Reads only lines under "<section>:" until the
# next non-indented line.
extract() {
  local section="$1" key="$2"
  [ -z "$PROFILE" ] && return 0
  awk -v s="^${section}:" -v k="^[[:space:]]+${key}:" '
    $0 ~ s          { in_s=1; next }
    in_s && /^[^[:space:]]/ { in_s=0 }
    in_s && $0 ~ k  { sub(/^[^:]+:[[:space:]]*/, ""); gsub(/[[:space:]"]/, ""); print; exit }
  ' "$PROFILE"
}

warn() {
  echo "notify-human: $1" >&2
  exit 0
}

CHANNEL=$(extract notifications channel)
[ -z "$CHANNEL" ] && warn "notifications.channel unset, no notification sent"

case "$CHANNEL" in
  none)
    exit 0
    ;;

  telegram)
    TOKEN=$(extract notifications telegram_bot_token)
    CHAT=$(extract notifications telegram_chat_id)
    [ -z "$TOKEN" ] && warn "channel=telegram but notifications.telegram_bot_token is unset (see hooks/README.md § Telegram setup)"
    [ -z "$CHAT" ] && warn "channel=telegram but notifications.telegram_chat_id is unset (see hooks/README.md § Telegram setup)"
    curl -s -X POST "https://api.telegram.org/bot${TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${CHAT}" \
      --data-urlencode "text=${MESSAGE}" \
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

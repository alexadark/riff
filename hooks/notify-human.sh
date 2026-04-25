#!/bin/bash
# RIFF Human Notification - sends Telegram alert via n8n
# Usage: bash notify-human.sh "Your message here"

MESSAGE="$1"
if [ -z "$MESSAGE" ]; then exit 0; fi

curl -s -X POST "https://n8n.cutzai.com/webhook/claude-telegram-alert" \
  -H "Content-Type: application/json" \
  -d "{\"message\": \"$MESSAGE\"}" \
  > /dev/null 2>&1

exit 0

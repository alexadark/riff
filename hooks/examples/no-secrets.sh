#!/usr/bin/env bash
set -euo pipefail

ROOT="${RIFF_REPO_ROOT:-$(pwd)}"

if command -v rg >/dev/null 2>&1; then
  if rg -n --hidden --glob '!node_modules' --glob '!.git' --glob '!.riff-private' \
    '(api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["'\''][^"'\'']{12,}' "$ROOT" >/tmp/riff-no-secrets.txt; then
    cat /tmp/riff-no-secrets.txt
    exit 1
  fi
fi

printf 'no hardcoded secret patterns found\n'
exit 0

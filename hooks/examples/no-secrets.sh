#!/usr/bin/env bash
set -euo pipefail

ROOT="${RIFF_REPO_ROOT:-$(pwd)}"

if ! command -v rg >/dev/null 2>&1; then
  printf 'rg not found; no-secrets scan skipped\n'
  exit 2
fi

if rg -in --hidden --glob '!node_modules' --glob '!.git' --glob '!.riff-private' \
  '(api[_-]?key|secret|token|password|private[_-]?key)\s*[:=]\s*["'\''][^"'\'']{12,}' "$ROOT" \
  | rg -v '123456:ABC-DEF|YOUR_|your_|example|placeholder|<[^>]+>|["'\'']\$\{?[A-Za-z_]'; then
  exit 1
fi

printf 'no hardcoded secret patterns found\n'
exit 0

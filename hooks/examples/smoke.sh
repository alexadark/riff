#!/usr/bin/env bash
set -euo pipefail

PHASE_DIR="${RIFF_PHASE_DIR:?RIFF_PHASE_DIR is required}"
SUMMARY="$PHASE_DIR/SUMMARY.md"

if [ ! -f "$SUMMARY" ]; then
  printf 'SUMMARY.md missing; smoke evidence is pending\n'
  exit 2
fi

if ! rg -n "Smoke|Smoke Results|exit code|exit 0|pass" "$SUMMARY" >/dev/null 2>&1; then
  printf 'SUMMARY.md exists but no smoke evidence was found\n'
  exit 1
fi

printf 'smoke evidence found in %s\n' "$SUMMARY"
exit 0

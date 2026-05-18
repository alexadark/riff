#!/usr/bin/env bash
set -euo pipefail

PHASE_DIR="${RIFF_PHASE_DIR:?RIFF_PHASE_DIR is required}"
SUMMARY="$PHASE_DIR/SUMMARY.md"
GATES="$PHASE_DIR/GATES.md"

if [ -f "$SUMMARY" ] && rg -n "docs|documentation|README|operator|workflow|API|CLI" "$SUMMARY" >/dev/null 2>&1; then
  printf 'documentation evidence found in SUMMARY.md\n'
  exit 0
fi

if [ -f "$GATES" ] && rg -n "docs-check.*(pass|skipped|warn)" "$GATES" >/dev/null 2>&1; then
  printf 'documentation gate evidence found in GATES.md\n'
  exit 0
fi

printf 'documentation evidence not found; mark docs-check explicitly when applicable\n'
exit 2

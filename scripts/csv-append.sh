#!/bin/bash
# RIFF CSV append helper
# Atomic CSV row append via flock + sidecar lockfile.
# Falls back to bare append if flock is not installed.
#
# Usage:
#   bash .riff/scripts/csv-append.sh <csv-file> <row>
#
# This is a standalone executable script (NOT sourced). The shebang ensures
# bash parses the fd-redirection syntax even when the caller is zsh.
#
# The lockfile sidecar is `<file>.lock`. Both the data file and the lockfile
# are covered by the project-level `.planning/` gitignore rule.

set -euo pipefail

if [ $# -ne 2 ]; then
  echo "Usage: $0 <csv-file> <row>" >&2
  exit 2
fi

file="$1"
row="$2"

if command -v flock >/dev/null 2>&1; then
  (
    flock -x 200
    printf '%s\n' "$row" >> "$file"
  ) 200>"$file.lock"
else
  # flock unavailable (macOS without util-linux): best-effort append.
  # Multi-process concurrent appends may interleave on APFS.
  printf '%s\n' "$row" >> "$file"
fi

#!/bin/bash
# validate-roadmap.sh
# Lightweight schema check for ROADMAP.yaml.
#
# Usage:
#   validate-roadmap.sh <path-to-ROADMAP.yaml>
#
# Verifies that every entry under `phases:` has the required fields:
#   - id    (numeric, integer or decimal)
#   - slug  (kebab-case, lowercase letters/digits/hyphens, starts with letter/digit)
#   - title (any non-empty string)
#   - status (one of: todo | in-progress | done | blocked | skipped)
#
# Forbids the deprecated phase-level `name:` key. Reports a clear error when
# a phase still uses `name:` instead of `title:`. The roadmap-level (top-of-file)
# `name:` is allowed and ignored by this check.
#
# Pure bash, no yq or gawk dependency. Operates line-by-line with a tiny state
# machine: a phase begins on `- id:` and ends at the next `- id:` or EOF. Any
# violation is printed with file:line context and the script exits 1.
#
# Exit codes:
#   0 — all phases valid
#   1 — at least one validation error
#   2 — usage error (missing arg, file not found)

set -o pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <path-to-ROADMAP.yaml>" >&2
  exit 2
fi

roadmap="$1"

if [ ! -f "$roadmap" ]; then
  echo "[validate-roadmap] file not found: $roadmap" >&2
  exit 2
fi

errors=()

in_phases_block=0
in_phase=0
phase_start_line=0
fields_indent=-1

cur_id=""
cur_slug=""
cur_title=""
cur_status=""
cur_has_name=0
cur_name_line=0

valid_status_re='^(todo|in-progress|done|blocked|skipped)$'
slug_re='^[a-z0-9][a-z0-9-]*$'

strip_value() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  v="${v%%#*}"
  v="${v%"${v##*[![:space:]]}"}"
  if [[ "$v" =~ ^\"(.*)\"$ ]]; then v="${BASH_REMATCH[1]}"; fi
  if [[ "$v" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
  printf '%s' "$v"
}

flush_phase() {
  if [[ "$in_phase" -eq 0 ]]; then return; fi
  local id_label="${cur_id:-(unknown)}"
  if [[ -z "$cur_id" ]]; then
    errors+=("$roadmap:$phase_start_line: phase missing required field \`id\`")
  fi
  if [[ -z "$cur_slug" ]]; then
    errors+=("$roadmap:$phase_start_line: phase $id_label missing required field \`slug\`")
  elif [[ ! "$cur_slug" =~ $slug_re ]]; then
    errors+=("$roadmap:$phase_start_line: phase $id_label slug \`$cur_slug\` is not kebab-case (lowercase letters/digits/hyphens, starts with letter/digit)")
  fi
  if [[ -z "$cur_title" ]]; then
    errors+=("$roadmap:$phase_start_line: phase $id_label missing required field \`title\`")
  fi
  if [[ -z "$cur_status" ]]; then
    errors+=("$roadmap:$phase_start_line: phase $id_label missing required field \`status\`")
  elif [[ ! "$cur_status" =~ $valid_status_re ]]; then
    errors+=("$roadmap:$phase_start_line: phase $id_label status \`$cur_status\` is not one of: todo | in-progress | done | blocked | skipped")
  fi
  if [[ "$cur_has_name" -eq 1 ]]; then
    errors+=("$roadmap:$cur_name_line: phase $id_label uses deprecated phase-level \`name:\` field, use \`title:\` instead")
  fi
}

reset_phase() {
  in_phase=0
  cur_id=""; cur_slug=""; cur_title=""; cur_status=""
  cur_has_name=0; cur_name_line=0
  phase_start_line=0
}

line_no=0
while IFS='' read -r line || [[ -n "$line" ]]; do
  line_no=$((line_no + 1))
  # Skip blank lines and full-line comments.
  if [[ "$line" =~ ^[[:space:]]*$ ]]; then continue; fi
  if [[ "$line" =~ ^[[:space:]]*# ]]; then continue; fi

  # Detect `phases:` block opening.
  if [[ "$line" =~ ^phases:[[:space:]]*$ ]]; then
    in_phases_block=1
    continue
  fi

  # Top-level key (no leading whitespace, alpha/underscore start) closes the phases block.
  if [[ "$line" =~ ^[A-Za-z_] ]]; then
    if [[ "$in_phases_block" -eq 1 ]]; then
      flush_phase
      reset_phase
      in_phases_block=0
    fi
    continue
  fi

  if [[ "$in_phases_block" -ne 1 ]]; then continue; fi

  # New phase entry: `^( *)-[[:space:]]+id:[[:space:]]*(.*)`
  if [[ "$line" =~ ^([[:space:]]*)-[[:space:]]+id:[[:space:]]*(.*)$ ]]; then
    # Capture BASH_REMATCH first; flush_phase calls strip_value which
    # runs more regex matches and clobbers BASH_REMATCH.
    new_indent=${#BASH_REMATCH[1]}
    new_id_raw="${BASH_REMATCH[2]}"
    flush_phase
    reset_phase
    in_phase=1
    phase_start_line=$line_no
    fields_indent=$((new_indent + 2))
    cur_id="$(strip_value "$new_id_raw")"
    continue
  fi

  if [[ "$in_phase" -ne 1 ]]; then continue; fi

  # Field line at the expected indent.
  if [[ "$line" =~ ^([[:space:]]+)([A-Za-z_]+):[[:space:]]*(.*)$ ]]; then
    indent=${#BASH_REMATCH[1]}
    key="${BASH_REMATCH[2]}"
    raw_val="${BASH_REMATCH[3]}"
    if [[ "$indent" -eq "$fields_indent" ]]; then
      val="$(strip_value "$raw_val")"
      case "$key" in
        slug)   cur_slug="$val" ;;
        title)  cur_title="$val" ;;
        status) cur_status="$val" ;;
        name)   cur_has_name=1; cur_name_line=$line_no ;;
      esac
    fi
  fi
done < "$roadmap"

flush_phase

if [[ "${#errors[@]}" -eq 0 ]]; then
  echo "[validate-roadmap] OK: $roadmap"
  exit 0
fi

echo "[validate-roadmap] FAIL: $roadmap" >&2
for e in "${errors[@]}"; do
  echo "  $e" >&2
done
exit 1

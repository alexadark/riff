#!/bin/bash
# validate-roadmap.sh
# Lightweight schema check for ROADMAP.yaml.
#
# Usage:
#   validate-roadmap.sh <path-to-ROADMAP.yaml>
#
# Supports the two roadmap formats in the wild:
#
# List format (current) — entries under a top-level `phases:` list. Every
# entry must have:
#   - id    (numeric, integer or decimal)
#   - slug  (kebab-case, lowercase letters/digits/hyphens, starts with letter/digit)
#   - title (any non-empty string)
#   - status (one of: todo | in-progress | done | blocked | skipped)
# Forbids the deprecated phase-level `name:` key. Reports a clear error when
# a phase still uses `name:` instead of `title:`. The roadmap-level (top-of-file)
# `name:` is allowed and ignored by this check.
#
# Mapping format (legacy, e.g. ai-interviewer) — top-level `phase-<id>:` keys.
# Detected when any line matches `^phase-<number>:`. Every phase must have:
#   - name   (any non-empty string; this format uses `name:`, not `title:`)
#   - status (one of: todo | in-progress | done | complete | blocked | skipped)
# The id comes from the key and must be numeric. No slug in this format.
# `depends_on` cross-reference, duplicate-id and cycle checks apply to both.
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
cur_depends_on=()
cur_has_name=0
cur_name_line=0

phase_count=0
seen_ids=()
seen_id_lines=()
edge_from=()
edge_to=()

valid_status_re='^(todo|in-progress|done|blocked|skipped)$'
slug_re='^[a-z0-9][a-z0-9-]*$'

strip_value() {
  local v="$1"
  v="${v#"${v%%[![:space:]]*}"}"
  # Cut the inline comment at its FIRST ` #` (greedy regex would cut at the
  # last one and mangle values like `done # merged (PR #41)`).
  v="${v%%" #"*}"
  v="${v%%$'\t#'*}"
  v="${v%"${v##*[![:space:]]}"}"
  if [[ "$v" =~ ^\"(.*)\"$ ]]; then v="${BASH_REMATCH[1]}"; fi
  if [[ "$v" =~ ^\'(.*)\'$ ]]; then v="${BASH_REMATCH[1]}"; fi
  printf '%s' "$v"
}

id_re='^[0-9]+(\.[0-9]+)?$'

parse_depends_on() {
  local raw="$1"
  local v dep
  v="$(strip_value "$raw")"
  v="${v#[}"
  v="${v%]}"
  v="${v//\"/}"
  v="${v//\'/}"
  v="${v//,/ }"
  for dep in $v; do
    [ -n "$dep" ] && cur_depends_on+=("$dep")
  done
}

id_seen_index() {
  local needle="$1"
  local i
  for i in "${!seen_ids[@]}"; do
    if [[ "${seen_ids[$i]}" == "$needle" ]]; then
      printf '%s' "$i"
      return 0
    fi
  done
  return 1
}

flush_phase() {
  if [[ "$in_phase" -eq 0 ]]; then return; fi
  local id_label="${cur_id:-(unknown)}"
  if [[ -z "$cur_id" ]]; then
    errors+=("$roadmap:$phase_start_line: phase missing required field \`id\`")
  elif [[ ! "$cur_id" =~ $id_re ]]; then
    errors+=("$roadmap:$phase_start_line: phase id \`$cur_id\` must be numeric (integer or decimal)")
  else
    local existing_index
    existing_index="$(id_seen_index "$cur_id" || true)"
    if [[ -n "$existing_index" ]]; then
      errors+=("$roadmap:$phase_start_line: duplicate phase id \`$cur_id\` (first seen at line ${seen_id_lines[$existing_index]})")
    fi
    seen_ids+=("$cur_id")
    seen_id_lines+=("$phase_start_line")
    phase_count=$((phase_count + 1))
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
  local dep
  for dep in "${cur_depends_on[@]}"; do
    edge_from+=("$cur_id")
    edge_to+=("$dep")
  done
}

reset_phase() {
  in_phase=0
  cur_id=""; cur_slug=""; cur_title=""; cur_status=""
  cur_depends_on=()
  cur_has_name=0; cur_name_line=0
  phase_start_line=0
}

legacy_status_re='^(todo|in-progress|done|complete|blocked|skipped)$'

flush_legacy_phase() {
  if [[ "$in_phase" -eq 0 ]]; then return; fi
  local id_label="phase-$cur_id"
  local existing_index
  existing_index="$(id_seen_index "$cur_id" || true)"
  if [[ -n "$existing_index" ]]; then
    errors+=("$roadmap:$phase_start_line: duplicate phase id \`$cur_id\` (first seen at line ${seen_id_lines[$existing_index]})")
  fi
  seen_ids+=("$cur_id")
  seen_id_lines+=("$phase_start_line")
  phase_count=$((phase_count + 1))
  if [[ -z "$cur_title" ]]; then
    errors+=("$roadmap:$phase_start_line: $id_label missing required field \`name\`")
  fi
  if [[ -z "$cur_status" ]]; then
    errors+=("$roadmap:$phase_start_line: $id_label missing required field \`status\`")
  elif [[ ! "$cur_status" =~ $legacy_status_re ]]; then
    errors+=("$roadmap:$phase_start_line: $id_label status \`$cur_status\` is not one of: todo | in-progress | done | complete | blocked | skipped")
  fi
  local dep
  for dep in "${cur_depends_on[@]}"; do
    edge_from+=("$cur_id")
    edge_to+=("$dep")
  done
}

format=list
if grep -qE '^phase-[0-9]+(\.[0-9]+)?:' "$roadmap"; then format=legacy; fi

if [[ "$format" == "legacy" ]]; then

line_no=0
while IFS='' read -r line || [[ -n "$line" ]]; do
  line_no=$((line_no + 1))
  if [[ "$line" =~ ^[[:space:]]*$ ]]; then continue; fi
  if [[ "$line" =~ ^[[:space:]]*# ]]; then continue; fi

  # New phase entry: `^phase-<id>:`
  if [[ "$line" =~ ^phase-([0-9]+(\.[0-9]+)?):[[:space:]]*(#.*)?$ ]]; then
    new_id="${BASH_REMATCH[1]}"
    flush_legacy_phase
    reset_phase
    in_phase=1
    phase_start_line=$line_no
    cur_id="$new_id"
    continue
  fi

  # Any other top-level key (parking-lot:, etc.) closes the current phase.
  if [[ "$line" =~ ^[A-Za-z_] ]]; then
    flush_legacy_phase
    reset_phase
    continue
  fi

  if [[ "$in_phase" -ne 1 ]]; then continue; fi

  # Field line at the phase field indent (2 spaces).
  if [[ "$line" =~ ^([[:space:]]+)([A-Za-z_]+):[[:space:]]*(.*)$ ]]; then
    indent=${#BASH_REMATCH[1]}
    key="${BASH_REMATCH[2]}"
    raw_val="${BASH_REMATCH[3]}"
    if [[ "$indent" -eq 2 ]]; then
      val="$(strip_value "$raw_val")"
      case "$key" in
        name)   cur_title="$val" ;;
        status) cur_status="$val" ;;
        depends_on) parse_depends_on "$raw_val" ;;
      esac
    fi
  fi
done < "$roadmap"

flush_legacy_phase

else

line_no=0
while IFS='' read -r line || [[ -n "$line" ]]; do
  line_no=$((line_no + 1))
  # Skip blank lines and full-line comments.
  if [[ "$line" =~ ^[[:space:]]*$ ]]; then continue; fi
  if [[ "$line" =~ ^[[:space:]]*# ]]; then continue; fi

  # Detect `phases:` block opening.
  if [[ "$line" =~ ^phases:[[:space:]]*\[[[:space:]]*\][[:space:]]*(#.*)?$ ]]; then
    errors+=("$roadmap:$line_no: \`phases\` must contain at least one phase")
    in_phases_block=0
    continue
  fi

  if [[ "$line" =~ ^phases:[[:space:]]*(#.*)?$ ]]; then
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
        depends_on) parse_depends_on "$raw_val" ;;
        name)   cur_has_name=1; cur_name_line=$line_no ;;
      esac
    fi
  fi
done < "$roadmap"

flush_phase

fi

if [[ "$phase_count" -eq 0 ]]; then
  errors+=("$roadmap:1: \`phases\` must contain at least one phase")
fi

for i in "${!edge_from[@]}"; do
  from="${edge_from[$i]}"
  to="${edge_to[$i]}"
  if [[ -z "$to" ]]; then
    continue
  fi
  if [[ ! "$to" =~ $id_re ]]; then
    errors+=("$roadmap:1: phase $from depends_on \`$to\` but dependency ids must be numeric (integer or decimal)")
    continue
  fi
  if ! id_seen_index "$to" >/dev/null; then
    errors+=("$roadmap:1: phase $from depends_on missing phase id \`$to\`")
  fi
  if [[ "$from" == "$to" ]]; then
    errors+=("$roadmap:1: phase $from cannot depend on itself")
  fi
  for j in "${!edge_from[@]}"; do
    if [[ "${edge_from[$j]}" == "$to" && "${edge_to[$j]}" == "$from" ]]; then
      errors+=("$roadmap:1: direct dependency cycle detected: $from <-> $to")
    fi
  done
done

if [[ "${#errors[@]}" -eq 0 ]]; then
  echo "[validate-roadmap] OK: $roadmap"
  exit 0
fi

echo "[validate-roadmap] FAIL: $roadmap" >&2
for e in "${errors[@]}"; do
  echo "  $e" >&2
done
exit 1

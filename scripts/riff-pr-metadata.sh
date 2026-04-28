#!/usr/bin/env bash
# Generates the "Generation metadata" section appended to RIFF PR descriptions.
# Reads tracked artifacts only (PLAN.md, SUMMARY.md, GATES.md, ROADMAP.yaml, codex-usage.csv,
# git timestamps, commit trailers). Never writes Claude estimates.
#
# Usage: scripts/riff-pr-metadata.sh <phase-id>
# Example: scripts/riff-pr-metadata.sh 96.7
#
# Output: markdown section on stdout. Append to PR body via:
#   body=$(cat summary.md)$'\n'$(scripts/riff-pr-metadata.sh 96.7)
#   gh pr create --body "$body"

set -euo pipefail

phase_id="${1:-}"
if [[ -z "$phase_id" ]]; then
	echo "Usage: $0 <phase-id>" >&2
	exit 1
fi

phase_dir=$(find .planning/phases -maxdepth 1 -type d -name "${phase_id}-*" 2>/dev/null | head -1)
if [[ -z "$phase_dir" ]]; then
	echo "Phase folder not found for id $phase_id under .planning/phases/" >&2
	exit 1
fi

phase_slug=$(basename "$phase_dir")
plan="$phase_dir/PLAN.md"
summary="$phase_dir/SUMMARY.md"
gates="$phase_dir/GATES.md"
codex_csv=".planning/codex-usage.csv"
roadmap="ROADMAP.yaml"

get_yaml_field() {
	local field="$1"
	[[ ! -f "$roadmap" ]] && return
	awk -v id="$phase_id" -v field="$field" '
		/^[[:space:]]*-[[:space:]]+id:[[:space:]]*/ {
			val=$0; sub(/^[[:space:]]*-[[:space:]]+id:[[:space:]]*/, "", val); gsub(/[\"'\'' ]/, "", val)
			in_phase = (val == id) ? 1 : 0
			next
		}
		in_phase && $0 ~ "^[[:space:]]+" field ":" {
			val=$0; sub(/^[[:space:]]+[^:]+:[[:space:]]*/, "", val); gsub(/[\"'\'']/, "", val)
			print val
			exit
		}
	' "$roadmap"
}

executor_model=$(get_yaml_field "executor_model" || true)
[[ -z "$executor_model" ]] && executor_model="sonnet"

codex_model=$(get_yaml_field "codex_model" || true)
[[ -z "$codex_model" ]] && codex_model="gpt-5.5"

codex_effort=$(get_yaml_field "codex_effort" || true)
[[ -z "$codex_effort" ]] && codex_effort="medium"

debug_model=$(get_yaml_field "debug_model" || true)
[[ -z "$debug_model" ]] && debug_model="opus"

commits_count=$(git rev-list --count main..HEAD 2>/dev/null || echo "0")
files_changed=$(git diff --name-only main...HEAD 2>/dev/null | wc -l | tr -d ' ')

first_ts=$(git log --format=%aI main..HEAD --reverse 2>/dev/null | head -1 || true)
last_ts=$(git log --format=%aI main..HEAD 2>/dev/null | head -1 || true)

duration_str="n/a"
if [[ -n "$first_ts" && -n "$last_ts" ]]; then
	if [[ "$(uname)" == "Darwin" ]]; then
		first_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${first_ts:0:19}" +%s 2>/dev/null || echo 0)
		last_epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${last_ts:0:19}" +%s 2>/dev/null || echo 0)
	else
		first_epoch=$(date -d "$first_ts" +%s 2>/dev/null || echo 0)
		last_epoch=$(date -d "$last_ts" +%s 2>/dev/null || echo 0)
	fi
	if [[ "$first_epoch" -gt 0 && "$last_epoch" -gt 0 && "$last_epoch" -ge "$first_epoch" ]]; then
		diff_sec=$((last_epoch - first_epoch))
		if [[ $diff_sec -lt 60 ]]; then
			duration_str="${diff_sec}s"
		elif [[ $diff_sec -lt 3600 ]]; then
			duration_str="$((diff_sec / 60))m"
		elif [[ $diff_sec -lt 86400 ]]; then
			duration_str="$((diff_sec / 3600))h$(((diff_sec % 3600) / 60))m"
		else
			duration_str="$((diff_sec / 86400))d$(((diff_sec % 86400) / 3600))h"
		fi
		duration_str="$duration_str (first $first_ts, last $last_ts)"
	fi
fi

gates_block="(no gate log)"
if [[ -f "$gates" ]]; then
	matched=$(grep -E "^Step [0-9]+[a-z]?:" "$gates" 2>/dev/null | sed 's/^/- /' || true)
	[[ -n "$matched" ]] && gates_block="$matched"
fi

codex_calls=0
codex_total_sec=0
if [[ -f "$codex_csv" ]]; then
	read -r codex_calls codex_total_sec < <(awk -F, -v p="$phase_id" '
		NR == 1 && $1 == "timestamp" { next }
		$2 == p { count++; total += $7 }
		END { print (count+0), (total+0) }
	' "$codex_csv")
fi

trailer_agents="(no RIFF trailers found in commits)"
if [[ "$commits_count" -gt 0 ]]; then
	matched=$(git log main..HEAD --pretty=format:%B 2>/dev/null | awk '
		/^Agent:/ { agent=$2 }
		/^Model:/ { model=$2; if (agent != "") print agent ":" model; agent=""; model="" }
	' | sort -u | sed 's/^/- /' || true)
	[[ -n "$matched" ]] && trailer_agents="$matched"
fi

cat <<EOF

---

## Generation metadata (RIFF)

**Phase**: $phase_id
**Slug**: $phase_slug
**Plan**: \`$plan\`
**Summary**: \`$summary\`

**Agents per step** (resolved from ROADMAP.yaml + RIFF defaults):

| Step | Agent | Model |
|---|---|---|
| Plan | planner | opus |
| Plan adversarial review | plan-adversarial-reviewer | $codex_model (Codex, effort=$codex_effort) |
| Execute | executor | $executor_model |
| Simplify | simplifier | haiku |
| Scope check | scope-checker | haiku |
| Code review | adversarial-reviewer | $codex_model (Codex, effort=$codex_effort) |
| Security review | security-reviewer | sonnet |
| Debugger (on failure) | debugger | $debug_model |

**Stats**: $commits_count commits · $files_changed files
**Duration**: $duration_str

**Gates** (from \`$gates\`):
$gates_block

**Codex usage (this phase)**: $codex_calls calls, ${codex_total_sec}s total

**Agents observed in commit trailers**:
$trailer_agents
EOF

#!/bin/bash

# compaction-checkpoint.sh
# RIFF PreCompact hook.
# Writes a minimal checkpoint to STATE.md before context compaction,
# so the compacted session can resume without losing phase progress.

PROJECT_ROOT="${PWD}"
STATE_FILE="$PROJECT_ROOT/STATE.md"
PLANNING_DIR="$PROJECT_ROOT/.planning"

# Only fire if this is a RIFF project (has .planning/)
[ -d "$PLANNING_DIR" ] || exit 0

# Find active phase from STATE.md or ROADMAP
ACTIVE_PHASE=""
if [ -f "$STATE_FILE" ]; then
  ACTIVE_PHASE=$(grep -E "^\*\*Phase\*\*|^- \*\*Phase\*\*" "$STATE_FILE" 2>/dev/null | head -1 | sed 's/.*: *//')
fi

# If no active phase detected, nothing to checkpoint
[ -z "$ACTIVE_PHASE" ] && exit 0

# Build checkpoint block
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
LAST_COMMIT=$(git log -1 --oneline 2>/dev/null || echo "no commits")
TOOL_COUNT="${CLAUDE_TOOL_USE_COUNT:-unknown}"

cat << CHECKPOINT
RIFF compaction checkpoint ($TIMESTAMP):

- **Phase**: $ACTIVE_PHASE
- **Branch**: $BRANCH
- **Last commit**: $LAST_COMMIT
- **Tool calls before compaction**: $TOOL_COUNT
- **Resume**: Read STATE.md, then continue the current /riff:next step.
- **Files to re-read**: PLAN.md for this phase, SUMMARY.md if it exists, any in-progress artifact.

If STATE.md has a Resume Command, use it. If not, run /riff:status to orient.
CHECKPOINT

exit 0

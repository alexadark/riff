---
description: Ad-hoc task execution without phase overhead
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
args: "<task description>"
---

# /riff:quick

For small tasks (1-3 files, no architectural decisions). Same quality, zero phase overhead.

## What You Do

1. **Assess:** Is this actually quick? If 5+ files, new data model, or auth changes → tell user to add as phase.
2. **Confidence gate** (fast) — see `protocols/EXECUTION.md` § Confidence Gate. If unclear, ask ONE question.
3. **Assumptions:** State intent in 2-3 bullets with confidence levels. If user says "just do it": proceed.
4. **Execute:** Read files, make changes, follow taste.md + code quality rules.
5. **Verify:** Run tests for modified files, verify change works, quick security check.
6. **Commit:** Stage explicitly, conventional message. No `riff` or phase numbers.
7. **Log:** Write `.planning/quick/quick-NNNN.md` with date, files, what was done.

## Anti-Patterns

- Don't use for tasks that should be phases
- Don't skip confidence gate or verification
- Don't combine unrelated changes

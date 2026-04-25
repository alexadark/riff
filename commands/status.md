---
description: Show current project status and next action
allowed-tools: Read, Glob, Bash
---

# /riff:status

Quick dashboard: where am I, what's done, what's next, any blockers.

## What You Do

Read: STATE.md, ROADMAP.yaml. Check: pending taste rules (`<!-- PENDING -->`), seeds in `.planning/seeds/`, pending expertise in `.planning/expertise/.pending/`.

## Output

```
# RIFF Status - {{PROJECT_NAME}}

## Progress
{{done}}/{{total}} phases ({{%}})

| Phase | Title | Status | Priority | Mode |
|-------|-------|--------|----------|------|

## Current
Phase {{N}}: {{TITLE}} - {{STATUS}} {{BLOCKER if any}}

## Next Action
{{one recommendation: /riff:next, fix failures, HITL review, /riff:check, or blocked}}

## Pending Reviews
- expertise: {{N}} patches by agent across {{K}} phases — run /riff:review-expertise to route them to stack/architecture/project tiers
- seeds: {{N}} deferred ideas ({{M}} triggers met)

## Recent Deviations
{{R1-R4 from last SUMMARY.md}}
```

## Pending-expertise surfacing rule

If `.planning/expertise/.pending/` has ANY file, the "Pending Reviews" line for expertise MUST be rendered prominently (bold or with a 🔔 marker) and a one-line recommendation added to "Next Action": "Review {{N}} pending expertise patches before the next phase — they may contain rules that affect upcoming work."

Rationale: pending patches that sit unreviewed for multiple phases mean later phases repeat the same mistakes. Surface early, not when the backlog is painful.

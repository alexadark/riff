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
{{one recommendation: /riff:next, fix failures, HITL review, ask Claude to re-audit, or blocked}}

## Pending Reviews
- expertise: {{N}} patches by agent across {{K}} phases — will be offered at the end of next /riff:next phase (or ask Claude to review now)
- seeds: {{N}} deferred ideas ({{M}} triggers met)

## Recent Deviations
{{R1-R4 from last SUMMARY.md}}
```

## Pending-expertise surfacing rule

If `.planning/expertise/.pending/` has ANY file, render the expertise line in "Pending Reviews" prominently (bold or with a 🔔 marker). The end-of-phase flow in `/riff:next` Step 10 will offer Review now / Defer / Reject all at the next phase boundary, so this is informational, not a call to a separate command.

Rationale: pending patches that sit unreviewed for multiple phases mean later phases repeat the same mistakes. Surfacing keeps the user aware between phases.

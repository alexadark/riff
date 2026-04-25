---
description: Run multiple phases autonomously (Ralph loop)
allowed-tools: Bash, Read
args: "[N]"
---

# /riff:loop

Launch autonomous phase execution. Each phase runs in a fresh Claude Code context via `/riff:next`.

## Arguments

- No args: run all remaining AFK phases (max 20)
- `[N]`: run exactly N phases

## What You Do

1. Check: `riff-loop.sh` exists, ROADMAP.yaml exists, `.planning/` exists
2. Launch: `./riff-loop.sh -n {{N}}`

The loop handles: reading ROADMAP, spawning fresh agents, atomic commits, Telegram notifications, stop conditions.

## Stop Conditions

| Condition               | Action                                    |
| ----------------------- | ----------------------------------------- |
| Verification FAIL       | Stop, write LOOP_STOP to STATE.md, notify |
| R3 deviation            | Stop, architecture decision needs human   |
| Security CRITICAL/HIGH  | Stop, needs human                         |
| All phases done         | Stop, notify "BUILD COMPLETE"             |
| Only HITL phases remain | Stop, human presence required             |
| All remaining blocked   | Stop, human intervention needed           |
| Iteration limit         | Stop (safety)                             |

## Anti-Patterns

- Don't run on HITL phases (loop skips them automatically)
- Don't run without ROADMAP.yaml
- Don't run if STATE.md has LOOP_STOP — fix the issue first

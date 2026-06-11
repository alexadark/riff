---
description: Ad-hoc debug on the current RIFF project, outside the auto-trigger pipeline flow
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
args: "<bug description>"
---

# /riff:debug

Ad-hoc debug for bugs outside the pipeline auto-trigger flow (manual spotting, runtime issues, post-merge regressions). Pipeline-triggered debugging fires automatically — see `commands/next.md` § Auto-debug pattern.

## Step 1: Quick triage (inline)

Typo / missing import / explicit "X is not defined" with a clear file + line? Fix directly without spawning a sub-agent. Log a one-liner in `.planning/debug/` and stop.

Else → Step 2.

## Step 2: Check for existing session (inline)

```bash
ls .planning/debug/
```

If a session file exists for the same issue: note its path — you will pass it to the debugger.

## Step 3: Spawn debugger — sub-agent

Agent tool, `model: "fable"`.

Prompt MUST include:

- Bug description from the user's `/riff:debug` argument (verbatim)
- Branch name: `git branch --show-current`
- `failure_type: user_reported`
- Phase path `.planning/phases/N-slug/` if currently on a phase branch
- Existing session file path if one exists
- Instruction: "Read `agents/debugger.md`. Diagnose the issue. Write to `.planning/debug/YYYY-MM-DD-[slug].md` using the DEBUG.md format from the agent. Attempt a fix if root cause is confirmed."

Wait until the debugger completes.

## Step 4: After fix

- Verify the original issue is resolved (with evidence)
- Run tests if they exist
- Commit: `fix: [description]`
- Recurring pattern (same bug type across multiple phases) → write `.planning/mistakes/mistake-YYYY-MM-DD.md`

## Escalation

DEBUG.md `UNRESOLVED` → surface to user. Do not retry automatically — the UNRESOLVED note explains what the next investigator needs.

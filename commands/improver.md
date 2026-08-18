---
description: Run the improver on recent phases to extract learnings into .planning/expertise/.pending/
allowed-tools: Bash, Read, Glob, Grep, Agent
argument-hint: "[N | --all]"
---

# /riff:improver

Batch the improver agent across recent phases to surface lessons learned. The improver is normally invoked at `/riff:next` Step 7b but only fires on the auto-trigger heuristic; this command is the explicit batch fallback when you want to harvest learnings on demand or catch up on a backlog.

## Arguments

- No args: scan the last 3 phases that have a `SUMMARY.md`
- `<N>`: scan the last N phases
- `--all`: scan every phase folder under `.planning/phases/`

## What You Do

1. **Verify `.planning/` exists.** If not, print `Not a RIFF project. Run /riff:init first.` and STOP.

2. **Enumerate candidate phases.** Glob `.planning/phases/*/SUMMARY.md`, sort by the numeric prefix of the phase folder. Skip any phase whose folder already contains `../expertise/.pending/.improver-<phase>.done` sentinel — that phase has already been processed (delete the sentinel to force re-run).

3. **Resolve target set.**
   - `--all`: every candidate
   - `<N>` numeric: last N candidates
   - default: last 3 candidates

   If the target set is empty after filtering, print `No phases to process (all already have improver sentinels). Delete the sentinel under .planning/expertise/.pending/ to re-run.` and STOP.

4. **Spawn improver per phase.** Run up to 3 in parallel (one Agent call per phase, all in one message when batch ≥ 2). For each:

   - Agent tool, `subagent_type: improver` (its `effort: low` frontmatter applies), `model: "sonnet"`, no background flag (we wait on results to summarize).
   - Prompt (the agent spec carries the procedure): _"Phase: `<phase-id>`. Read `.planning/phases/<phase-id>/SUMMARY.md` and `.planning/phases/<phase-id>/REVIEW.md` if present. Read `.planning/expertise/` files to avoid duplicating existing lessons. Write proposals to `.planning/expertise/.pending/` and the completion sentinel `.planning/expertise/.pending/.improver-<phase-id>.done` per the agent spec."_

5. **Summarize.** After all agents return, list newly created files under `.planning/expertise/.pending/` (excluding sentinels). One line per file: `<phase> → <agent>-<phase>.md (<patterns_written> patterns)`. If a sentinel reports `patterns_written: 0`, surface that too — silence is a valid result.

6. **Hand off review.** Suggest: _"Review pending proposals via `/riff:next` Step 10 on the next phase, or accept/reject inline now."_

## Notes

- Idempotent: existing sentinel skips that phase. Delete `.planning/expertise/.pending/.improver-<phase>.done` to force re-run.
- Pending files NEVER auto-merge into `.planning/expertise/<agent>.md`. Human validates.
- See `skills/improve/SKILL.md` for the active proposal workflow. The legacy improver agent was retired.

## Anti-Patterns

- Don't run on phases that haven't merged (wait until `SUMMARY.md` is final)
- Don't manually edit `.pending/*.md`; use the validation flow at `/riff:next` Step 10
- Don't `--all` repeatedly — the sentinel prevents redundant work, but each spawn is real tokens

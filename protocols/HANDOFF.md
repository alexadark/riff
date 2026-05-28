# HANDOFF — Session checkpoints for long RIFF commands

`/riff:start` `/riff:next` `/riff:wave` past ~200k tokens → hallucination risk up. Stop, `/clear`, reopen with STATE.md.

Referenced from `commands/{start,next,wave,INDEX}.md`. Budget colors: `references/CONTEXT-BUDGET.md`.

## Trigger

End of Stage / Step (never mid-step). 2+ fire since last `/clear` → propose handoff:

- 2+ sub-agents launched in Stage / Step
- 1+ revision cycle in Stage / Step
- Tool calls > ~150
- 3+ substantial files written / edited

Single fire ≠ enough. Phases < 25 files / 4 sub-agent passes rarely need handoff.

## Action

1. Finish step. Write artifact.
2. Update STATE.md per § STATE.md contract.
3. Print: `Context heavy (~NNNk, M heuristics). /clear and reopen: continue /riff:<cmd> at <checkpoint>. STATE.md updated.`
4. Stop. "keep going" → override.

## STATE.md contract

Template: `templates/STATE.md`. Required sections:

- **Current Position** — command, Stage / Step / Phase, status
- **Active Decisions** — every locked `AskUserQuestion` answer as facts (`Scope = production`, not `Asked about scope`)
- **Open Buckets** — BLOCKERS, queued REVISIONs, sub-agent returns not folded in
- **Files to bootstrap** — artifact paths next session reads
- **Resume Command** — paste-ready, e.g. `continue /riff:start at Stage 3. Read STATE.md.`
- **Session Notes** *(opt)* — nuances, e.g. `PLAN revision 1/2 used`

Contradiction on resume (re-asked question, new answer ≠ STATE.md) → STOP, surface. Never overwrite.

## Per-command checkpoints

**`/riff:start`** — close of each Stage. Most likely Stage 2.5, 4.5 (adversarial + revisions). Observed on Equilibria 2026-05-03 (5 Codex passes, ~30 BLOCKERS, 3 design files rewritten).

**`/riff:next`** — 3 checkpoints / phase:

| Checkpoint | After | Bootstrap |
|---|---|---|
| **next-A** Plan validated | Step 4b PROCEED | PLAN.md, PLAN-REVIEW.md, ROADMAP entry |
| **next-B** Code shipped | Step 5 SUMMARY.md, tests green | SUMMARY.md, `git diff main...HEAD`, PLAN.md |
| **next-C** Review passed | Step 7 PASS / RESOLVED | SUMMARY.md, REVIEW.md, SECURITY.md, DEBUG.md if any |

**`/riff:wave`** — 2 checkpoints / wave: after Step 3 (bundle written, before Codex launch), after Step 6 (reconcile complete). Codex execution itself runs in its own session, not subject to Claude's context budget.

## Automatic compaction checkpoint

The `compaction-checkpoint.sh` hook (Bucket D, PreCompact) injects a checkpoint summary into the compacted context automatically. This covers the most common case: context grows past the compaction threshold during a `/riff:next` phase.

The hook reads STATE.md for the active phase, captures branch + last commit + tool count, and emits a resume block. This does NOT replace the full handoff protocol (which writes STATE.md with decisions, blockers, and bootstrap files). It provides a safety net for unplanned compactions.

After compaction, the agent should:
1. Read the checkpoint block (injected into the compacted context)
2. Read STATE.md for full state
3. Continue the current step

## Don'ts

- Mid-step checkpoint → wait for artifact, never abort sub-agent.
- Heuristic not firing → no handoff. Spurious = friction.
- No STATE.md update → no handoff.
- "keep going" → respect.

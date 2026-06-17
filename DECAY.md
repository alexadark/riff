# DECAY.md

> Every 3 months, audit every component. Pruning protects against framework bloat.

## Review protocol

For each component below, answer:

1. When did I last use it?
2. What real problem did it solve?
3. If unused: why? Remove it?
4. If used: is there a simpler version?

## Components to audit

- [ ] /riff:start
- [ ] /riff:next
- [ ] /riff:wave
- [ ] /riff:status
- [ ] /riff:map
- [ ] /riff:quick
- [ ] /riff:debug
- [ ] /riff:init
- [ ] /riff:onboard
- [ ] /riff:learn-stack
- [ ] /riff:add-phase
- [ ] protocols/INCIDENT.md (conversational trigger)
- [ ] protocols/PROMOTE.md (conversational trigger)
- [ ] agents/planner.md
- [ ] agents/executor.md
- [ ] agents/debugger.md
- [ ] agents/security-reviewer.md
- [ ] hooks/\* (each individually)
- [ ] taste.md
- [ ] REGISTRY.md chain
- [ ] references/taste/stacks/\* (one entry per stack file — see "Stack drift audit" below)
- [ ] references/LANGUAGE.md
- [ ] references/EXPLANATION-LEVEL.md
- [ ] references/CONTEXT-BUDGET.md
- [ ] protocols/EXECUTION.md § Project Scope
- [ ] references/PROFILE-RESOLUTION.md

## Stack drift audit

Stack-specific rules in `references/taste/stacks/*.md` were written against a snapshot of each framework. Frameworks ship constantly — these files go stale silently and the planner builds on stale beliefs, producing R3 deviations that look like agent failures but are actually rule rot.

For each stack file, every quarter:

1. Use `ref_search_documentation` (Ref MCP) on the framework's current docs for the patterns the file covers.
2. Diff the rules against the current docs. Flag any rule that references a deprecated API, conflicts with the current recommended pattern, or was written for a superseded major version.
3. Update the file and bump a `last_audited: YYYY-MM-DD` line at the top.
4. If a stack file has not been touched in a project for 6+ months, audit it before reusing.

The 30 minutes per quarter saves multiple debugging sessions later.

## Last review: never

## Considered and rejected (do not re-debate without new evidence)

- **Docker sandbox for the AFK loop** — rejected 2026-04-07, then mooted 2026-05-26 when the AFK loop itself was retired in favor of `/riff:wave` (Codex out-of-process). Docker sandbox no longer applicable. Archived files: `.riff-private/legacy/`.
- **expertise.yaml with auto-validation against codebase** — rejected 2026-04-07. Reason: overkill for solo, markdown expertise notes with human validation are enough.
- **Meta-agents that create other agents** — rejected 2026-04-07. Reason: classic framework trap, high complexity for no measurable benefit in solo context.
- **ADWs in Python (orchestrators replacing riff-loop.sh)** — rejected 2026-04-07, then mooted 2026-05-26: `riff-loop.sh` itself was retired in favor of `/riff:wave`. Archived files: `.riff-private/legacy/`.
- **Worktrees for parallel phases** — rejected 2026-04-07. Reason: branch-per-phase already provides isolation at the cost level that matters.
- **Conversation history mining from JSONL logs** — rejected 2026-04-07. Reason: solo, handoff/pickup + MEMORY.md already cover the use case; fragile parsing.
- **/riff:teach context injection from references/** — rejected 2026-04-07. Reason: already covered by `@file` syntax in prompts.
- **Self-improving hooks via log analysis** — rejected 2026-04-07. Reason: hooks must be stable and readable, auto-modification is an anti-pattern.
- **STATS.md / metrics dashboard** — rejected 2026-04-07. Reason: solo, will never look at it.
- **REGISTRY.md full AST auto-generation** — rejected 2026-04-07. Reason: downgraded to a simple pre-commit reminder hook (Task 2.4). AST parser is fragile and over-engineered for the real need.
- **Multi-instance Octopus search** — rejected 2026-04-07. Reason: overkill for solo.
- **Branch-per-phase optional (`merge_strategy: direct`)** — rejected 2026-04-07. Reason: current branch-per-phase already works.
- **CostSentinel hook (token budget limit)** — rejected 2026-04-07. Reason: user on $200 Claude plan, never hit limits.
- **ponytail plugin / over-engineering gate / tech-debt ledger** — rejected 2026-06-17. Evaluated the ponytail skill (DietrichGebert/ponytail). Its decision ladder was worth stealing and landed as taste `architecture.md` rule 15 (reuse before write) + an executor Confidence-gate line. The rest is redundant: `/ponytail-review`+`/ponytail-audit` duplicate `simplifier` + Architecture Red Flags + 5th-phase `/audit-codebase`; the `/ponytail-debt` ledger duplicates seeds/DECAY and dies the STATS.md death (solo, never relooked at). Reopen only if tech debt is observed rotting in silence across phases despite the 4 existing layers (rule 15 → simplifier → 5th-phase audit → security/scope). Reason: formatting wars and tool churn cause more friction than value. Typecheck, tests, smoke checks, and security review catch the failures RIFF should gate by default. Projects can add lint/format explicitly.

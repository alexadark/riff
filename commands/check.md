---
description: Manual verification and security review
allowed-tools: Bash, Read, Glob, Grep, Write, Agent, AskUserQuestion
args: "[phase-number]"
---

# /riff:check

Manual trigger for verification + security review, outside the automatic `/riff:next` loop. Mirrors `/riff:next` Steps 5c, 6, 7 on an already-built phase.

## Arguments

- No args: check most recent phase (or full project if all done)
- `[phase-number]`: check a specific phase

## Resolve target phase (inline)

1. With `[phase-number]` → glob `.planning/phases/N-*/` for the matching folder.
2. No arg → read `STATE.md` for the current/last phase. All phases `done` → skip to **Full Project Check**.
3. Read `PLAN.md` + `SUMMARY.md` from that folder. SUMMARY.md missing → STOP ("phase not executed yet").

## Phase Check

**CRITICAL: Steps 1, 2a, 2b MUST use the Agent tool to spawn sub-agents. Do NOT run inline.**

### Step 1: Scope check — sub-agent (Haiku)

Agent tool, `model: "haiku"`. Prompt:

> Read `agents/scope-checker.md`. Read `.planning/phases/N-slug/PLAN.md` and `.planning/phases/N-slug/SUMMARY.md`. Diff task lists. Return MATCH | DROPPED: <list> | MALFORMED: <reason>.

- **MATCH** → proceed to Step 2.
- **DROPPED** → AskUserQuestion: for each dropped task, pick "completed (mark done in SUMMARY)" | "defer to new phase (run `/riff:add-phase` after)" | "rejected (write rationale)". Apply each choice, re-run Step 1. Loop until MATCH.
- **MALFORMED** → surface the parsing error, ask whether to skip (acceptable for unstructured PLAN.md) or fix the format and retry.

### Steps 2a + 2b: Adversarial + Security — IN PARALLEL

Launch BOTH in a single message.

**Step 2a (Adversarial — Codex):** Agent tool, `subagent_type: "codex:codex-rescue"`. Prompt:

> Phase: N-slug. Run `git diff main...HEAD`. Run the project's test + typecheck commands. Review the diff for logic bugs, race conditions, edge cases, missing error handling, off-by-one, incorrect assumptions. Write `.planning/phases/N-slug/REVIEW.md` per the format in `agents/adversarial-reviewer.md` with PASS/FAIL verdict.

**Step 2b (Security — Sonnet):** Agent tool, `model: "sonnet"`. Prompt:

> Read `agents/security-reviewer.md`. Run `git diff main...HEAD`. Read `.planning/phases/N-slug/SUMMARY.md`. OWASP scan on all changed files. Write findings inline with severity (CRITICAL > HIGH > MEDIUM > LOW).

Wait for BOTH before Step 3.

### Step 3: Aggregate VERIFICATION.md (inline)

Write `.planning/phases/N-slug/VERIFICATION.md`:

```markdown
# Verification — Phase N

## Scope: {{MATCH | DROPPED resolved}}
## Adversarial: {{PASS | FAIL}} — see REVIEW.md
## Security: {{PASS | ISSUES FOUND ({{counts by severity}})}}

## Verdict: {{PASS | FAIL | PASS WITH ISSUES}}

Verdict rules:
- PASS = scope MATCH + adversarial PASS + zero CRITICAL/HIGH security
- FAIL = adversarial FAIL OR any CRITICAL/HIGH security
- PASS WITH ISSUES = otherwise (MEDIUM/LOW security or NOTE-level adversarial findings)

## Recommended actions
- {{list}}
```

Print the same summary to the user.

## Full Project Check (all phases done)

1. **Cross-phase wiring (inline):** Do phases connect? Orphaned code from earlier phases?
2. **Full security scan — sub-agent (Sonnet):** Agent tool, `model: "sonnet"`. Prompt: _"Read `agents/security-reviewer.md`. Scope: whole repo (not a single phase diff). OWASP scan, focus on auth on all routes, input validation, IDOR, secrets, env validation, error leakage. Write findings inline."_
3. **taste.md compliance (inline):** Does codebase follow the rules?
4. Write `.planning/VERIFICATION.md` and report overall health.

## Output

```
# RIFF Check - Phase {{N}}
## Scope: {{MATCH/resolved}}
## Adversarial: {{PASS/FAIL}}
## Security: {{PASS/ISSUES}}
## Verdict: {{PASS/FAIL/PASS WITH ISSUES}}
## Recommended Actions
```

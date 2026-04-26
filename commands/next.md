---
description: The core loop - plan, build, verify the next phase
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
args: "[--plan-only] [phase-number]"
model: opus
---

# /riff:next

Pick the next phase from ROADMAP.yaml, plan it, execute it, review it, open a PR.

**Models:** see [`protocols/MODEL.md`](../protocols/MODEL.md). Parent is forced to Opus via frontmatter. Sub-agents MUST pass `model:` explicitly on the Agent tool call.

**Inline vs sub-agent:** Steps 1–4, 8, 9, 10 run inline. Steps 5, 5b, 6, 7, 7b, 8a spawn sub-agents.

## Arguments

- No args → auto-pick next (highest priority, deps met, not blocked)
- `--plan-only` → create plan but don't execute
- `[phase-number]` → target a specific phase

## Loop

```
Read state → Pick next → Confidence gate → Plan → Execute → Review → PR → (merge) → Update state on main
```

### Step 1: Read state (inline)

Read: ROADMAP.yaml, STATE.md, PROJECT.md (skim), previous SUMMARY.md and VERIFICATION.md.

### Step 2: Pick next phase (inline)

1. Filter `status: todo` phases where all `depends_on` are `done`
2. Sort by `priority` (P0 first)
3. AFK mode → filter to `mode: AFK` only
4. Last VERIFICATION.md has `FAIL` → don't pick new; create fix plan on existing branch

**Seed check:** scan `.planning/seeds/`. Seed's `trigger:` met → surface it. AFK → log only.

### Step 2b: Phase branch (inline)

```bash
git checkout -b riff/phase-N-slug
```

### Step 3: Confidence gate (inline)

See `protocols/EXECUTION.md` § Confidence Gate. Any dimension < 0.7 → STOP.

---

### Step 4: Plan — INLINE

Parent has already read state + ROADMAP + previous SUMMARY. Do NOT spawn a sub-agent.

Inject thinking keyword per MODEL.md § Planner selection.

1. Re-read if not in context: `taste.md`, `.planning/expertise/planner.md`, previous phase SUMMARY.md
2. [KEYWORD] Draft the plan. Break into waves. Mark independent tasks with `parallel: [task-A, task-B]` (independent = zero shared files)
3. Write to `.planning/phases/N-slug/PLAN.md`. Do NOT update STATE.md or ROADMAP.yaml
4. Include `## Model Recommendation`: default `executor_model: sonnet`. Recommend `opus` ONLY for novel architecture, 10+ tightly coupled files, unfamiliar external APIs

If `--plan-only`: STOP.

---

### Step 5: Execute — sub-agent

**Model:** `sonnet` default. ROADMAP.yaml `executor_model:` wins over PLAN.md's recommendation.

**Thinking:** none by default. `think hard` if `complex_execution: true`.

**Parallel tasks:** tasks marked `parallel:` MUST launch as separate sub-agents in a single message. Sequential tasks stay inline within the executor.

Agent prompt (give paths — do NOT paste file contents):

- Branch: `riff/phase-N-slug`
- Read: `.planning/phases/N-slug/PLAN.md`, `taste.md`, `.planning/expertise/executor.md`, `CLAUDE.md`
- Instruction: _"FIRST: verify you are on branch `riff/phase-N-slug`. Read PLAN.md and execute all tasks. For tasks marked `parallel:`, launch them as separate sub-agents in a single message. Commit after each task (conventional format, stage explicitly). Write `.planning/phases/N-slug/SUMMARY.md`."_

Wait until SUMMARY.md exists on disk.

**Auto-debug trigger:** scan SUMMARY.md for `FAILED` / `ERROR` / `unresolved` / incomplete tasks. Found → run auto-debug pattern (below) with `failure_type: executor_fail`, `artifact: SUMMARY.md`.

---

### Step 5b: Simplify — sub-agent (gated)

Runs before review so reviewers audit simplified code.

**Gate:** `simplify:` from the phase's ROADMAP.yaml entry (`true` | `false` | `auto`; default `auto`).

- `false` → skip
- `true` → always run
- `auto` → run ONLY if the phase is a refactor/consolidation (name or tags contain any of: `refactor`, `consolidation`, `cleanup`, `simplify`, `sweep`, `thinning`, `dedup`). Skip otherwise — including new-feature phases even when ≥3 files changed.

**Rationale:** simplifying *newly-written* code (fresh from a competent executor) rarely finds >20 LOC of real savings for 100k+ tokens of sub-agent cost. The ROI is on code that has accumulated crust across phases. If you suspect fresh code is over-engineered, set `simplify: true` explicitly — don't rely on `auto` to catch it.

**If running:** Agent tool, `model: "haiku"`.

Prompt: branch name, phase N-slug, instruction _"Read `agents/simplifier.md`. Scope: diff of branch `riff/phase-N-slug` against main only. Apply the protocol. Write `.planning/phases/N-slug/REFACTOR.md`. Commit simplifications as separate `refactor(phase-N): ...` commits, staging explicitly."_

---

### Step 5c: Scope check (inline)

Before review, verify executor honored the plan. Run scope-checker sub-agent.

**Agent:** Agent tool, model: haiku. Prompt: _"Read agents/scope-checker.md. Branch: riff/phase-N-slug. Read .planning/phases/N-slug/PLAN.md and SUMMARY.md. Diff task lists. Return MATCH | DROPPED: <list> | MALFORMED: <reason>."_

**On DROPPED:** STOP. AskUserQuestion: for each dropped task, pick "completed (mark done in SUMMARY)" | "defer to new phase (will run /riff:add-phase)" | "rejected (write rationale)". Apply the user's choice for each, then re-run Step 5c. Loop until MATCH.

**On MALFORMED:** surface the parsing error to user, ask whether to skip (acceptable for unstructured PLAN.md formats) or fix the format and retry.

**On MATCH:** proceed to Step 6.

---

### Steps 6 + 7: Adversarial + Security — IN PARALLEL

Launch BOTH in a single message.

**Step 6 (Adversarial — Codex):** Agent tool → skill `codex:codex-rescue`.

**Gate:** `adversarial:` from the phase's ROADMAP.yaml entry (`true` | `false` | `auto`; default `auto`).

- `false` → skip
- `true` → always run
- `auto` → run if the phase touches any of: auth, secrets, HMAC/crypto/tokens, RLS/multi-tenancy, payments, webhooks/callbacks, public routes, DB migrations, or is `priority: critical`. Skip on UI-only, docs, pure refactor, and low-priority feature phases.

Heuristics for `auto` (grep the diff file list): paths under `app/lib/server/auth*`, `app/lib/server/env.ts`, `app/server/services/*-push.ts`, `app/routes/api.webhooks.*`, `app/routes/api.*-callback.*`, any public route (no `requireAuth`), any `drizzle/*.sql`, or any schema file introducing new PII fields.

**Rationale:** Codex found the Phase 94.5 HIGH (`consumeInvite` expiry bypass) that Sonnet security review missed — its value is on security-critical code. On pure UI/refactor work it mostly finds style nits for ~150k tokens. Keep the sharpness, spend it where it matters.

**If running:** prompt includes phase goal (one line), branch, instruction _"Run `git diff main...HEAD`. Run `npx vitest run` and `npx tsc --noEmit`. Review the diff for: logic bugs, race conditions, edge cases, missing error handling, off-by-one, incorrect assumptions. Write `.planning/phases/N-slug/REVIEW.md` with PASS/FAIL verdict."_

- Auto-debug on FAIL → `failure_type: adversarial_fail`, `artifact: REVIEW.md`. On RESOLVED, re-run Step 6.

**Step 7 (Security — Sonnet):** Agent tool, `model: "sonnet"`. Thinking keyword per MODEL.md § Security selection. Prompt: `[KEYWORD]`, phase goal, instruction _"Run `git diff main...HEAD`. Read SUMMARY.md. OWASP scan on all changed files. CRITICAL/HIGH → mark blocked. Write findings inline."_

- Auto-debug on CRITICAL/HIGH → `failure_type: security_fail`, `artifact: [findings inline]`. On RESOLVED, re-run Step 7.

**Wait for BOTH.** If security CRITICAL/HIGH or adversarial FAIL → do NOT create PR.

### Step 7b: Improver — sub-agent (background, gated)

**Gate:** skip by default. Run only if ONE of these is true:

- `improver: true` in this phase's ROADMAP.yaml entry (explicit opt-in)
- SUMMARY.md contains the strings `"new pattern"`, `"first use of"`, or `"novel"` (heuristic: phase introduced something the executor thinks is worth extracting)

**Rationale:** per-phase improver runs duplicate learnings across phases (same patterns noticed 3x), inflate `.planning/expertise/.pending/`, and prematurely trip the 3-proposal AskUserQuestion threshold in Step 10. Better: run it batch via a dedicated `/riff:improver` invocation every ~3 phases, which can diff the last N SUMMARY.md files together and produce de-duplicated learnings.

**If running:** Agent tool, `model: "haiku"`, `run_in_background: true`.

Prompt: _"Read `.planning/phases/N-slug/SUMMARY.md` and `.planning/expertise/` files. Write learnings to `.planning/expertise/.pending/` if any. Do not auto-merge. Use Context7 or Ref MCP for recent libs."_

---

### Step 8: Create PR (inline)

Do NOT update ROADMAP.yaml or STATE.md on the feature branch.

**8a — Documentation check (BLOCKING):** compare SUMMARY.md against `.claude/references/project-details.md` (file tree), `docs/architecture.md` (service/route tables), `taste.md` (new patterns). Stale → spawn Haiku sub-agent to update before PR.

**8b — Push + PR:**

1. `git push -u origin riff/phase-N-slug`
2. `gh pr create` with phase title, artifacts, review + security status
3. **STOP. Do NOT merge.**

**8c — Update state after merge (inline):** wait for user to merge. Then on main:

```bash
git checkout main && git pull origin main
git add ROADMAP.yaml STATE.md
git commit -m "type(phase-N): short description"
git push origin main
```

If user launches next phase immediately: skip 8c (state update happens at start of next `/riff:next`).

### Step 9: Learn (inline)

- Taste proposals: new pattern → append to taste.md with `<!-- PENDING -->`
- Seeds: check `.planning/seeds/` triggers

### Step 10: Report + usage (inline)

Collect `total_tokens`, `tool_uses`, `duration_ms` from each Agent result.

Write `.planning/phases/N-slug/USAGE.md` using **`templates/usage.md`**.

Append to `.planning/usage-log.csv` (create with header if missing):

```csv
phase,title,date,total_tokens,duration_min,tool_calls,planner_tokens,executor_tokens,adversarial_tokens,security_tokens,debugger_tokens
```

Print:

```
Phase N: {{TITLE}} - {{VERDICT}}
Built: {{artifacts}}
Security: {{PASS/issues}}
Usage: {{total_tokens}}k tokens, {{duration}}min
Next: Phase {{N+1}}: {{NEXT_TITLE}}
```

Pending expertise: `ls .planning/expertise/.pending/ 2>/dev/null | wc -l`. If > 0, ALWAYS surface prominently in the end-of-phase summary. Do not let it scroll past silently:

```
🔔 {{N}} expertise proposal(s) pending — run `/riff:review-expertise` before the next phase. Unreviewed patches mean later phases may repeat the same mistakes.
```

Threshold: if pending count reaches 3 or more, upgrade the marker to an AskUserQuestion asking whether to pause for review before the next `/riff:next`. The goal is to catch rules that affect upcoming work before they go stale.

---

## Auto-debug pattern

Shared by Steps 5, 6, 7. Skip if `auto_debug: false`.

**Model:** `opus` (or `sonnet` if `debug_model: sonnet`).

**Prompt:**

> Read `agents/debugger.md`. Branch: `riff/phase-N-slug`. Failure type: `{{failure_type}}`. Failure artifact: `{{artifact}}`. Phase path: `.planning/phases/N-slug/`. Diagnose, attempt fix, write `.planning/phases/N-slug/DEBUG.md`.

**After completion:**

- DEBUG.md `RESOLVED` → re-run originating step, UNLESS all of these hold:
  - debugger ran with `opus` (default)
  - debugger's verification block in DEBUG.md reports tests green + tsc clean
  - every finding in the originating artifact has a corresponding new test locking the fix

  In that case, accept RESOLVED as the verdict without a re-run. The re-run's marginal value (catching regressions introduced by the fixes) is low when the debugger is methodical and each fix is test-pinned. Skipping saves ~30k-150k per FAIL cycle.

  Surface this decision in the Step 10 report: `Re-run skipped: RESOLVED with pinning tests`.

- DEBUG.md `UNRESOLVED` → halt, surface DEBUG.md to user

---

## AFK mode

Skip human interaction. Proceed on Confident/Likely. STOP on: Unclear, R3, FAIL, CRITICAL/HIGH security, all done.

## Ground rules

- Give paths, never paste file contents into prompts
- Step 4 is inline — never a sub-agent (~7x token waste)
- Sub-agents need explicit `model:` on the Agent call — frontmatter inheritance is not enough
- Auto-debug artifacts (DEBUG.md) are required input for the next cycle — don't skip triggers
- One phase per `/riff:next` call

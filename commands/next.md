---
description: The core loop - plan, build, verify the next phase
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
args: "[--plan-only] [phase-number]"
model: opus
---

# /riff:next

Pick the next phase from ROADMAP.yaml, plan it, execute it, review it, open a PR.

**Models:** see [`protocols/MODEL.md`](../protocols/MODEL.md). Parent is forced to Opus via frontmatter. Sub-agents MUST pass `model:` explicitly on the Agent tool call.

**Inline vs sub-agent:** Steps 1–4, 5c, 5d, 8, 9, 10 run inline. Steps 4b, 4c, 5, 5b, 5e, 6, 7, 7b, 8a spawn sub-agents.

**Auto-gate heuristics:** see [`protocols/AUTO-TRIGGERS.md`](../protocols/AUTO-TRIGGERS.md). Design rationale: see [`DECISIONS.md`](../DECISIONS.md) (D25–D27).

**Interactive question phrasing:** every `AskUserQuestion` in this command (Step 3 confidence gate, Step 4b plan-review REVISE escalation, Step 5c DROPPED triage, Step 5d fallow-fail triage, Step 5d runtime-error skip/halt, Step 7 security/adversarial findings, Step 8 unpushed-main prompt, Pending expertise review, Milestone deep audit prompt) follows the resolved `explanation_level`. `simple`/`eli5` → plain words, user-flow framing, drop framework jargon. See [`references/EXPLANATION-LEVEL.md`](../references/EXPLANATION-LEVEL.md) § Interactive questions.

## Arguments

- No args → auto-pick next (highest priority, deps met, not blocked)
- `--plan-only` → create plan but don't execute
- `[phase-number]` → target a specific phase

## Loop

```
Sync main → Reconcile stale bookkeeping → Read state → Pick next → Confidence gate → Plan → Execute → Review → PR → (merge) → Update state on main
```

### Step 0: Sync main + reconcile stale bookkeeping (inline)

Step 8c of the previous run only fires if the same Claude session is alive when the user clicks Merge (and the user is on `merge_strategy: github_button`). If the session was cleared/closed between PR creation and merge, the previous phase is shipped on main but still `status: todo` in ROADMAP.yaml. Step 0 catches that drift before picking the next phase, and also guarantees Step 2b branches from a clean main.

1. **Switch to main + check divergence (do NOT blindly pull).**

   ```bash
   git checkout main
   git fetch origin main
   ahead=$(git rev-list --count origin/main..main)
   behind=$(git rev-list --count main..origin/main)
   ```

   Branch on the result:

   - **In sync (`ahead=0` AND `behind=0`):** continue.
   - **Behind only (`ahead=0`, `behind>0`):** `git pull --ff-only origin main`.
   - **Ahead only (`ahead>0`, `behind=0`):** local has unpushed commits on main. Surface to the user: `Local main has <ahead> unpushed commits. Push now? (yes / skip)`. On `yes`: `git push origin main`. On `skip`: continue without pushing.
   - **Diverged (`ahead>0` AND `behind>0`):** **STOP and surface — do not auto-fix.** Common cause: a recent PR was squash-merged on GitHub and the squash bundled local-only commits that existed on the phase branch (e.g. unpushed personal commits Alex had on local main when the phase branch was cut). Print:

     ```
     Local main has <ahead> unpushed commits AND <behind> commits on origin.
     Likely a squash-merge bundling local-only commits on the phase branch.

     1. List the local-only commits and the origin-only commits to compare:
          git log origin/main..main --oneline
          git log main..origin/main --oneline
     2. If the content of every local-only commit is already represented on origin
        (typical when PR was squash-merged): `git reset --hard origin/main`
        aligns local main. Destructive — drops local SHAs, content preserved on origin.
     3. If there is real local work not on origin: rebase or cherry-pick onto
        origin/main, then push.

     Resolve manually before re-running /riff:next.
     ```

     Ask the user how they want to proceed. Do not run any destructive command without explicit confirmation.

2. **Detect stale-todo phases.** For each phase in ROADMAP.yaml with `status: todo`, check if its branch was merged into main. Match either a squash-merge subject or a `--no-ff` merge commit:

   ```bash
   git log --oneline --grep="Phase <id>:" main | head -1
   ```

   A match means the PR is merged but ROADMAP.yaml was never updated.

3. **If a stale-todo phase is found:**
   - Read `.planning/phases/<N-slug>/SUMMARY.md` to get the shipped scope, file/test counts, and PR number.
   - Set `status: done` for that phase in ROADMAP.yaml.
   - Update STATE.md: rewrite the `## Current Phase` prose to describe the shipped phase, append a row to the `## Phases Completed` table, refresh `## Next Action` to drop the now-shipped phase from "eligible".
   - Commit:
     ```bash
     git add ROADMAP.yaml STATE.md
     git commit -m "docs(phase-<N>): mark done in roadmap and state after merge"
     git push origin main
     ```

4. **No stale phase found:** continue to Step 1 (you're already on a clean main).

### Step 1: Read state (inline)

Read: ROADMAP.yaml, STATE.md, PROJECT.md (skim), previous SUMMARY.md and VERIFICATION.md.

**Read project scope** from `.planning/config.json` → `scope` field. If absent or file missing → default to `production`. Hold this value; it gates Steps 4b, 5b, 6, 7 below.

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

### Step 2c: Ensure PROMPTS.md exists (inline)

When entering a phase, ensure `.planning/phases/N-slug/PROMPTS.md` exists. If missing, copy from the framework template:

```bash
mkdir -p .planning/phases/N-slug
[[ ! -f .planning/phases/N-slug/PROMPTS.md ]] && cp .riff/templates/PROMPTS.md .planning/phases/N-slug/PROMPTS.md
```

This file captures the **substantive** prompts sent to each sub-agent in Steps 4, 4b, 5, 5b, 6, 7, and the auto-debug pattern. The `riff-pr-metadata.sh` script reads it at Step 8 and injects it into the PR body in a collapsible `<details>` block for stakeholder review.

**Prompt-capture convention.** "Substantive" means: capture only what tells the reader what the agent was asked to DO. Drop the boilerplate that controls how its output gets formatted. The PR reader is a stakeholder, not the agent — they want signal, not the agent's mechanical instructions.

| Keep | Drop |
|------|------|
| Mission / role / agent identity | "Output requirements" / format rules / one-sentence-per-line / line-break rules |
| Phase context (number, slug, branch, working dir) | "Where to save" / file paths to write artifacts to (`SUMMARY.md`, `REVIEW.md`, …) |
| Files to read | "What to return" / "Reporting back" sections aimed at the orchestrator |
| Hard rules, contracts, invariants | Output template scaffolding (markdown headers, table headers, frontmatter shape) |
| Verification criteria, severity grades, gate thresholds | Persistence/idempotency hints ("overwrite if exists", "fail-silent on error") |
| Locked decisions referenced by ID (D1, B-05, etc.) | Repeated stylistic rules already in `taste.md` / `profile.yaml` |

When in doubt: would removing this line change the reader's understanding of WHAT the agent did? If no, drop it.

### Step 3: Confidence gate (inline)

See `protocols/EXECUTION.md` § Confidence Gate. Any dimension < 0.7 → STOP.

---

### Step 4: Plan — INLINE

Parent has already read state + ROADMAP + previous SUMMARY. Do NOT spawn a sub-agent.

Inject thinking keyword per MODEL.md § Planner selection.

1. Re-read if not in context: `taste.md`, `.planning/expertise/planner.md`, previous phase SUMMARY.md. If `.planning/phases/N-slug/PLAN-REVIEW.md` exists (revision cycle from Step 4b), read it and address every `BLOCKER` finding before rewriting PLAN.md.
2. [KEYWORD] Draft the plan. Break into waves. Mark independent tasks with `parallel: [task-A, task-B]` (independent = zero shared files)
3. Write to `.planning/phases/N-slug/PLAN.md`. Do NOT update STATE.md or ROADMAP.yaml
4. Include `## Model Recommendation`: default `executor_model: sonnet`. Recommend `opus` ONLY for novel architecture, 10+ tightly coupled files, unfamiliar external APIs

**Prompt capture:** Step 4 is inline (no sub-agent invoked), so the "prompt" is the orchestrator's self-instruction. Append a short note describing the inputs read and the planning brief into `.planning/phases/N-slug/PROMPTS.md` under the `## Planner` section heading.

---

### Step 4b: Plan adversarial review — sub-agent (gated)

**Skip if `scope: scratch`.** Personal/local apps don't need adversarial plan review.

Runs before execution so the planner can revise BEFORE code is written. Plan-stage fixes cost ~10x less than code-stage fixes.

**Gate:** `plan_adversarial:` from the phase's ROADMAP.yaml entry (`true` | `false` | `auto`; default `auto`).

- `false` → skip (log to `.planning/phases/N-slug/GATES.md`: `Step 4b: skipped — gate=false`)
- `true` → run (skip overrides do NOT apply when gate is explicit `true`)
- `auto` → see [`AUTO-TRIGGERS.md#plan-adversarial-auto`](../protocols/AUTO-TRIGGERS.md#plan-adversarial-auto)

**Skip overrides (only when gate resolves to `auto`):** before spawning, check the skip overrides in [`AUTO-TRIGGERS.md#plan-adversarial-auto`](../protocols/AUTO-TRIGGERS.md#plan-adversarial-auto). If any fires, append a one-line entry to `.planning/phases/N-slug/GATES.md` (`Step 4b: skipped — <reason>`) and continue to Step 5 without spawning Codex.

**Pre-spawn usage check:** see § Codex usage tracking. Soft-cap warning fires if last 5h has >5 Codex calls.

**If running:** Agent tool → skill `codex:codex-rescue`. Append `Step 4b: ran — model={{MODEL}} effort={{EFFORT}}` to `GATES.md` after completion. Append a row to `.planning/codex-usage.csv` (see § Codex usage tracking) with `step=4b`, `outcome=proceed|revise|error`, `duration_sec=<measured>`.

**Resolve model + effort** per [`protocols/MODEL.md`](../protocols/MODEL.md) § Codex model + effort. Default for Step 4b: `gpt-5.5 medium`. Per-phase `codex_model:` / `codex_effort:` override.

**Resolve `risk_focus`** from the phase's ROADMAP.yaml entry (optional, free text, e.g. `"concurrency, idempotency"`). When set, append the targeted clause to the prompt below.

Prompt: phase goal (one line), branch, instruction _"Run with `--model {{MODEL}} --effort {{EFFORT}}`. Read `agents/plan-adversarial-reviewer.md`. Read `.planning/phases/N-slug/PLAN.md`, PROJECT.md, the ROADMAP.yaml entry for phase N, and `taste.md` sections relevant to the phase surface. Apply the protocol. Write `.planning/phases/N-slug/PLAN-REVIEW.md` with PROCEED or REVISE verdict."_

If `risk_focus` is set, append to the prompt: _"Pressure-test these specific risks first: {{RISK_FOCUS}}. Any other material findings still report, but lead with these."_

**Prompt capture:** After launching the plan-adversarial-reviewer sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under the `## Adversarial reviewer (Codex)` section heading (or a new `## Plan adversarial reviewer (Codex)` subsection if both Step 4b and Step 6 ran in the same phase — keep them distinct).

**On REVISE:**

1. Surface PLAN-REVIEW.md to user (paste the Findings section).
2. Re-run Step 4 (planner, inline) with PLAN-REVIEW.md as additional input. Planner addresses each `BLOCKER`, optionally addresses `WARNING`/`NOTE`, rewrites PLAN.md in place.
3. Re-run Step 4b. Loop until PROCEED.
4. Max 2 revision cycles, then STOP and escalate to user with both PLAN.md and PLAN-REVIEW.md.

**On PROCEED:** continue.

---

### Step 4c: Pre-exec explanation — sub-agent (always, fail-silent)

Generates a plain-language description of the phase plan for the `/riff:dashboard` view. Audience level + language come from `profile.yaml`. Failure here NEVER blocks the pipeline.

**Skip if neither `style.explanation_level` nor `dashboard.level` is set in profile.yaml** (back-compat for users who haven't re-onboarded).

**Resolve level + language:**
- `level` = `profile.style.explanation_level` → `profile.dashboard.level` (legacy) → `simple`
- `language` = `profile.user.narrative_language` → `profile.dashboard.language` (legacy) → `profile.user.conversational_language` if `fr`/`en` → `en`.

Agent tool, `model: "haiku"`. Prompt:

> Phase: N (slug, title from ROADMAP).
> Read `.planning/phases/N-slug/PLAN.md` and the ROADMAP.yaml entry for phase N. Do not read SUMMARY.md (it does not exist yet).
> Write what THIS PHASE WILL DO. Language: `{{LANGUAGE}}`.
>
> Audience level: `{{LEVEL}}`.
> - **technical** — name functions, types, files, paths, libs when they matter. Tech vocab assumed. Implementation details welcome when they explain what works differently. Surface architecture decisions. ~5-10 lines.
> - **simple** — plain words, replace tech terms with what they mean. Focus on what changes for the system or the user, not the how. Concrete examples beat abstract descriptions. ~3-7 lines.
> - **eli5** — one analogy if it helps, zero tech vocabulary, user-visible outcome only. 2-4 sentences. No padding.
>
> Style rules (apply to all levels): no filler ("in order to", "afin de"), no marketing words ("robust", "seamless", "leverage"), no transition fluff ("additionally", "également", "par ailleurs"). FR: "on" not "nous", "ça" not "cela". EN: contractions OK. One sentence per line, every sentence carries info. Length = what content needs, no padding.
>
> Return ONLY the explanation text. One sentence per line. No preamble, no markdown headers. Write to `.planning/phases/N-slug/EXPLAIN.{{LEVEL}}.md`.

On error: log a one-line warning to console (`Step 4c: explain generation failed — <reason>. Dashboard will show placeholder.`) and continue. Do NOT halt.

If `--plan-only` was passed: STOP here. The PLAN.md, PLAN-REVIEW.md, and EXPLAIN.{{LEVEL}}.md are the deliverables.

---

### Step 5: Execute — sub-agent

**Model:** `sonnet` default. ROADMAP.yaml `executor_model:` wins over PLAN.md's recommendation.

**Thinking:** none by default. `think hard` if `complex_execution: true`.

**Parallel tasks:** tasks marked `parallel:` MUST launch as separate sub-agents in a single message. Sequential tasks stay inline within the executor.

Agent prompt (give paths — do NOT paste file contents):

- Branch: `riff/phase-N-slug`
- Read: `.planning/phases/N-slug/PLAN.md`, `taste.md`, `.planning/expertise/executor.md`, `CLAUDE.md`
- Instruction: _"FIRST: verify you are on branch `riff/phase-N-slug`. Read PLAN.md and execute all tasks. For tasks marked `parallel:`, launch them as separate sub-agents in a single message. Commit after each task (conventional format, stage explicitly). Write `.planning/phases/N-slug/SUMMARY.md`."_

**Prompt capture:** After launching the executor sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under the `## Executor` section heading.

Wait until SUMMARY.md exists on disk.

**Auto-debug trigger:** scan SUMMARY.md for `FAILED` / `ERROR` / `unresolved` / incomplete tasks. Found → run auto-debug pattern (below) with `failure_type: executor_fail`, `artifact: SUMMARY.md`.

---

### Step 5b: Simplify — sub-agent (gated)

**Skip if `scope: scratch`.** Personal/local code doesn't need a simplifier pass.

Runs before review so reviewers audit simplified code.

**Gate:** `simplify:` from the phase's ROADMAP.yaml entry (`true` | `false` | `auto`; default `auto`).

- `false` → skip
- `true` → always run
- `auto` → see [`AUTO-TRIGGERS.md#simplifier-auto`](../protocols/AUTO-TRIGGERS.md#simplifier-auto)

**If running:** Agent tool, `model: "haiku"`.

Prompt: branch name, phase N-slug, instruction _"Read `agents/simplifier.md`. Scope: diff of branch `riff/phase-N-slug` against main only. Apply the protocol. Write `.planning/phases/N-slug/REFACTOR.md`. Commit simplifications as separate `refactor(phase-N): ...` commits, staging explicitly."_

**Prompt capture:** After launching the simplifier sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under a `## Simplifier` section heading (append the section if not already present in the template).

---

### Step 5c: Scope check (inline)

Before review, verify executor honored the plan. Run scope-checker sub-agent.

**Agent:** Agent tool, model: haiku. Prompt: _"Read agents/scope-checker.md. Branch: riff/phase-N-slug. Read .planning/phases/N-slug/PLAN.md and SUMMARY.md. Diff task lists. Return MATCH | DROPPED: <list> | MALFORMED: <reason>."_

**On DROPPED:** STOP. AskUserQuestion: for each dropped task, pick "completed (mark done in SUMMARY)" | "defer to new phase (will run /riff:add-phase)" | "rejected (write rationale)". Apply the user's choice for each, then re-run Step 5c. Loop until MATCH.

**On MALFORMED:** surface the parsing error to user, ask whether to skip (acceptable for unstructured PLAN.md formats) or fix the format and retry.

**On MATCH:** proceed to Step 5d.

---

### Step 5d: Fallow audit — inline (gated)

**Skip if `scope: scratch`.** Personal/local code doesn't need a codebase-intelligence pass.

**Skip if not a TS/JS project.** Detection: `package.json` exists at project root. If absent, log `Step 5d: skipped — not TS/JS` to `GATES.md` and continue to Step 5e.

Mechanical codebase intelligence on the phase diff via [`fallow`](https://github.com/fallow-rs/fallow): dead code, duplication, complexity, boundary violations. Sub-second, deterministic, no LLM. Replaces what the simplifier used to check mechanically.

**Run (inline — fallow is itself the analyzer, no sub-agent needed):**

1. Detect package manager runner: `pnpm-lock.yaml` → `pnpm exec`, `bun.lock` → `bunx`, `yarn.lock` → `yarn`, otherwise `npx`.
2. Run: `<runner> fallow audit --changed-since main --format json > .planning/phases/N-slug/FALLOW.json`
3. Parse the `verdict` field: `pass` | `warn` | `fail`.

**Behavior (initial integration — fail-on-fail only, warn does not block):**

- `pass` → log `Step 5d: pass` to GATES.md. Continue.
- `warn` → log `Step 5d: warn — <count> findings` to GATES.md. Continue. Include the count in Step 10 report.
- `fail` → STOP. Surface the findings to the user via AskUserQuestion:
  - **Fix in place** — re-run the executor with FALLOW.json as additional input, then re-run Step 5d. Max 2 cycles, then escalate.
  - **Mark as accepted exception** — write a one-line rationale to GATES.md (`Step 5d: accepted-exception — <reason>`) and continue.
  - **Skip this gate** — one-time override, log `Step 5d: override` to GATES.md and continue.

**On `command not found` (fallow not installed):** log `Step 5d: skipped — fallow not installed` to GATES.md and continue. Don't block. Projects predating this integration won't have fallow as a devDep; `/riff:start` adds it for new TS/JS production projects.

**On other non-zero exit (runtime error):** surface stderr to the user, AskUserQuestion `skip and continue | halt`. Default skip on no answer.

---

### Step 5e: Post-mortem explanation — sub-agent (always, fail-silent)

Generates a plain-language post-mortem of what was built, with a metadata block, for the `/riff:dashboard` view. Failure NEVER blocks the pipeline.

**Skip if `dashboard:` section is missing from profile.yaml.**

**Resolve level + language** (same logic as Step 4c).

**Compute metadata before spawning:**
- `DURATION` = SUMMARY.md `{{DURATION}}` field (or wall-clock from first/last commit timestamps if missing)
- `FILES_STAT` = output of `git diff --stat main...HEAD | tail -1` (e.g., `12 files changed, 234 insertions(+), 56 deletions(-)`)
- `GATES_SUMMARY` = read `.planning/phases/N-slug/GATES.md` if it exists; one line per step

Agent tool, `model: "haiku"`. Prompt:

> Phase: N (slug, title).
> Read `.planning/phases/N-slug/SUMMARY.md`. If they exist, also read `.planning/phases/N-slug/PLAN-REVIEW.md`, `REFACTOR.md`, `VERIFICATION.md`.
> Write WHAT WAS BUILT in this phase. Audience level: `{{LEVEL}}`. Language: `{{LANGUAGE}}`. Mention deviations or surprises if any.
>
> Audience level (controls VOCABULARY only): same as Step 4c.
>
> STYLE RULES (apply strictly, all levels): casual spoken voice, never formal, never corporate. French: "on" not "nous", "ça" not "cela", drop "également / par ailleurs / au total". English: contractions, drop "additionally / moreover". Short sentences, ONE idea per sentence, max ~12 words. **Line break after EACH period** — one sentence per line. No filler. No marketing words.
>
> Example GOOD (fr):
> On a fixé un bug dans les webhooks.
> Le système ne bloquait plus quand un appel échouait.
> Maintenant chaque échec relance la phase suivante.
>
> Then append the following metadata block VERBATIM (do not rewrite the values):
>
> ```
> ## Metadata
> - Duration: {{DURATION}}
> - Files: {{FILES_STAT}}
> - Gates: {{GATES_SUMMARY}}
> ```
>
> Return only the prose + metadata block. One sentence per line in the prose. No preamble, no other markdown headers. Write to `.planning/phases/N-slug/EXPLAIN-POST.{{LEVEL}}.md`.

On error: log a one-line warning and continue.

---

### Steps 6 + 7: Adversarial + Security — IN PARALLEL

**Skip BOTH if `scope: scratch`.** Personal/local apps don't run adversarial review or security-reviewer. Jump to Step 8 (PR creation). Belt-and-suspenders: security-reviewer.md also self-skips when scope=scratch in case it's invoked manually.

Launch BOTH in a single message.

**Step 6 (Adversarial — Codex):** Agent tool → skill `codex:codex-rescue`.

**Gate:** `adversarial:` from the phase's ROADMAP.yaml entry (`true` | `false` | `auto`; default `auto`).

- `false` → skip (log to `.planning/phases/N-slug/GATES.md`: `Step 6: skipped — gate=false`)
- `true` → run (skip overrides do NOT apply when gate is explicit `true`)
- `auto` → see [`AUTO-TRIGGERS.md#adversarial-auto`](../protocols/AUTO-TRIGGERS.md#adversarial-auto)

**Skip overrides (only when gate resolves to `auto`):** before spawning, check the skip overrides in [`AUTO-TRIGGERS.md#adversarial-auto`](../protocols/AUTO-TRIGGERS.md#adversarial-auto). If any fires, append a one-line entry to `.planning/phases/N-slug/GATES.md` (`Step 6: skipped — <reason>`) and continue without spawning Codex (security review still runs in parallel).

**Resolve model + effort** per [`protocols/MODEL.md`](../protocols/MODEL.md) § Codex model + effort. Defaults by `budget_quality`: `frugal` → `gpt-5.4-mini minimal`; `balanced` → `gpt-5.4 medium`; `max` → `gpt-5.5 medium`. Per-phase `codex_model:` / `codex_effort:` override.

**Resolve `risk_focus`** from the phase's ROADMAP.yaml entry (optional, free text, e.g. `"concurrency, idempotency"`). When set, append the targeted clause to the prompt below.

**Pre-spawn usage check:** see § Codex usage tracking. Soft-cap warning fires if last 5h has >5 Codex calls.

**If running:** prompt includes phase goal (one line), branch, instruction _"Run with `--model {{MODEL}} --effort {{EFFORT}}`. Run `git diff main...HEAD`. Run `npx vitest run` and `npx tsc --noEmit`. Review the diff for: logic bugs, race conditions, edge cases, missing error handling, off-by-one, incorrect assumptions. Write `.planning/phases/N-slug/REVIEW.md` with PASS/FAIL verdict."_ If `risk_focus` is set, append to the prompt: _"Pressure-test these specific risks first: {{RISK_FOCUS}}. Any other material findings still report, but lead with these."_ Append `Step 6: ran — model={{MODEL}} effort={{EFFORT}}` to `GATES.md` after completion. Append a row to `.planning/codex-usage.csv` (see § Codex usage tracking) with `step=6`, `outcome=pass|fail|error`, `duration_sec=<measured>`.

**Prompt capture:** After launching the adversarial-reviewer (Codex) sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under the `## Adversarial reviewer (Codex)` section heading.

- Auto-debug on FAIL → `failure_type: adversarial_fail`, `artifact: REVIEW.md`. On RESOLVED, re-run Step 6.

**Step 7 (Security — Sonnet):** Agent tool, `model: "sonnet"`. Thinking keyword per MODEL.md § Security selection. Prompt: `[KEYWORD]`, phase goal, instruction _"Run `git diff main...HEAD`. Read SUMMARY.md. OWASP scan on all changed files. CRITICAL/HIGH → mark blocked. Write findings inline."_

**Prompt capture:** After launching the security-reviewer sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under the `## Security reviewer` section heading.

- Auto-debug on CRITICAL/HIGH → `failure_type: security_fail`, `artifact: [findings inline]`. On RESOLVED, re-run Step 7.

**Wait for BOTH.** If security CRITICAL/HIGH or adversarial FAIL → do NOT create PR.

### Step 7b: Improver — sub-agent (background, gated)

**Gate:** skip by default. See [`AUTO-TRIGGERS.md#improver-heuristic`](../protocols/AUTO-TRIGGERS.md#improver-heuristic) for run conditions.

**If running:** Agent tool, `model: "haiku"`, `run_in_background: true`.

Prompt: _"Read `.planning/phases/N-slug/SUMMARY.md` and `.planning/expertise/` files. Write learnings to `.planning/expertise/.pending/` if any. Do not auto-merge. Use Context7 or Ref MCP for recent libs."_

---

### Step 8: Create PR (inline)

Do NOT update ROADMAP.yaml or STATE.md on the feature branch.

**8a — Documentation check (BLOCKING):** compare SUMMARY.md against `.claude/references/project-details.md` (file tree), `docs/architecture.md` (service/route tables), `taste.md` (new patterns). Stale → spawn Haiku sub-agent to update before PR.

**README check (BLOCKING):** if `README.md` does NOT exist at the project root, halt 8a and write one before proceeding. Rescue path for projects bootstrapped before `start.md` had the README step (or for brownfield onboardings via `/riff:init` that never ran `/riff:start`). Seed from PROJECT.md (or the project's CLAUDE.md if PROJECT.md is missing). Sections per the `start.md` Stage 5 production scope spec (project name + context + stack + local dev commands + workflow + repo layout + status). Cross-check the dev commands match `package.json` `scripts:`. Skip on `scope: scratch` (a one-line stub README is fine for scratch projects but still required).

**8b — Push + PR:**

1. `git push -u origin riff/phase-N-slug`
2. Compose the PR body:
   a. Draft the human summary (phase title, artifacts touched, review + security verdict, key changes from SUMMARY.md)
   b. **Finalize PROMPTS.md.** Open `.planning/phases/N-slug/PROMPTS.md`. For any section whose sub-agent did not fire this phase (typically `## Debugger (if invoked)` when no failure occurred, or `## Simplifier` if Step 5b skipped), replace the remaining `{{prompt verbatim}}` placeholder with `_(not invoked)_`. Every section must end up either with the actual prompt or with `_(not invoked)_`. The metadata script in (c) hard-fails if any `{{prompt verbatim}}` remains, blocking PR creation — by design, so stakeholders never see template tokens leaking into the body.
   c. Run `bash .riff/scripts/riff-pr-metadata.sh <phase-id>` and capture stdout — this is the tracked Generation metadata section (models per step, real duration from git timestamps, gates, Codex usage, agents observed in commit trailers, **token usage per agent parsed from USAGE.md**, and **agent prompts in a collapsible block parsed from PROMPTS.md**)
   d. Concatenate: `<human summary>` + `<script stdout>`. The script output already starts with a horizontal rule `---` and an `## Generation metadata (RIFF)` heading, so no separator needed
3. `gh pr create --title "<phase title>" --body "<composed body>"`
4. **Read `profile.yaml` `git.merge_strategy`** (resolved per `.riff/references/PROFILE-RESOLUTION.md`; default `github_button` if missing or file missing) and branch:
   - **`github_button`:** print final report ending with `PR open at <url>. Click Merge on GitHub when ready. Run /riff:next again — Step 0 reconciles ROADMAP/STATE on the next run.` STOP. Skip 8c.
   - **`local_no_ff`:** print final report ending with `PR open at <url>. Review on GitHub, then tell me 'merge' to merge locally and continue.` Stay alive. When the user says "merge" (or equivalent), run 8c.

5. **Solo-reviewer reminder (inline, after the final report).** Read `user.work_mode` from `profile.yaml`. If `solo` or `solo_plus_clients` (or `client_work` / `mix`) AND the phase touched a sensitive surface (auth, payments, DB writes — derive from PLAN.md acceptance criteria or REVIEW.md categories), append one extra line to the report: `No teammate review configured. Consider waiting 24h or pairing on review before merging.` Skip for `team`. Skip for non-sensitive phases regardless of work_mode. Reminder is informational, never blocks the merge.

The metadata script lives in the framework at `.riff/scripts/riff-pr-metadata.sh` and reads only tracked artifacts (PLAN.md path, SUMMARY.md path, GATES.md, ROADMAP.yaml, `.planning/codex-usage.csv`, git commit timestamps and trailers). It never includes Claude estimates like the PLAN.md `Estimate:` field — duration comes from first/last commit timestamps.

**8c — Update state after merge (inline):**

The flow depends on `git.merge_strategy`:

- **`github_button`:** Step 8c is a no-op in this session. Step 0 of the next `/riff:next` run reconciles ROADMAP.yaml + STATE.md.

- **`local_no_ff`:** on the user's "merge" cue:

  ```bash
  git checkout main
  git pull --ff-only origin main
  git merge --no-ff riff/phase-N-slug -m "Phase N: <title> (#<PR-number>)"
  git push origin main
  git branch -d riff/phase-N-slug || git branch -D riff/phase-N-slug
  git push origin :riff/phase-N-slug
  ```

  Then update ROADMAP.yaml (`status: done`) + STATE.md (Current Phase prose, Phases Completed row, Next Action), commit, push:

  ```bash
  git add ROADMAP.yaml STATE.md
  git commit -m "docs(phase-N): mark done in roadmap and state after merge"
  git push origin main
  ```

  GitHub auto-closes the PR as merged when it sees the merge commit on origin/main. If `git branch -d` complains "not fully merged" because GitHub already squash-merged a previous run, fall back to `-D` (the branch is merged in spirit).

### Step 9: Learn (inline)

- Taste proposals: new pattern → append to taste.md with `<!-- PENDING -->`
- Seeds: check `.planning/seeds/` triggers

### Step 10: Report + usage (inline)

Collect `total_tokens`, `tool_uses`, `duration_ms` from each Agent result.

Write `.planning/phases/N-slug/USAGE.md` using **`templates/usage.md`**.

`PROMPTS.md` is a sibling phase artifact (alongside USAGE.md, PLAN.md, SUMMARY.md, GATES.md) — it was seeded at Step 2c and appended to throughout Steps 4, 4b, 5, 5b, 6, 7, and the auto-debug pattern. Both USAGE.md and PROMPTS.md are read by `riff-pr-metadata.sh` at Step 8 to enrich the PR body with token usage and substantive sub-agent prompts.

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

### Pending expertise review (inline)

Compute pending count: `ls .planning/expertise/.pending/*.md 2>/dev/null | wc -l`. If 0 → skip this section.

If > 0, run AskUserQuestion:

> "{{N}} expertise patches pending. What do you want to do?"
>
> - **Review now** — walk per-pattern (recommended for staying coherent)
> - **Defer to next phase** — leave them in `.pending/`, will ask again at end of next phase
> - **Reject all** — wipe `.pending/` (with one confirmation step)

**Review now** flow (per-pattern):

1. Glob `.planning/expertise/.pending/*.md`. For each file, read it and identify each PATTERN inside (a file may contain multiple).
2. For each pattern, classify into one of three tiers:

   | Tier             | Scope                                                                                                  | Destination                                                                       |
   | ---------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
   | **Stack**        | Gotcha / convention for a tech (Drizzle, Zod, RR7, Vitest, etc.) that applies to any project using it | `~/DEV/frameworks/riff/references/taste/stacks/<stack>.md` (framework)            |
   | **Architecture** | Design principle, multi-tenant rule, security pattern applicable beyond one project                   | `~/DEV/frameworks/riff/references/taste/{architecture,security,backend,testing}.md` |
   | **Project**      | File paths, provider quirks, domain-specific patterns tied to this codebase                           | `.planning/expertise/<agent>.md` and/or project `taste.md`                        |

3. AskUserQuestion per pattern: **Accept (at tier X) / Reject / Edit / Re-tier**.
4. Apply the decision: append to destination (without `Justification` line for Project tier), remove pattern from pending file.
5. When all patterns in a pending file are handled, delete the pending file.
6. Auto-reject duplicates of existing rules and note them in the report.

Rules:
- Default to **Project** tier when unsure. Over-promotion to framework bloats references for all users.
- If a framework file exceeds 15 entries after append, warn to compress.
- When promoting to RIFF framework (Stack or Architecture tier), remind: "Existing projects won't auto-pick-up this rule, their `taste.md` was seeded at `/riff:start`. They'd need a manual sync."

**Defer** flow:
Print `Deferred. {{N}} patches stay in .planning/expertise/.pending/. Will ask again at the end of the next phase.` Do nothing else.

**Reject all** flow:
Confirm with one more AskUserQuestion ("Wipe all {{N}} patches? This is irreversible."). On confirm: `rm -f .planning/expertise/.pending/*.md`. Print `Rejected {{N}} patches.`

Report at end: `Reviewed: M accepted (stack/arch/project breakdown), K rejected, E edited, D deferred.`

### Milestone deep audit prompt (inline)

After Step 10's report, check the just-completed phase's ROADMAP.yaml entry for a `milestone:` tag. If absent → no-op, `/riff:next` is done.

If `milestone:` is set, AskUserQuestion:

> Phase N closes milestone `{{name}}`. Run a Codex deep audit across all phases sharing this milestone now, or defer?
>
> - **Run now** — read `protocols/DEEP-AUDIT.md` and execute the flow inline (resolves scope, spawns deep-auditor via `codex:codex-rescue`, surfaces verdict).
> - **Defer** — print `Deferred. Run conversationally with "deep audit" anytime.`

Skip silently if the `codex:codex-rescue` skill is not configured (log one-line warning, no prompt).

---

## Session checkpoints

10 steps / parent session → past 200k fast for non-trivial phases. Sub-agent returns + inline reads + status updates accumulate. Past 200k = hallucination risk up. See `CLAUDE.md` § Context budget + [`protocols/HANDOFF.md`](../protocols/HANDOFF.md).

3 break points (parent flush via `/clear`, resume from disk):

| Checkpoint | Triggered after | Bootstrap reads |
|---|---|---|
| **next-A** Plan validated | Step 4b PROCEED on PLAN-REVIEW.md | PLAN.md, PLAN-REVIEW.md, ROADMAP entry |
| **next-B** Code shipped | Step 5 SUMMARY.md, tests green | SUMMARY.md, `git diff main...HEAD`, PLAN.md |
| **next-C** Review passed | Step 7 PASS / RESOLVED via debugger | SUMMARY.md, REVIEW.md, DEBUG.md if any, AUTHORIZATION-MATRIX.md if any |

Close of checkpoint → eval heuristic in [`protocols/HANDOFF.md`](../protocols/HANDOFF.md) § Trigger. 2+ fire →

1. Finish step. Write artifact.
2. Update STATE.md per HANDOFF.md § STATE.md contract — Active Decisions, Open Buckets, Files to bootstrap, Resume Command.
3. Surface: `Context at NNNk, M heuristics fired. /clear + reopen at checkpoint X with: continue /riff:next at Step Y for phase N-slug. Read STATE.md.`

Mid-step checkpoint = no. Sub-agent lands artifact before parent flush.

Phases < 25 files / 4 sub-agent passes = single-session default. Checkpoint for 50+ file phases.

---

## Auto-debug pattern

Shared by Steps 5, 6, 7. Skip if `auto_debug: false`.

**Model:** `opus` (or `sonnet` if `debug_model: sonnet`).

**Prompt:**

> Read `agents/debugger.md`. Branch: `riff/phase-N-slug`. Failure type: `{{failure_type}}`. Failure artifact: `{{artifact}}`. Phase path: `.planning/phases/N-slug/`. Diagnose, attempt fix, write `.planning/phases/N-slug/DEBUG.md`.

**Prompt capture:** After launching the debugger sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under the `## Debugger (if invoked)` section heading.

**After completion:**

- DEBUG.md `RESOLVED` → re-run originating step, UNLESS all of these hold:
  - debugger ran with `opus` (default)
  - debugger's verification block in DEBUG.md reports tests green + tsc clean
  - every finding in the originating artifact has a corresponding new test locking the fix

  In that case, accept RESOLVED as the verdict without a re-run. Surface in Step 10 report: `Re-run skipped: RESOLVED with pinning tests`.

- DEBUG.md `UNRESOLVED` → halt, surface DEBUG.md to user

---

## Codex usage tracking

Every Codex call (Step 4b, Step 6) appends a row to `.planning/codex-usage.csv` at project root. This is a Plus-quota awareness counter, not a billing tool. Already covered by the project-level `.gitignore` rule on `.planning/`.

**File:** `.planning/codex-usage.csv` (create with header on first call if missing).

```csv
timestamp,phase,step,model,effort,outcome,duration_sec
```

**Why no message count:** the rescue skill does not return a token usage figure we can rely on. Duration is the proxy.

**Soft cap warning (pre-spawn):** before spawning Codex at Step 4b or Step 6, count rows in `codex-usage.csv` whose `timestamp` is within the last 5 hours. If the count is greater than 5, print:

> Codex: 5+ calls in last 5h. Consider switching `budget_quality: frugal` for the rest of the session, or take a break.

Do NOT block. Just warn and proceed.

**Outcome values:** `pass`, `fail`, `revise`, `proceed`, `error` (skill failure / setup missing).

**Step is one of:** `4b`, `6`.

---

## AFK mode

Skip human interaction. Proceed on Confident/Likely. STOP on: Unclear, R3, FAIL, CRITICAL/HIGH security, all done.

## Ground rules

- Give paths, never paste file contents into prompts
- Step 4 is inline — never a sub-agent (~7x token waste)
- Sub-agents need explicit `model:` on the Agent call — frontmatter inheritance is not enough
- Auto-debug artifacts (DEBUG.md) are required input for the next cycle — don't skip triggers
- One phase per `/riff:next` call

---
description: The core loop - plan, build, verify the next phase
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
args: "[--plan-only] [phase-number]"
model: opus
---

# /riff:next

Pick the next phase from ROADMAP.yaml, plan it, execute it, review it, open a PR.

**Models:** see [`protocols/MODEL.md`](../protocols/MODEL.md). Parent is forced to Opus via frontmatter. Sub-agents MUST pass `model:` explicitly on the Agent tool call.

**Inline vs sub-agent:** Steps 1–4, 5c, 5d, 5e, 8, 9, 10 run inline. Steps 4b, 4c, 5, 5b, 5f, 6, 7, 7b, 8a spawn sub-agents.

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

Catches drift when a prior phase shipped between sessions, and guarantees Step 2b branches from a clean main. Full procedure: [`protocols/RECONCILE.md`](../protocols/RECONCILE.md) § Step 0.

Sequence:

1. **Session sidecar reset** — clear `.planning/active-phase.txt` and any stale `CRASH.json` files with `verdict: abandoned`.
2. **Active Phase section bootstrap** — ensure STATE.md has one; reset all four fields to `-`.
3. **Switch to main + check divergence (do NOT blindly pull)** — `git fetch`, branch on `ahead`/`behind` state (in-sync / behind-only `pull --ff-only` / ahead-only prompt push-or-skip / diverged STOP and surface).
4. **Merge-wait** (`auto_merge` strategy only — skip for `github_button` and `local_no_ff`).
5. **Stale-todo detection** — for each `status: todo` phase, check whether it shipped: Tier 1 SHA ancestry (`> Merge commit:` line + `git merge-base --is-ancestor`), Tier 2 `gh pr view` (back-fills the SHA), Tier 3 commit-subject grep (legacy). On match: set `status: done`, update STATE.md, commit + push.
6. **Dirty-tree preflight** — `.planning/`-only auto-skips. Anything else prompts `stash and continue | abort`.

### Step 1: Read state (inline)

Read: ROADMAP.yaml, STATE.md, PROJECT.md (skim), previous SUMMARY.md and VERIFICATION.md.

**Read project scope** from `.planning/config.json` → `scope` field. If absent or file missing → default to `production`. Hold this value; it gates Steps 4b, 5b, 6, 7 below.

### Step 2: Pick next phase (inline)

1. Filter `status: todo` phases where all `depends_on` are `done`
2. Sort by `priority` (P0 first)
3. AFK mode → filter to AFK-eligible phases only. **AFK-eligible** = `mode: AFK` OR (`mode: HITL` AND `provider_mode: sandbox`). Production-provider HITL phases (`mode: HITL` with `provider_mode: production` or unset) are skipped. See `commands/loop.md` § HITL vs sandbox-HITL and `agents/planner.md` § `provider_mode`.
4. Last VERIFICATION.md has `FAIL` → don't pick new; create fix plan on existing branch

**Seed check:** scan `.planning/seeds/`. For each seed whose `Trigger:` is met against the picked phase:
- If the seed contains `Pre-approved: yes` near the top (typically `> Pre-approved: yes (approved by <user>, <date>)`) → auto-integrate the seed's `Proposed fix` (or `Idea`) into the current phase's task list as a new task. Do NOT surface to the user. Note the auto-merge in PLAN.md (`Source: seed-NNNN, auto-integrated per pre-approval flag`). The seed file stays in `.planning/seeds/` for traceability — delete it manually if you want a clean folder, or leave it as a record.
- Otherwise → surface the seed to the user (current behavior).
- AFK mode → log only, never block.

**Sandbox-HITL routing:** when picked phase is `mode: HITL` AND `provider_mode: sandbox`, provider verification (OAuth callback, Stripe test checkout, magic-link, email confirmation) routes through [`references/BROWSER-VERIFICATION.md`](../references/BROWSER-VERIFICATION.md). Sandbox / test creds only — never production. Capture screenshots + console transcript under a `## Sandbox verification` block in SUMMARY.md. Driver: headless (Lightpanda) in AFK / `/riff:loop`, chrome-devtools-mcp acceptable in interactive mode. No driver available → AFK pauses with `LOOP_STOP`, interactive prompts `verify manually | install lightpanda | halt` (default verify manually).

### Step 2b: Phase branch (inline)

Before creating the branch, run two preflight checks to detect crash residue from a prior run. Full procedure: [`protocols/RECONCILE.md`](../protocols/RECONCILE.md) § Step 2b.

- **Check 2b-i (existing branch).** If `riff/phase-N-slug` already exists and SUMMARY.md does NOT, prompt delete-or-abort. If SUMMARY.md exists, jump to 2b-ii.
- **Check 2b-ii (partial SUMMARY.md).** If SUMMARY.md exists on a `status: todo` phase without a `> Merge commit:` SHA (or `{{MERGE_COMMIT}}` placeholder), this is a Step 5 crash. If no PLAN.md exists either, delete SUMMARY.md and continue from Step 4. Otherwise prompt Resume / Restart / Abort.

**Resume path (2b-ii A) — control-flow impact on this command:** checkout the existing branch, append a one-line marker to STATE.md `## Open Buckets`, **skip Steps 2c, 3, 4, 4b, 4c**, jump to the active-phase sidecar write below then directly to Step 5.

**Branch creation (skip if Check 2b-ii Resume picked the existing branch):**

```bash
git checkout -b riff/phase-N-slug
```

**Write the active-phase sidecar AND update STATE.md `## Active Phase`:**

```bash
echo "N-slug" > .planning/active-phase.txt
```

Update STATE.md `## Active Phase`:

```markdown
- **Id**: N
- **Slug**: N-slug
- **Branch**: riff/phase-N-slug
- **Step**: 5 (pending)
```

The sidecar is read by `hooks/boundary-check.sh` to identify the active PLAN.md deterministically. STATE.md is the human-readable mirror used by HANDOFF bootstrap. Both are reset to default by Step 0 of the next run AND by Step 8c on `local_no_ff` merge.

### Step 2c: Ensure PROMPTS.md exists (inline)

When entering a phase, ensure `.planning/phases/N-slug/PROMPTS.md` exists. If missing, copy from the framework template:

```bash
mkdir -p .planning/phases/N-slug
[[ ! -f .planning/phases/N-slug/PROMPTS.md ]] && cp .riff/templates/PROMPTS.md .planning/phases/N-slug/PROMPTS.md
[[ ! -f .planning/phases/N-slug/GATES.md ]] && node scripts/gates-update.mjs --init .planning/phases/N-slug
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

0. **Resolve planner_model.** Read the ROADMAP.yaml entry for phase N, extract `planner_model:`, default to `opus` if missing. Canonical rule: `protocols/MODEL.md` § planner_model resolution.
   - `opus` (or missing) → continue inline (steps 1–4 below).
   - `codex` AND `codex` in `executors.available` → print `Run from Codex: $riff:plan {{N}}`, mark loop paused, exit Step 4 without writing PLAN.md.
   - `codex` requested but `codex` NOT in `executors.available` → log one-line warning, fall back to inline Opus.

Inject thinking keyword per MODEL.md § Planner selection.

1. Re-read if not in context: `agents/planner.md` (canonical planning policy: goal-backward, AC rules, HITL/AFK, TDD mode, anti-patterns), `taste.md`, `.planning/expertise/planner.md` (project lessons), previous phase SUMMARY.md. If `.planning/phases/N-slug/PLAN-REVIEW.md` exists (revision cycle from Step 4b), read it and address every `BLOCKER` finding before rewriting PLAN.md.
2. [KEYWORD] Draft the plan. Break into waves. Mark independent tasks with `parallel: [task-A, task-B]` (independent = zero shared files)
3. Write to `.planning/phases/N-slug/PLAN.md`. Do NOT update STATE.md or ROADMAP.yaml
4. Include `## Model Recommendation`: default `executor_model: sonnet`. Recommend `opus` ONLY for novel architecture, 10+ tightly coupled files, unfamiliar external APIs

**Prompt capture:** Step 4 is inline (no sub-agent invoked), so the "prompt" is the orchestrator's self-instruction. Append a short note describing the inputs read and the planning brief into `.planning/phases/N-slug/PROMPTS.md` under the `## Planner` section heading.

---

### Step 4b: Plan adversarial review — sub-agent (gated)

**Skip if `scope: scratch`.** Personal/local apps don't need adversarial plan review.

Runs before execution so the planner can revise BEFORE code is written. Plan-stage fixes cost ~10x less than code-stage fixes.

**Gate:** `plan_adversarial:` from the phase's ROADMAP.yaml entry (`true` | `false` | `auto`; default `auto`).

- `false` → skip (run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate plan-review --status skipped --reason "gate=false"`)
- `true` → run (skip overrides do NOT apply when gate is explicit `true`)
- `auto` → see [`AUTO-TRIGGERS.md#plan-adversarial-auto`](../protocols/AUTO-TRIGGERS.md#plan-adversarial-auto)

**Skip overrides (only when gate resolves to `auto`):** before spawning, check the skip overrides in [`AUTO-TRIGGERS.md#plan-adversarial-auto`](../protocols/AUTO-TRIGGERS.md#plan-adversarial-auto). If any fires, run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate plan-review --status skipped --reason "<reason>"` and continue to Step 5 without spawning Codex.

**Pre-spawn usage check:** see § Codex usage tracking. Soft-cap warning fires if last 5h has >5 Codex calls.

**If running:** Agent tool → skill `codex:codex-rescue`. Run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate plan-review --status pass --reason "model={{MODEL}} effort={{EFFORT}}"` after completion. Append a row to `.planning/codex-usage.csv` (see § Codex usage tracking) with `step=4b`, `outcome=proceed|revise|error`, `duration_sec=<measured>`.

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

Generates a plain-language description of the phase plan for the `/riff:dashboard` view. Audience level + language come from `profile.yaml`. Failure here NEVER blocks the pipeline. Full prompt + level/language resolution: [`protocols/DASHBOARD-EXPLAIN.md`](../protocols/DASHBOARD-EXPLAIN.md) § Step 4c.

**Skip if neither `style.explanation_level` nor `dashboard.level` is set in profile.yaml.**

Agent tool, `model: "haiku"`. Reads PLAN.md + ROADMAP entry, writes `.planning/phases/N-slug/EXPLAIN.{{LEVEL}}.md`.

On error: log a one-line warning and continue.

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

**After the executor sub-agent returns, check for crash residue.** Full procedure (CRASH.json schema + 3 AskUserQuestion sub-cases): [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Executor crash residue.

1. **SUMMARY.md absent** → silent crash. Write `CRASH.json` (`crash_type: executor_silent_exit`, `verdict: pending`). Prompt **Trigger auto-debug** (`failure_type: executor_silent_exit`, `artifact: CRASH.json`) / **Resume manually** (halt, Step 0 detects partial state on next run) / **Abort** (set `verdict: abandoned`, STATE.md `## Active Phase` Step → `CRASHED`).
2. **SUMMARY.md exists with `FAILED` / `ERROR` / `unresolved`** → auto-debug with `failure_type: executor_fail`, `artifact: SUMMARY.md`.
3. **Successful completion** (incl. after auto-debug RESOLVED) → `rm -f .planning/phases/N-slug/CRASH.json`.

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

**Agent:** Agent tool, model: haiku. Prompt: _"Read agents/scope-checker.md. Branch: riff/phase-N-slug. Read .planning/phases/N-slug/PLAN.md and SUMMARY.md. Diff task lists. Write `.planning/phases/N-slug/SCOPE-CHECK.json` per the schema in scope-checker.md. Return nothing to stdout."_

**Read the verdict from SCOPE-CHECK.json:**

1. Read `.planning/phases/N-slug/SCOPE-CHECK.json`.
2. If file absent → treat as `MALFORMED` with reason `"file not written"`.
3. If invalid JSON → treat as `MALFORMED` with reason `"invalid JSON"`.
4. If `schema_version` is neither `1` nor `2` → surface mismatch to user, halt. (`1` = legacy plans pre-Smoke contract, `2` = current.)
5. Branch on the `verdict` field.

**On `MATCH`:** proceed to Step 5d.

**On `DROPPED`:** STOP. Triage in three buckets, in order:

1. **Task drops (`unmatched_tasks` non-empty).** For each, AskUserQuestion: "completed (mark done in SUMMARY)" | "defer to new phase (will run /riff:add-phase)" | "rejected (write rationale)". Apply each choice, then re-run Step 5c.
2. **Smoke section too thin or missing (`smoke_too_thin == true` OR `planned_smokes` empty on a non-legacy plan).** Surface to user with the modified files list. AskUserQuestion: "ask the planner to expand Smoke section (re-run Step 4 with this finding)" | "skip this gate (run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate scope-check --status skipped --reason "override"`)". On expand → re-run Step 4 inline with the missing-smoke finding as input, then re-run Step 5c.
3. **Smoke regressions or missing results (`failed_smokes` non-empty OR `unmatched_smokes` non-empty).** For each entry, surface command + observed output (for `failed_smokes`) or "no result row in SUMMARY.md" (for `unmatched_smokes`). AskUserQuestion: "auto-debug (treat as failure_type=smoke_fail, artifact=SCOPE-CHECK.json)" | "fix manually now, then re-run Step 5c" | "skip this gate (run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate scope-check --status skipped --reason "override"`)". On auto-debug → trigger the auto-debug pattern, on RESOLVED re-run Step 5c.

Loop until `verdict == MATCH`. **Max 3 cycles per bucket**, then STOP and escalate to user with both SCOPE-CHECK.json and PLAN.md, ask whether to skip the remaining gate (run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate scope-check --status skipped --reason "override"`) or halt for manual fix.

**On `MALFORMED`:** surface `malformed_reason` to user, ask whether to skip (acceptable for unstructured PLAN.md formats) or fix the format and retry.

---

### Step 5d: Fallow audit — inline (gated)

**Skip if `scope: scratch`.** Personal/local code doesn't need a codebase-intelligence pass.

**Skip if not a TS/JS project.** Detection: `package.json` exists at project root. If absent, run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate fallow --status skipped --reason "not TS/JS"` and continue to Step 5e.

Mechanical codebase intelligence on the phase diff via [`fallow`](https://github.com/fallow-rs/fallow): dead code, duplication, complexity, boundary violations. Sub-second, deterministic, no LLM. Replaces what the simplifier used to check mechanically.

**Run (inline — fallow is itself the analyzer, no sub-agent needed):**

1. Detect package manager runner: `pnpm-lock.yaml` → `pnpm exec`, `bun.lock` → `bunx`, `yarn.lock` → `yarn`, otherwise `npx`.
2. Run: `<runner> fallow audit --changed-since main --format json > .planning/phases/N-slug/FALLOW.json`
3. Parse the `verdict` field: `pass` | `warn` | `fail`.

**Behavior (initial integration — fail-on-fail only, warn does not block):**

- `pass` → run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate fallow --status pass`. Continue.
- `warn` → run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate fallow --status warn --reason "<count> findings"`. Continue. Include the count in Step 10 report.
- `fail` → STOP. Surface the findings to the user via AskUserQuestion:
  - **Fix in place** — re-run the executor with FALLOW.json as additional input, then re-run Step 5d. Max 2 cycles, then escalate.
  - **Mark as accepted exception** — run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate fallow --status pass --reason "accepted-exception: <reason>"` and continue.
  - **Skip this gate** — one-time override, run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate fallow --status skipped --reason "override"` and continue.

**On `command not found` (fallow not installed):** run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate fallow --status skipped --reason "fallow not installed"` and continue. Don't block. Projects predating this integration won't have fallow as a devDep; `/riff:start` adds it for new TS/JS production projects.

**On other non-zero exit (runtime error):** surface stderr to the user, AskUserQuestion `skip and continue | halt`. Default skip on no answer.

---

### Step 5e: Smoke test browser — inline (gated)

Boot the dev server, load every route touched by the phase diff in a headless browser, capture HTTP status + console errors/warnings. Catches "compiles green but blows up at boot" regressions. Full pipeline (detect runner, port selection, route derivation, SMOKE.json schema) + skip conditions table + installation: [`references/SMOKE-TEST.md`](../references/SMOKE-TEST.md).

**Skip conditions** (all log via `gates-update.mjs --gate smoke --status skipped --reason "<reason>"`):
- `scope: scratch`
- No `package.json` at project root → reason `not TS/JS`
- `smoke_test: true` not set on the phase's ROADMAP.yaml entry → reason `smoke_test not enabled` (gate is **opt-in**)
- Neither Lightpanda nor `chrome-devtools-mcp` on PATH → reason `lightpanda not installed`
- No `dev` / `start` script in `package.json` → reason `no dev/start script`
- Zero routes derivable from the diff → reason `no routes in diff`

**Run inline** (no sub-agent). Output: `.planning/phases/N-slug/SMOKE.json`.

**Verdict behavior:**

- `pass` → gate `pass`, continue.
- `warn` → gate `warn` with finding count, continue, count surfaced in Step 10 report.
- `fail` → STOP. Surface failing routes (URL, status, first console error). Prompt **Fix in place** (re-run executor with SMOKE.json input, max 2 cycles then escalate) / **Accepted exception** (`status: pass --reason "accepted-exception: <reason>"`) / **One-time override** (`status: skipped --reason "override"`).

**On runtime error** (dev server won't boot, port conflict on all candidates, browser binary crashes mid-run): always kill the dev server PID first, then surface stderr and AskUserQuestion `skip and continue | halt`. Default skip on no answer.

---

### Step 5f: Post-mortem explanation — sub-agent (always, fail-silent)

Generates a plain-language post-mortem of what was built, with a metadata block, for the `/riff:dashboard` view. Failure NEVER blocks the pipeline. Full prompt + style rules: [`protocols/DASHBOARD-EXPLAIN.md`](../protocols/DASHBOARD-EXPLAIN.md) § Step 5f.

**Skip if `dashboard:` section is missing from profile.yaml.**

**Compute metadata before spawning:**
- `DURATION` = SUMMARY.md `{{DURATION}}` field (or wall-clock from first/last commit timestamps if missing)
- `FILES_STAT` = `git diff --stat main...HEAD | tail -1`
- `GATES_SUMMARY` = `node scripts/gates-update.mjs --summarize .planning/phases/N-slug` (empty string if file does not exist)

Agent tool, `model: "haiku"`. Reads SUMMARY.md + optional PLAN-REVIEW/REFACTOR/VERIFICATION, writes `.planning/phases/N-slug/EXPLAIN-POST.{{LEVEL}}.md` (prose + verbatim metadata block).

On error: log a one-line warning and continue.

---

### Steps 6 + 7: Adversarial + Security — IN PARALLEL

**Skip BOTH if `scope: scratch`.** Personal/local apps don't run adversarial review or security-reviewer. Jump to Step 8 (PR creation). Belt-and-suspenders: security-reviewer.md also self-skips when scope=scratch in case it's invoked manually.

Launch BOTH in a single message.

**Step 6 (Adversarial — Codex):** Agent tool → skill `codex:codex-rescue`.

**Gate:** `adversarial:` from the phase's ROADMAP.yaml entry (`true` | `false` | `auto`; default `auto`).

- `false` → skip (run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate code-review --status skipped --reason "gate=false"`)
- `true` → run (skip overrides do NOT apply when gate is explicit `true`)
- `auto` → see [`AUTO-TRIGGERS.md#adversarial-auto`](../protocols/AUTO-TRIGGERS.md#adversarial-auto)

**Skip overrides (only when gate resolves to `auto`):** before spawning, check the skip overrides in [`AUTO-TRIGGERS.md#adversarial-auto`](../protocols/AUTO-TRIGGERS.md#adversarial-auto). If any fires, run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate code-review --status skipped --reason "<reason>"` and continue without spawning Codex (security review still runs in parallel).

**Resolve model + effort** per [`protocols/MODEL.md`](../protocols/MODEL.md) § Codex model + effort. Defaults by `budget_quality`: `frugal` → `gpt-5.4-mini minimal`; `balanced` → `gpt-5.4 medium`; `max` → `gpt-5.5 medium`. Per-phase `codex_model:` / `codex_effort:` override.

**Resolve `risk_focus`** from the phase's ROADMAP.yaml entry (optional, free text, e.g. `"concurrency, idempotency"`). When set, append the targeted clause to the prompt below.

**Pre-spawn usage check:** see § Codex usage tracking. Soft-cap warning fires if last 5h has >5 Codex calls.

**If running:** prompt includes phase goal (one line), branch, instruction _"Run with `--model {{MODEL}} --effort {{EFFORT}}`. Read `agents/adversarial-reviewer.md` for the review contract (severity scale, what to skip, output format). Run `git diff main...HEAD`. Run `npx vitest run` and `npx tsc --noEmit`. Review the diff for: logic bugs, race conditions, edge cases, missing error handling, off-by-one, incorrect assumptions. Write `.planning/phases/N-slug/REVIEW.md` with PASS/FAIL verdict per the agent spec."_ If `risk_focus` is set, append to the prompt: _"Pressure-test these specific risks first: {{RISK_FOCUS}}. Any other material findings still report, but lead with these."_ Run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate code-review --status pass --reason "model={{MODEL}} effort={{EFFORT}}"` after completion. Append a row to `.planning/codex-usage.csv` (see § Codex usage tracking) with `step=6`, `outcome=pass|fail|error`, `duration_sec=<measured>`.

**Prompt capture:** After launching the adversarial-reviewer (Codex) sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under the `## Adversarial reviewer (Codex)` section heading.

- Auto-debug on FAIL → `failure_type: adversarial_fail`, `artifact: REVIEW.md`. On RESOLVED, re-run Step 6.

**Step 7 (Security — Sonnet):** Agent tool, `model: "sonnet"`. Thinking keyword per MODEL.md § Security selection. Prompt: `[KEYWORD]`, phase goal, instruction _"Read `agents/security-reviewer.md`. Run `git diff main...HEAD`. Read SUMMARY.md. OWASP scan on all changed files. Write `.planning/phases/N-slug/SECURITY.md` per the File Output section of the agent spec (frontmatter `verdict: PASS | PASS-WITH-WARNINGS | BLOCKED`). CRITICAL/HIGH → `BLOCKED`."_

**Prompt capture:** After launching the security-reviewer sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under the `## Security reviewer` section heading.

**Reading the verdict back:**

1. Read `.planning/phases/N-slug/SECURITY.md`.
2. Parse the `verdict` field from the frontmatter.
3. If `verdict: BLOCKED`, also confirm via grep: `grep -E '^### \[(CRITICAL|HIGH)\]' SECURITY.md` returns a non-empty match. If frontmatter and grep disagree, treat as BLOCKED (defensive).
4. If SECURITY.md is absent after the sub-agent returns: treat as `failure_type: security_silent_exit`, `artifact: "SECURITY.md not written"`. Trigger auto-debug.

- Auto-debug on `verdict: BLOCKED` → `failure_type: security_fail`, `artifact: SECURITY.md`. On RESOLVED, re-run Step 7 (security-reviewer overwrites SECURITY.md, populating the `## Resolved Findings` table per its idempotency contract).

**Wait for BOTH.** If security CRITICAL/HIGH or adversarial FAIL → do NOT create PR.

### Step 7b: Improver — sub-agent (background, gated)

**Gate:** skip by default. See [`AUTO-TRIGGERS.md#improver-heuristic`](../protocols/AUTO-TRIGGERS.md#improver-heuristic) for run conditions.

**If running:** Agent tool, `model: "haiku"`, `run_in_background: true`.

Prompt: _"Read `agents/improver.md`. Read `.planning/phases/N-slug/SUMMARY.md` and `.planning/expertise/` files. Write learnings to `.planning/expertise/.pending/` if any. Do not auto-merge. Use Context7 or Ref MCP for recent libs. As your final act before returning, write the completion sentinel `.planning/expertise/.pending/.improver-N-slug.done` per the agent spec — this lets Step 10 distinguish 'completed with no findings' from 'killed mid-write'."_

---

### Step 8: Create PR (inline)

Do NOT update ROADMAP.yaml or STATE.md on the feature branch. Full procedure: [`protocols/PR-CREATION.md`](../protocols/PR-CREATION.md).

- **8a Documentation + README check (BLOCKING).** Compare SUMMARY.md against `.claude/references/project-details.md`, `docs/architecture.md`, `taste.md`. Stale → spawn Haiku to update before PR. If `README.md` is absent at project root, write one (seed from PROJECT.md or CLAUDE.md, per `start.md` Stage 5 production spec) before proceeding.
- **8b Push + PR.** `git push -u`, compose PR body (human summary + `riff-pr-metadata.sh <phase-id>` stdout), finalize PROMPTS.md (replace any leftover `{{prompt verbatim}}` placeholders with `_(not invoked)_`, else metadata script hard-fails), `PR_URL=$(gh pr create ...)`. Then branch on `profile.yaml` `git.merge_strategy` (default `github_button`):
  - **`github_button`** → print report ending `PR open at $PR_URL. Click Merge on GitHub when ready.` STOP, skip 8c. Step 0 of next run reconciles.
  - **`local_no_ff`** → print report ending `Review on GitHub, then tell me 'merge'.` Stay alive, run 8c on user's "merge" cue.
  - **`auto_merge`** (AFK) → blocking-label check, re-verify gates (read-only grep on SECURITY.md + jq on SCOPE-CHECK.json), `gh pr merge "$PR_URL" --auto --squash --delete-branch`, STOP, skip 8c.
- **8c Update state after merge.** Only fires on `local_no_ff`. Checkout main, `pull --ff-only`, `merge --no-ff`, capture merge SHA into `SUMMARY.md` `> Merge commit:` line, clear sidecars (`.planning/active-phase.txt` + STATE.md `## Active Phase`), update ROADMAP.yaml + STATE.md, commit + push, delete branches.

### Step 9: Learn (inline)

- Taste proposals: new pattern → append to taste.md with `<!-- PENDING -->`
- Seeds: check `.planning/seeds/` triggers

### Step 10: Report + usage (inline)

Collect `total_tokens`, `tool_uses`, `duration_ms` from each Agent result.

Write `.planning/phases/N-slug/USAGE.md` using **`templates/usage.md`**.

`PROMPTS.md` is a sibling phase artifact (alongside USAGE.md, PLAN.md, SUMMARY.md, GATES.md) — it was seeded at Step 2c and appended to throughout Steps 4, 4b, 5, 5b, 6, 7, and the auto-debug pattern. Both USAGE.md and PROMPTS.md are read by `riff-pr-metadata.sh` at Step 8 to enrich the PR body with token usage and substantive sub-agent prompts.

Append a row to `.planning/usage-log.csv` via `.riff/scripts/csv-append.sh` (flock-protected, child-bash invocation). Orchestrator owns the header on first append. Full schema + invocation: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Usage CSV logging.

Print:

```
Phase N: {{TITLE}} - {{VERDICT}}
Built: {{artifacts}}
Security: {{PASS/issues}}
Usage: {{total_tokens}}k tokens, {{duration}}min
Next: Phase {{N+1}}: {{NEXT_TITLE}}
```

### Pending expertise review (inline)

If `.planning/expertise/.pending/*.md` is non-empty, prompt **Review now / Defer to next phase / Reject all**. Full procedure: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Pending expertise review.

**Review now** walks each pattern and classifies it into one of three tiers, then prompts Accept / Reject / Edit / Re-tier per pattern:

- **Stack** → framework `references/taste/stacks/<stack>.md` (Drizzle, Zod, RR7, etc. — any project using the stack benefits).
- **Architecture** → framework `references/taste/{architecture,security,backend,testing}.md` (multi-tenant rules, design principles, security patterns).
- **Project** → `.planning/expertise/<agent>.md` or project `taste.md` (paths, provider quirks, domain-specific).

Default to **Project** tier when unsure. Over-promotion bloats framework references for all users.

**Improver completion check (only if Step 7b ran):** look for sentinel `.planning/expertise/.pending/.improver-N-slug.done`. If absent, warn once. Remove the sentinel when the review loop completes.

Report at end: `Reviewed: M accepted (stack/arch/project breakdown), K rejected, E edited, D deferred.`

### Milestone deep audit prompt (inline)

After Step 10, if the just-completed phase has a `milestone:` tag in ROADMAP.yaml, prompt **Run now** (load [`protocols/DEEP-AUDIT.md`](../protocols/DEEP-AUDIT.md) and execute inline, spawns deep-auditor via `codex:codex-rescue`) / **Defer** (run conversationally with "deep audit" anytime). Skip silently if `codex:codex-rescue` skill is not configured.

---

## Session checkpoints

10 steps / parent session → past 200k fast for non-trivial phases. Sub-agent returns + inline reads + status updates accumulate. Past 200k = hallucination risk up. See `CLAUDE.md` § Context budget + [`protocols/HANDOFF.md`](../protocols/HANDOFF.md).

3 break points (parent flush via `/clear`, resume from disk):

| Checkpoint | Triggered after | Bootstrap reads |
|---|---|---|
| **next-A** Plan validated | Step 4b PROCEED on PLAN-REVIEW.md | PLAN.md, PLAN-REVIEW.md, ROADMAP entry |
| **next-B** Code shipped | Step 5 SUMMARY.md, tests green | SUMMARY.md, `git diff main...HEAD`, PLAN.md |
| **next-C** Review passed | Step 7 PASS / RESOLVED via debugger | SUMMARY.md, REVIEW.md, SECURITY.md, DEBUG.md if any, AUTHORIZATION-MATRIX.md if any |

Close of checkpoint → eval heuristic in [`protocols/HANDOFF.md`](../protocols/HANDOFF.md) § Trigger. 2+ fire →

1. Finish step. Write artifact.
2. Update STATE.md per HANDOFF.md § STATE.md contract — Active Decisions, Open Buckets, Files to bootstrap, Resume Command.
3. Surface: `Context at NNNk, M heuristics fired. /clear + reopen at checkpoint X with: continue /riff:next at Step Y for phase N-slug. Read STATE.md.`

Mid-step checkpoint = no. Sub-agent lands artifact before parent flush.

Phases < 25 files / 4 sub-agent passes = single-session default. Checkpoint for 50+ file phases.

---

## Auto-debug pattern

Shared by Steps 5, 6, 7. Skip if `auto_debug: false`. Full procedure: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Auto-debug pattern.

**Model:** `opus` (or `sonnet` if `debug_model: sonnet`).

**Trigger contract** (used by originating step): spawn debugger sub-agent with `failure_type` + failure `artifact` path, branch `riff/phase-N-slug`. Debugger writes `.planning/phases/N-slug/DEBUG.md` and the originating step appends its prompt capture to `PROMPTS.md` under `## Debugger (if invoked)`.

**After completion:**

- `RESOLVED` → re-run the originating step. **Exception**: skip the re-run if debugger ran with `opus`, DEBUG.md's verification block reports tests green + tsc clean, AND every finding in the originating artifact has a corresponding pinning test. Surface in Step 10 as `Re-run skipped: RESOLVED with pinning tests`.
- `UNRESOLVED` → halt, surface DEBUG.md to user.

---

## Codex usage tracking

Every Codex call (Step 4b, Step 6) appends a row to `.planning/codex-usage.csv` (Plus-quota awareness counter, not billing). Full schema + helper invocation: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Codex usage tracking.

CSV header (orchestrator owns it on first append, helper does row-only appends thereafter):

```csv
timestamp,phase,step,model,effort,outcome,duration_sec
```

**Soft cap warning (pre-spawn at Step 4b / Step 6):** if last 5h has >5 Codex calls, print `Codex: 5+ calls in last 5h. Consider switching budget_quality: frugal for the rest of the session, or take a break.` Do NOT block.

**Outcome values:** `pass`, `fail`, `revise`, `proceed`, `error`. **Step:** `4b` or `6`.

---

## AFK mode

Skip human interaction. Proceed on Confident/Likely. STOP on: Unclear, R3, FAIL, CRITICAL/HIGH security, all done.

When the active phase is sandbox-HITL (`mode: HITL` AND `provider_mode: sandbox`), AFK mode does NOT pause for provider verification — it routes through the browser verification protocol (`references/BROWSER-VERIFICATION.md`) with a headless driver (Lightpanda). See Step 2 § Sandbox-HITL routing for the contract (driver choice, sandbox-only creds, evidence capture, fallback). If routing is impossible, write a `LOOP_STOP` line and pause; never silently skip the verification.

## Ground rules

- Give paths, never paste file contents into prompts
- Step 4 is inline — never a sub-agent (~7x token waste)
- Sub-agents need explicit `model:` on the Agent call — frontmatter inheritance is not enough
- Auto-debug artifacts (DEBUG.md) are required input for the next cycle — don't skip triggers
- One phase per `/riff:next` call
- **Do not stop and ask "should I continue?" between steps.** The user invoked the pipeline; flow through every step until either (a) a gate fires (REVISE / DROPPED / fail / FAILED / executor crash), (b) an `AskUserQuestion` block in the step spec explicitly requires HITL input, or (c) the phase reaches Step 10 (final SUMMARY). Successful gate transitions (PROCEED, MATCH, pass, RESOLVED) are not checkpoints. Mid-pipeline "want me to continue?" prompts are a defect, not caution.

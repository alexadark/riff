---
description: The core loop - plan, build, verify the next phase
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
args: "[--plan-only] [phase-number]"
model: opus
---

# /riff:next

Pick the next phase from ROADMAP.yaml, plan it, execute it, review it, open a PR.

**Models:** [`protocols/MODEL.md`](../protocols/MODEL.md). Parent is forced to Opus via frontmatter. Sub-agents MUST pass `model:` explicitly on the Agent call.

**Auto-gate heuristics:** [`protocols/AUTO-TRIGGERS.md`](../protocols/AUTO-TRIGGERS.md). Design rationale: [`DECISIONS.md`](../DECISIONS.md) (D25–D27).

**Interactive questions:** every `AskUserQuestion` follows the resolved `explanation_level` (`simple`/`eli5` → plain words, user-flow framing, drop framework jargon). See [`references/EXPLANATION-LEVEL.md`](../references/EXPLANATION-LEVEL.md) § Interactive questions.

**Scope gating:** all references to "skip if `scope: scratch`" below mean: personal/local scripts skip adversarial/security/simplifier/fallow/smoke gates entirely. Scope resolved in Step 1.

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
4. **Stale-todo detection** — for each `status: todo` phase, check whether it shipped: Tier 1 SHA ancestry (`> Merge commit:` line + `git merge-base --is-ancestor`), Tier 2 `gh pr view` (back-fills the SHA), Tier 3 commit-subject grep (legacy). On match: set `status: done`, update STATE.md, commit + push.
5. **Dirty-tree preflight** — `.planning/`-only auto-skips. Anything else prompts `stash and continue | abort`.

### Step 1: Read state (inline)

Read: ROADMAP.yaml, STATE.md, PROJECT.md (skim), previous SUMMARY.md and VERIFICATION.md.

**Read project scope** from `.planning/config.json` → `scope` field. If absent or file missing → default to `production`. Hold this value; it gates Steps 4b, 5b, 6, 7 below.

### Step 2: Pick next phase (inline)

1. Filter `status: todo` phases where all `depends_on` are `done`.
2. Sort by `priority` (P0 first).
3. Last VERIFICATION.md has `FAIL` → don't pick new; create fix plan on existing branch.

**Seed check:** scan `.planning/seeds/`. For each seed whose `Trigger:` is met against the picked phase:
- If the seed contains `Pre-approved: yes` near the top (typically `> Pre-approved: yes (approved by <user>, <date>)`) → auto-integrate the seed's `Proposed fix` (or `Idea`) into the current phase's task list as a new task. Do NOT surface to the user. Note the auto-merge in PLAN.md (`Source: seed-NNNN, auto-integrated per pre-approval flag`). The seed file stays in `.planning/seeds/` for traceability.
- Otherwise → surface the seed to the user.

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

Sidecar read by `hooks/boundary-check.sh` to identify the active PLAN.md. STATE.md is the human-readable mirror used by HANDOFF bootstrap. Both reset by Step 0 of next run AND by Step 8c on `local_no_ff` merge.

### Step 2c: Ensure PROMPTS.md exists (inline)

Seed `.planning/phases/N-slug/PROMPTS.md` from `.riff/templates/PROMPTS.md` if missing, init `GATES.md` via `node scripts/gates-update.mjs --init` if missing:

```bash
mkdir -p .planning/phases/N-slug
[[ ! -f .planning/phases/N-slug/PROMPTS.md ]] && cp .riff/templates/PROMPTS.md .planning/phases/N-slug/PROMPTS.md
[[ ! -f .planning/phases/N-slug/GATES.md ]] && node scripts/gates-update.mjs --init .planning/phases/N-slug
```

PROMPTS.md captures substantive sub-agent prompts (Steps 4, 4b, 5, 5b, 6, 7, auto-debug). It is included in the PR body only when `metadata.pr_body: full`. Convention (what to keep vs drop, finalize-on-PR rules): [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Prompt capture convention.

### Step 3: Confidence gate (inline)

See `protocols/EXECUTION.md` § Confidence Gate. Any dimension < 0.7 → STOP.

---

### Step 4: Plan — INLINE

Parent has read state + ROADMAP + previous SUMMARY. Do NOT spawn a sub-agent. Inject thinking keyword per MODEL.md § Planner selection.

0. **Resolve planner_model** from ROADMAP entry (`opus` default).
   - `opus` or missing → continue inline.
   - `codex` AND `codex` in `executors.available` → print `Run from Codex: node .riff/scripts/riff-codex.mjs plan --phase {{N}} --run`, mark loop paused, exit without writing PLAN.md.
   - `codex` requested but absent from `executors.available` → log warning, fall back to inline Opus.
1. Re-read if not in context: `agents/planner.md` (goal-backward, AC rules, HITL/AFK, TDD mode, anti-patterns), `taste.md`, `.planning/expertise/planner.md`, previous SUMMARY.md. If PLAN-REVIEW.md exists (revision cycle), read it and address every `BLOCKER` before rewriting PLAN.md.
2. [KEYWORD] Draft the plan. Break into waves. Mark independent tasks `parallel: [task-A, task-B]` (independent = zero shared files).
3. Write PLAN.md. Do NOT update STATE.md or ROADMAP.yaml.
4. Include `## Model Recommendation`: default `executor_model: codex`. Recommend `sonnet` only when Codex is unavailable or a phase needs Claude-specific tools; recommend `opus` ONLY for novel architecture, 10+ tightly coupled files, unfamiliar external APIs.

**Prompt capture:** one-line note of inputs + brief → PROMPTS.md § Planner (inline — no sub-agent).

---

### Step 4b: Plan adversarial review — sub-agent (gated)

**Skip if `scope: scratch`.** Runs before execution so the planner can revise before code is written (plan-stage fixes cost ~10x less than code-stage).

**Gate:** `plan_adversarial:` from the phase's ROADMAP.yaml entry. `false` → skip. `true` → always run (skip overrides ignored). `auto` (default) → check [`AUTO-TRIGGERS.md#plan-adversarial-auto`](../protocols/AUTO-TRIGGERS.md#plan-adversarial-auto) skip overrides; if any fires, log `gates-update.mjs --gate plan-review --status skipped --reason "<reason>"` and continue.

**Model + effort** per [`protocols/MODEL.md`](../protocols/MODEL.md) § Codex model + effort. Default Step 4b: `gpt-5.5 medium`. Per-phase `codex_model:` / `codex_effort:` override.

**`risk_focus`** from phase ROADMAP entry (optional free text, e.g. `"concurrency, idempotency"`). When set, append to prompt: _"Pressure-test these specific risks first: {{RISK_FOCUS}}. Any other material findings still report, but lead with these."_

**Pre-spawn:** soft-cap warning (see § Codex usage tracking) if >5 Codex calls in last 5h.

**If running:** Agent tool → skill `codex:codex-rescue`. Prompt: phase goal (one line), branch, _"Run with `--model {{MODEL}} --effort {{EFFORT}}`. Read `agents/plan-adversarial-reviewer.md`. Read PLAN.md, PROJECT.md, ROADMAP entry for phase N, and `taste.md` sections relevant to the phase surface. Apply the protocol. Write PLAN-REVIEW.md with PROCEED or REVISE verdict."_

**Post-completion:** `gates-update.mjs --gate plan-review --status pass --reason "model={{MODEL}} effort={{EFFORT}}"`. Append row to `.planning/codex-usage.csv` (step=4b, outcome=proceed|revise|error, duration_sec).

**Prompt capture:** PROMPTS.md § Plan adversarial reviewer (Codex). Keep distinct from § Adversarial reviewer (Codex) if both Steps 4b and 6 ran.

**On REVISE:** surface Findings section to user. Re-run Step 4 inline with PLAN-REVIEW.md input — planner addresses each `BLOCKER`, optionally `WARNING`/`NOTE`, rewrites PLAN.md in place. Re-run Step 4b. Loop until PROCEED. Max 2 cycles, then STOP and escalate.

**On PROCEED:** continue.

---

### Step 4c: Pre-exec explanation — sub-agent (always, fail-silent)

Plain-language description of the plan for `/riff:dashboard`. Level + language from `profile.yaml`. Never blocks the pipeline. Full prompt + resolution: [`protocols/DASHBOARD-EXPLAIN.md`](../protocols/DASHBOARD-EXPLAIN.md) § Step 4c.

**Skip if** neither `style.explanation_level` nor `dashboard.level` is set in profile.yaml.

Agent tool, `model: "haiku"`. Reads PLAN.md + ROADMAP entry, writes `EXPLAIN.{{LEVEL}}.md`. On error: log a one-line warning, continue.

If `--plan-only`: STOP here. PLAN.md, PLAN-REVIEW.md, EXPLAIN.{{LEVEL}}.md are the deliverables.

---

### Step 5: Execute

**Runtime resolution:** see [`protocols/MODEL.md`](../protocols/MODEL.md) § Executor runtime resolution. Default: **Codex** (via `codex:codex-rescue` in-process). Falls back to Claude sub-agent (Sonnet) when `executor_model: sonnet` or `codex` not in `executors.available`.

**Thinking:** none by default, `think hard` if `complex_execution: true`. **Parallel tasks** marked `parallel:` MUST launch as separate sub-agents in a single message; sequential tasks stay inline within the executor.

#### Route A: Codex executor (default)

Invoke `codex:codex-rescue` with the configured execution skill (profile.yaml `codex.execution_skill`). Prompt uses CODEX-DELEGATION Template B (solo) or Template C (solo-strict when `complex_execution: true`):
- Branch: `riff/phase-N-slug`
- PLAN.md path: `.planning/phases/N-slug/PLAN.md`
- Model + effort: resolved per MODEL.md § Codex model + effort

Record `phase_base_sha: $(git rev-parse HEAD)` in STATE.md before invocation.

#### Route B: Claude sub-agent (fallback)

Agent prompt (give paths, do NOT paste file contents):
- Branch: `riff/phase-N-slug`
- Read: PLAN.md, `taste.md`, `.planning/expertise/executor.md`, `CLAUDE.md`
- Instruction: _"FIRST: verify branch `riff/phase-N-slug`. Read PLAN.md and execute all tasks. For `parallel:` tasks, launch separate sub-agents in a single message. Commit after each task (conventional format, stage explicitly). Write SUMMARY.md."_

**Prompt capture:** PROMPTS.md § Executor.

**After the executor sub-agent returns, check for crash residue.** Full procedure (CRASH.json schema + 3 AskUserQuestion sub-cases): [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Executor crash residue.

1. **SUMMARY.md absent** → silent crash. Write `CRASH.json` (`crash_type: executor_silent_exit`, `verdict: pending`). Prompt **Trigger auto-debug** (`failure_type: executor_silent_exit`, `artifact: CRASH.json`) / **Resume manually** (halt, Step 0 detects partial state on next run) / **Abort** (set `verdict: abandoned`, STATE.md `## Active Phase` Step → `CRASHED`).
2. **SUMMARY.md exists with `FAILED` / `ERROR` / `unresolved`** → auto-debug with `failure_type: executor_fail`, `artifact: SUMMARY.md`.
3. **Successful completion** (incl. after auto-debug RESOLVED) → `rm -f .planning/phases/N-slug/CRASH.json`.

---

### Step 5b: Simplify — sub-agent (gated)

**Skip if `scope: scratch`.** Runs before review so reviewers audit simplified code.

**Gate:** `simplify:` from phase ROADMAP entry. `false` → skip. `true` → always run. `auto` (default) → [`AUTO-TRIGGERS.md#simplifier-auto`](../protocols/AUTO-TRIGGERS.md#simplifier-auto).

**If running:** Agent tool, `model: "haiku"`. Prompt: branch, phase N-slug, _"Read `agents/simplifier.md`. Scope: diff of `riff/phase-N-slug` against main only. Apply the protocol. Write REFACTOR.md. Commit simplifications as separate `refactor(phase-N): ...` commits, staging explicitly."_

**Prompt capture:** PROMPTS.md § Simplifier (append the section if absent in template).

---

### Step 5c: Scope check — mechanical (inline)

Before review, verify executor honored the plan. Source of truth: [`protocols/SCOPE-CHECK.md`](../protocols/SCOPE-CHECK.md). Do not spawn a sub-agent by default.

Run:

```bash
node .riff/scripts/scope-check.mjs --phase .planning/phases/N-slug
```

The script writes `.planning/phases/N-slug/SCOPE-CHECK.json` and exits non-zero unless the verdict is `MATCH`.

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

Mechanical codebase intelligence on the phase diff via [`fallow`](https://github.com/fallow-rs/fallow): dead code, duplication, complexity, boundary violations. Sub-second, deterministic, no LLM.

**Skip conditions** (all log via `gates-update.mjs --gate fallow --status skipped --reason "<reason>"`):
- `scope: scratch`
- No `package.json` at project root → reason `not TS/JS`
- `command -v fallow` fails → reason `fallow not installed` (`/riff:start` adds it as devDep for new TS/JS production projects)

**Run inline:**
1. Detect runner: `pnpm-lock.yaml` → `pnpm exec`, `bun.lock` → `bunx`, `yarn.lock` → `yarn`, otherwise `npx`.
2. `<runner> fallow audit --changed-since main --format json > .planning/phases/N-slug/FALLOW.json`
3. Parse `verdict`: `pass` | `warn` | `fail`.

**Verdict behavior** (fail-on-fail only, warn does not block):
- `pass` → gate `pass`, continue.
- `warn` → gate `warn` with count, continue, surfaced in Step 10 report.
- `fail` → STOP. Prompt **Fix in place** (re-run executor with FALLOW.json input, max 2 cycles) / **Accepted exception** (`status: pass --reason "accepted-exception: <reason>"`) / **One-time override** (`status: skipped --reason "override"`).

**Runtime error** (non-zero exit other than `command not found`): surface stderr, AskUserQuestion `skip and continue | halt`. Default skip on no answer.

---

### Step 5e: Smoke test browser — inline (gated)

Boot the dev server, load every route touched by the phase diff in a headless browser, capture HTTP status + console errors/warnings. Catches "compiles green but blows up at boot" regressions. Full pipeline (detect runner, port selection, route derivation, SMOKE.json schema) + skip conditions table + installation: [`protocols/BROWSER-CHECK.md § Runtime Smoke Test`](../protocols/BROWSER-CHECK.md#runtime-smoke-test-step-5e).

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

Plain-language post-mortem of what was built + metadata block, for `/riff:dashboard`. Never blocks the pipeline. Full prompt + style rules: [`protocols/DASHBOARD-EXPLAIN.md`](../protocols/DASHBOARD-EXPLAIN.md) § Step 5f.

**Skip if** `dashboard:` is missing from profile.yaml.

**Compute metadata before spawning:**
- `DURATION` = SUMMARY.md `{{DURATION}}` (or wall-clock from first/last commit timestamps if missing)
- `FILES_STAT` = `git diff --stat main...HEAD | tail -1`
- `GATES_SUMMARY` = `node scripts/gates-update.mjs --summarize .planning/phases/N-slug` (empty string if file missing)

Agent tool, `model: "haiku"`. Reads SUMMARY.md + optional PLAN-REVIEW/REFACTOR/VERIFICATION, writes `EXPLAIN-POST.{{LEVEL}}.md` (prose + verbatim metadata block). On error: log warning, continue.

---

### Steps 6 + 7: Adversarial + Security — IN PARALLEL

**Skip BOTH if `scope: scratch`** — jump to Step 8. Launch both in a single message.

**Step 6 (Adversarial — Codex):** Agent tool → skill `codex:codex-rescue`.

**Gate:** `adversarial:` from the phase's ROADMAP.yaml entry (`true` | `false` | `auto`; default `auto`).

- `false` → skip (run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate code-review --status skipped --reason "gate=false"`)
- `true` → run (skip overrides do NOT apply when gate is explicit `true`)
- `auto` → see [`AUTO-TRIGGERS.md#adversarial-auto`](../protocols/AUTO-TRIGGERS.md#adversarial-auto)

**Skip overrides (only when gate resolves to `auto`):** before spawning, check the skip overrides in [`AUTO-TRIGGERS.md#adversarial-auto`](../protocols/AUTO-TRIGGERS.md#adversarial-auto). If any fires, run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate code-review --status skipped --reason "<reason>"` and continue without spawning Codex (security review still runs in parallel).

**Resolve model + effort** per [`protocols/MODEL.md`](../protocols/MODEL.md) § Codex model + effort. Defaults by `budget_quality`: `frugal` → `gpt-5.4-mini minimal`; `balanced` → `gpt-5.4 medium`; `max` → `gpt-5.5 medium`. Per-phase `codex_model:` / `codex_effort:` override.

**`risk_focus`** from phase ROADMAP entry (optional). When set, append to prompt: _"Pressure-test these risks first: {{RISK_FOCUS}}. Other material findings still report, but lead with these."_

**Pre-spawn:** soft-cap warning (see § Codex usage tracking) if >5 Codex calls in last 5h.

**If running:** prompt includes phase goal, branch, _"Run with `--model {{MODEL}} --effort {{EFFORT}}`. Read `agents/adversarial-reviewer.md`. Run `git diff main...HEAD`, `npx vitest run`, `npx tsc --noEmit`. Review for logic bugs, race conditions, edge cases, missing error handling, off-by-one, wrong assumptions. Write REVIEW.md with PASS/FAIL verdict per agent spec."_

**Post-completion:** `gates-update.mjs --gate code-review --status pass --reason "model={{MODEL}} effort={{EFFORT}}"`. Append codex-usage row (step=6, outcome=pass|fail|error).

**Prompt capture:** PROMPTS.md § Adversarial reviewer (Codex).

Auto-debug on FAIL → `failure_type: adversarial_fail`, `artifact: REVIEW.md`. On RESOLVED, re-run Step 6.

**Step 7 (Security — Sonnet):** Agent tool, `model: "sonnet"`. Thinking keyword per MODEL.md § Security selection. Prompt: `[KEYWORD]`, phase goal, _"Read `agents/security-reviewer.md`. Run `git diff main...HEAD`. Read SUMMARY.md. OWASP scan on changed files. Write SECURITY.md per agent spec (frontmatter `verdict: PASS | PASS-WITH-WARNINGS | BLOCKED`). CRITICAL/HIGH → `BLOCKED`."_

**Prompt capture:** PROMPTS.md § Security reviewer.

**Reading verdict back:** parse `verdict` from SECURITY.md frontmatter. On `BLOCKED`, double-check `grep -E '^### \[(CRITICAL|HIGH)\]' SECURITY.md` returns a match (if frontmatter and grep disagree, treat as BLOCKED defensively). On SECURITY.md absent: trigger auto-debug with `failure_type: security_silent_exit`.

Auto-debug on `BLOCKED` → `failure_type: security_fail`, `artifact: SECURITY.md`. On RESOLVED, re-run Step 7 (security-reviewer overwrites SECURITY.md, populating `## Resolved Findings` per idempotency contract).

**Wait for BOTH.** Security CRITICAL/HIGH or adversarial FAIL → do NOT create PR.

### Step 7b: Improver — sub-agent (background, gated)

**Gate:** skip by default. Run conditions: [`AUTO-TRIGGERS.md#improver-heuristic`](../protocols/AUTO-TRIGGERS.md#improver-heuristic).

**If running:** Agent tool, `model: "haiku"`, `run_in_background: true`. Prompt: _"Read `agents/improver.md`. Read SUMMARY.md and `.planning/expertise/` files. Write learnings to `.planning/expertise/.pending/`. Do not auto-merge. Use Context7 or Ref MCP for recent libs. As final act, write completion sentinel `.planning/expertise/.pending/.improver-N-slug.done` (lets Step 10 distinguish 'completed with no findings' from 'killed mid-write')."_

---

### Step 8: Create PR (inline)

Do NOT update ROADMAP.yaml or STATE.md on the feature branch. Full procedure: [`protocols/PR-CREATION.md`](../protocols/PR-CREATION.md).

- **8a Documentation + README check (BLOCKING).** Compare SUMMARY.md against `.claude/references/project-details.md`, `docs/architecture.md`, `taste.md`. Stale → spawn Haiku to update before PR. If `README.md` is absent at project root, write one (seed from PROJECT.md or CLAUDE.md, per `start.md` Stage 5 production spec) before proceeding.
- **8b Push + PR.** `git push -u`, compose PR body from the human summary plus optional metadata controlled by resolved profile `metadata.pr_body` (`off | standard | full`, default `standard`):
  - `off` → skip `riff-pr-metadata.sh`.
  - `standard` → run `bash .riff/scripts/riff-pr-metadata.sh <phase-id>` and append stdout; PROMPTS.md/USAGE.md are not required.
  - `full` → write `.planning/phases/N-slug/USAGE.md` from accumulated Agent results, finalize PROMPTS.md (replace leftover `{{prompt verbatim}}` placeholders with `_(not invoked)_`), then run the metadata script. The script hard-fails on unfilled PROMPTS.md placeholders only in `full` mode.
  Then `PR_URL=$(gh pr create ...)` and branch on `profile.yaml` `git.merge_strategy` (default `github_button`):
  - **`github_button`** → print report ending `PR open at $PR_URL. Click Merge on GitHub when ready.` STOP, skip 8c. Step 0 of next run reconciles.
  - **`local_no_ff`** → print report ending `Review on GitHub, then tell me 'merge'.` Stay alive, run 8c on user's "merge" cue.
- **8c Update state after merge.** Only fires on `local_no_ff`. Checkout main, `pull --ff-only`, `merge --no-ff`, capture merge SHA into `SUMMARY.md` `> Merge commit:` line, clear sidecars (`.planning/active-phase.txt` + STATE.md `## Active Phase`), update ROADMAP.yaml + STATE.md, commit + push, delete branches.

### Step 9: Learn (inline)

- Taste proposals: new pattern → append to taste.md with `<!-- PENDING -->`
- Seeds: check `.planning/seeds/` triggers

### Step 10: Report + usage (inline)

Collect `total_tokens`, `tool_uses`, `duration_ms` from each Agent result. If `metadata.pr_body: full` did not already write `.planning/phases/N-slug/USAGE.md` at Step 8b, write it now using `templates/usage.md`. USAGE.md + PROMPTS.md are included in PR metadata only when `metadata.pr_body: full`.

Append a row to `.planning/usage-log.csv` via `.riff/scripts/csv-append.sh` (flock-protected, child-bash invocation). Full schema: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Usage CSV logging.

Print:

```
Phase N: {{TITLE}} - {{VERDICT}}
Built: {{artifacts}}
Security: {{PASS/issues}}
Usage: {{total_tokens}}k tokens, {{duration}}min
Next: Phase {{N+1}}: {{NEXT_TITLE}}
```

### Pending expertise review (inline)

If `.planning/expertise/.pending/*.md` is non-empty, prompt **Review now** (walk patterns, classify Stack / Architecture / Project per-pattern with Accept / Reject / Edit / Re-tier; default to Project tier when unsure) / **Defer** / **Reject all**. Full tier destinations + improver-sentinel handling: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Pending expertise review.

Report at end: `Reviewed: M accepted (stack/arch/project breakdown), K rejected, E edited, D deferred.`

### Milestone deep audit prompt (inline)

After Step 10, if the just-completed phase has a `milestone:` tag in ROADMAP.yaml, prompt **Run now** (load [`protocols/DEEP-AUDIT.md`](../protocols/DEEP-AUDIT.md) and execute inline, spawns deep-auditor via `codex:codex-rescue`) / **Defer** (run conversationally with "deep audit" anytime). Skip silently if `codex:codex-rescue` skill is not configured.

---

## Session checkpoints

Non-trivial phases blow past 200k fast (sub-agent returns + inline reads + status updates accumulate, hallucination risk up). See `CLAUDE.md` § Context budget + [`protocols/HANDOFF.md`](../protocols/HANDOFF.md).

3 break points (parent flush via `/clear`, resume from disk):

| Checkpoint | Triggered after | Bootstrap reads |
|---|---|---|
| **next-A** Plan validated | Step 4b PROCEED on PLAN-REVIEW.md | PLAN.md, PLAN-REVIEW.md, ROADMAP entry |
| **next-B** Code shipped | Step 5 SUMMARY.md, tests green | SUMMARY.md, `git diff main...HEAD`, PLAN.md |
| **next-C** Review passed | Step 7 PASS / RESOLVED via debugger | SUMMARY.md, REVIEW.md, SECURITY.md, DEBUG.md if any, AUTHORIZATION-MATRIX.md if any |

End of checkpoint → eval heuristic in [`protocols/HANDOFF.md`](../protocols/HANDOFF.md) § Trigger. 2+ fire → finish current step + write artifact, update STATE.md per HANDOFF § STATE.md contract, surface `Context at NNNk, M heuristics fired. /clear + reopen at checkpoint X with: continue /riff:next at Step Y for phase N-slug. Read STATE.md.`

No mid-step checkpoints. Single-session default for phases <25 files / 4 sub-agent passes; checkpoint for 50+ file phases.

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

Every Codex call (Steps 4b, 6) appends a row to `.planning/codex-usage.csv` (Plus-quota awareness, not billing). Full schema + helper: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Codex usage tracking. Header: `timestamp,phase,step,model,effort,outcome,duration_sec`. Outcomes: `pass | fail | revise | proceed | error`.

**Soft cap (pre-spawn 4b / 6):** if >5 Codex calls in last 5h, print `Codex: 5+ calls in last 5h. Consider switching budget_quality: frugal for the rest of the session, or take a break.` Do NOT block.

---

## Ground rules

- Give paths, never paste file contents into prompts.
- Step 4 is inline — never a sub-agent (~7x token waste).
- Sub-agents need explicit `model:` on the Agent call (frontmatter inheritance is not enough).
- Auto-debug artifacts (DEBUG.md) are required input for the next cycle.
- One phase per `/riff:next` call.
- **Never ask "should I continue?" between steps.** Flow through until: a gate fires (REVISE / DROPPED / fail / FAILED / crash), an `AskUserQuestion` block in the step spec requires HITL input, or Step 10 lands. Successful transitions (PROCEED, MATCH, pass, RESOLVED) are NOT checkpoints.

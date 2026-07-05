---
description: The core loop - plan, build, verify the next phase
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent, AskUserQuestion
args: "[--plan-only] [phase-number]"
model: opus  # static mirror of profile.yaml models.reasoning (frontmatter can't read config); keep in sync
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

Catches drift when a prior phase shipped between sessions, resets stale sidecars, syncs main safely, reconciles shipped phases, then performs the dirty-tree preflight. Full procedure: [`protocols/RECONCILE.md`](../protocols/RECONCILE.md) § Step 0 — Sync main + reconcile stale bookkeeping.

### Step 1: Read state (inline)

Hard gate before reading phase state:

```bash
bash .riff/lib/validate-roadmap.sh ROADMAP.yaml || { echo "ROADMAP invalid, STOP"; exit 1; }
```

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

Before creating the branch, run the existing-branch and partial-SUMMARY crash residue checks. Full procedure: [`protocols/RECONCILE.md`](../protocols/RECONCILE.md) § Step 2b — Crash residue checks (pre-branch).

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

Seed `.planning/phases/N-slug/PROMPTS.md` from `.riff/templates/PROMPTS.md` if missing, init `GATES.md` via `node .riff/scripts/gates-update.mjs --init` if missing:

```bash
mkdir -p .planning/phases/N-slug
[[ ! -f .planning/phases/N-slug/PROMPTS.md ]] && cp .riff/templates/PROMPTS.md .planning/phases/N-slug/PROMPTS.md
[[ ! -f .planning/phases/N-slug/GATES.md ]] && node .riff/scripts/gates-update.mjs --init .planning/phases/N-slug
```

PROMPTS.md captures substantive sub-agent prompts (Steps 4, 4b, 5, 5b, 6, 7, auto-debug). It is included in the PR body only when `metadata.pr_body: full`. Convention (what to keep vs drop, finalize-on-PR rules): [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Prompt capture convention.

### Step 3: Confidence gate (inline)

See `protocols/EXECUTION.md` § 1. Confidence Gate. Any dimension < 0.7 → STOP.

---

### Step 4: Plan — INLINE

Parent plans inline, never via sub-agent. Resolve `planner_model`, draft PLAN.md, keep STATE.md/ROADMAP.yaml unchanged, and capture the prompt note. Full procedure: [`protocols/EXECUTION.md`](../protocols/EXECUTION.md) § Step 4 planner orchestration.

If `planner_model: codex` and Codex is available, print the Codex plan command, mark the loop paused, and exit without writing PLAN.md.

---

### Step 4b: Plan adversarial review — sub-agent (gated)

Skip if `scope: scratch`. Gate: `plan_adversarial:` (`false` skip, `true` always run, `auto` checks skip overrides). Full procedure: [`protocols/EXECUTION.md`](../protocols/EXECUTION.md) § Step 4b plan adversarial review.

On `REVISE`, surface findings, re-run Step 4 with PLAN-REVIEW.md input, then re-run Step 4b. Loop until `PROCEED`; max 2 cycles, then STOP.

---

### Step 4c: Pre-exec explanation — sub-agent (always, fail-silent)

Plain-language description of the plan for `/riff:dashboard`. Level + language from `profile.yaml`. Never blocks the pipeline. Full prompt + resolution: [`protocols/DASHBOARD-EXPLAIN.md`](../protocols/DASHBOARD-EXPLAIN.md) § Step 4c — Pre-exec explanation.

**Skip if** neither `style.explanation_level` nor `user.narrative_language` is set in profile.yaml.

Agent tool, `model: "haiku"`. Reads PLAN.md + ROADMAP entry, writes `EXPLAIN.{{LEVEL}}.md`. On error: log a one-line warning, continue.

If `--plan-only`: STOP here. PLAN.md, PLAN-REVIEW.md, EXPLAIN.{{LEVEL}}.md are the deliverables.

---

### Step 5: Execute

Resolve executor runtime, record `phase_base_sha`, run Codex by default or Claude fallback, then check crash residue. Full procedure: [`protocols/EXECUTION.md`](../protocols/EXECUTION.md) § Step 5 executor orchestration.

Crash residue can trigger auto-debug, manual resume halt, abort with `CRASHED`, or clean `CRASH.json` removal on success.

If the resolved executor runtime is Codex, re-run security hooks over the phase diff and write the result to the ledger:

```bash
node .riff/scripts/reconcile-gate.mjs --phase .planning/phases/N-slug --base "$phase_base_sha" --head HEAD || true
```

This records `hook-reconcile=fail` for HIGH hook findings. Finalization blocks later via `gates-check --finalize`; this step records the evidence and must not be treated as a review substitute.

---

### Step 5b: Simplify — sub-agent (gated)

Skip if `scope: scratch`. Gate: `simplify:` (`false` skip, `true` run, `auto` via simplifier heuristic). Full procedure: [`protocols/EXECUTION.md`](../protocols/EXECUTION.md) § Step 5b simplifier orchestration.

---

### Step 5c: Scope check — mechanical (inline)

Before review, verify executor honored the plan. Do not spawn a sub-agent by default. Run:

```bash
node .riff/scripts/scope-check.mjs --phase .planning/phases/N-slug
```

The script writes `.planning/phases/N-slug/SCOPE-CHECK.json` and exits non-zero unless the verdict is `MATCH`.

On `MATCH`, proceed. On any non-`MATCH` verdict, follow [`protocols/SCOPE-CHECK.md`](../protocols/SCOPE-CHECK.md) § Step 5c orchestration (verdict handling): `DROPPED` stops for triage/re-run loops; `MALFORMED` surfaces the reason and asks skip-or-fix.

---

### Step 5d: Fallow audit — inline (gated)

Mechanical static audit on the phase diff: dead code, duplication, complexity, boundary violations. Full procedure: [`protocols/FALLOW.md`](../protocols/FALLOW.md).

Skip if `scope: scratch`, not TS/JS, or `fallow` is unavailable. `fail` blocks; `warn` does not.

---

### Step 5e: Smoke test browser — inline (gated)

Boot the dev server, load touched routes in a headless browser, capture HTTP status + console errors/warnings. Full procedure: [`protocols/BROWSER-CHECK.md`](../protocols/BROWSER-CHECK.md) § Runtime Smoke Test (Step 5e).

Skip if scope/package/opt-in/tooling/dev-script/route derivation conditions fail. `pass` continues, `warn` continues and surfaces in Step 10, `fail` STOPs for fix-in-place / accepted-exception / one-time override; runtime errors kill the dev server before skip-or-halt.

---

### Step 5f: Post-mortem explanation — sub-agent (always, fail-silent)

Plain-language post-mortem of what was built + metadata block, for `/riff:dashboard`. Never blocks the pipeline. Full prompt + style rules: [`protocols/DASHBOARD-EXPLAIN.md`](../protocols/DASHBOARD-EXPLAIN.md) § Step 5f — Post-mortem explanation.

**Skip if** neither `style.explanation_level` nor `user.narrative_language` is set in profile.yaml.

---

### Steps 6 + 7: Adversarial + Security — IN PARALLEL

Skip both if `scope: scratch` and jump to Step 8. Otherwise launch both in one message. Full procedure: [`protocols/QUALITY.md`](../protocols/QUALITY.md) § Step 6 and 7 review gates.

Step 6 FAIL or Step 7 BLOCKED triggers auto-debug and re-runs the originating step on RESOLVED. Security CRITICAL/HIGH or adversarial FAIL → do NOT create PR.

### Step 7b: Improver — sub-agent (background, gated)

Skip by default. Run conditions and background prompt: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Improver invocation (Step 7b). The skip reason is logged to GATES.md as `Step 7b: skipped — <reason>`; if this line is absent from recent GATES.md files, the logging call was dropped and must be restored.

---

### Step 8: Create PR (inline)

Do NOT update ROADMAP.yaml or STATE.md on the feature branch. Full procedure: [`protocols/PR-CREATION.md`](../protocols/PR-CREATION.md).

8a documentation + README check is blocking. 8b runs `node .riff/scripts/gates-check.mjs --finalize --phase .planning/phases/N-slug || { echo "gates not satisfied, no PR"; exit 1; }`, then pushes and opens the PR with `metadata.pr_body` handling. `github_button` prints the PR URL and STOPs; `local_no_ff` waits for "merge", then 8c updates state on main.

### Step 9: Learn (inline)

Taste proposals: new pattern → append to taste.md with `<!-- PENDING -->`. Seeds: check `.planning/seeds/` triggers.

### Step 10: Report + usage (inline)

Collect `total_tokens`, `tool_uses`, `duration_ms` from each Agent result. If `metadata.pr_body: full` did not already write `.planning/phases/N-slug/USAGE.md` at Step 8b, write it now using `templates/usage.md`. USAGE.md + PROMPTS.md are included in PR metadata only when `metadata.pr_body: full`.

Append a row to `.planning/usage-log.csv` via `.riff/scripts/csv-append.sh` (flock-protected, child-bash invocation). Full schema: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Usage CSV logging (Step 10).

Print final report: phase title/verdict, built artifacts, security result, usage, and next phase.

### Pending expertise review (inline)

If `.planning/expertise/.pending/*.md` is non-empty, prompt **Review now** (walk patterns, classify Stack / Architecture / Project per-pattern with Accept / Reject / Edit / Re-tier; default to Project tier when unsure) / **Defer** / **Reject all**. Full tier destinations + improver-sentinel handling: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Pending expertise review.

Report at end: `Reviewed: M accepted (stack/arch/project breakdown), K rejected, E edited, D deferred.`

### Milestone deep audit prompt (inline)

After Step 10, if the just-completed phase has a `milestone:` tag in ROADMAP.yaml, prompt **Run now** (load [`protocols/DEEP-AUDIT.md`](../protocols/DEEP-AUDIT.md) and execute inline, spawns deep-auditor via `codex:codex-rescue`) / **Defer** (run conversationally with "deep audit" anytime). Skip silently if `codex:codex-rescue` skill is not configured.

---

## Session checkpoints

Non-trivial phases can exceed safe context. Evaluate only at step boundaries; never checkpoint mid-step. Full procedure: [`protocols/HANDOFF.md`](../protocols/HANDOFF.md) § Trigger.

Break points: next-A after Step 4b PROCEED, next-B after Step 5 code shipped, next-C after Step 7 review passed. Resume/bootstrap contract: [`protocols/HANDOFF.md`](../protocols/HANDOFF.md) § Per-command checkpoints.

---

## Auto-debug pattern

Shared by Steps 5, 6, 7. Skip if `auto_debug: false`. Full procedure: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Auto-debug pattern.

`RESOLVED` re-runs the originating step unless the pinning-test exception applies; `UNRESOLVED` halts and surfaces DEBUG.md.

---

## Codex usage tracking

Every Codex call (Steps 4b, 6) appends to `.planning/codex-usage.csv` for Plus-quota awareness. Full schema, helper, outcomes, and soft-cap warning: [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) § Codex usage tracking.

---

## Ground rules

- Give paths, never paste file contents into prompts.
- Step 4 is inline — never a sub-agent (~7x token waste).
- Sub-agents need explicit `model:` on the Agent call (frontmatter inheritance is not enough).
- Auto-debug artifacts (DEBUG.md) are required input for the next cycle.
- One phase per `/riff:next` call.
- **Never ask "should I continue?" between steps.** Flow through until: a gate fires (REVISE / DROPPED / fail / FAILED / crash), an `AskUserQuestion` block in the step spec requires HITL input, or Step 10 lands. Successful transitions (PROCEED, MATCH, pass, RESOLVED) are NOT checkpoints.

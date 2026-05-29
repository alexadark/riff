# EXECUTION

Operational rules every RIFF agent follows when planning, building, and reacting to surprises during a phase. This is the "how we work" doc — pair it with [QUALITY.md](./QUALITY.md) (post-build checks) and [MODEL.md](./MODEL.md) (model dispatch).

---

## 1. Confidence Gate

Score these 4 dimensions before proceeding. **Any dimension < 0.7 → STOP** and surface questions.

| Dimension  | Question                                                   |
| ---------- | ---------------------------------------------------------- |
| **Scope**  | Is it clear what to deliver? (not vague, not overlapping)  |
| **Target** | Do I understand the codebase well enough? (read the files) |
| **Output** | Can I define testable acceptance criteria?                 |
| **Risk**   | Have I identified what could go wrong?                     |

### Confidence levels (for surfaced questions)

- **Confident** (0.8–1.0) — sure, just confirming
- **Likely** (0.5–0.8) — probably right, could be wrong
- **Unclear** (0.0–0.5) — need human input

**Phrasing of surfaced questions** follows resolved `explanation_level`. `simple`/`eli5` → plain words, user-flow framing, no framework jargon. See `references/EXPLANATION-LEVEL.md` § Interactive questions. Applies to every `AskUserQuestion` in every RIFF command/protocol, not just the confidence gate.

### AFK mode behavior

- Confident / Likely → proceed
- Unclear → STOP the loop, notify via Telegram

## Step 4 planner orchestration

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

## Step 4b plan adversarial review

**Skip if `scope: scratch`.** Runs before execution so the planner can revise before code is written (plan-stage fixes cost ~10x less than code-stage).

**Gate:** `plan_adversarial:` from the phase's ROADMAP.yaml entry. `false` → skip. `true` → always run (skip overrides ignored). `auto` (default) → check [`AUTO-TRIGGERS.md#plan-adversarial-auto`](./AUTO-TRIGGERS.md#plan-adversarial-auto) skip overrides; if any fires, log `gates-update.mjs --gate plan-review --status skipped --reason "<reason>"` and continue.

**Model + effort** per [`MODEL.md`](./MODEL.md) § Codex model + effort. Default Step 4b: `gpt-5.5 medium`. Per-phase `codex_model:` / `codex_effort:` override.

**`risk_focus`** from phase ROADMAP entry (optional free text, e.g. `"concurrency, idempotency"`). When set, append to prompt: _"Pressure-test these specific risks first: {{RISK_FOCUS}}. Any other material findings still report, but lead with these."_

**Pre-spawn:** soft-cap warning (see POST-PHASE.md § Codex usage tracking) if >5 Codex calls in last 5h.

**If running:** Agent tool → skill `codex:codex-rescue`. Prompt: phase goal (one line), branch, _"Run with `--model {{MODEL}} --effort {{EFFORT}}`. Read `agents/plan-adversarial-reviewer.md`. Read PLAN.md, PROJECT.md, ROADMAP entry for phase N, and `taste.md` sections relevant to the phase surface. Apply the protocol. Write PLAN-REVIEW.md with PROCEED or REVISE verdict."_

**Post-completion:** `gates-update.mjs --gate plan-review --status pass --reason "model={{MODEL}} effort={{EFFORT}}"`. Append row to `.planning/codex-usage.csv` (step=4b, outcome=proceed|revise|error, duration_sec).

**Prompt capture:** PROMPTS.md § Plan adversarial reviewer (Codex). Keep distinct from § Adversarial reviewer (Codex) if both Steps 4b and 6 ran.

**On REVISE:** surface Findings section to user. Re-run Step 4 inline with PLAN-REVIEW.md input — planner addresses each `BLOCKER`, optionally `WARNING`/`NOTE`, rewrites PLAN.md in place. Re-run Step 4b. Loop until PROCEED. Max 2 cycles, then STOP and escalate.

**On PROCEED:** continue.

---

## 2. R1–R4 Deviation Rules

When reality doesn't match the plan, react with the right tool:

| Rule   | Situation                            | Action                                                                            |
| ------ | ------------------------------------ | --------------------------------------------------------------------------------- |
| **R1** | Minor bug found                      | Fix it. Log in SUMMARY: `R1: Fixed [bug] in [file]`                               |
| **R2** | Missing piece (import, type, config) | Add if obvious. Log: `R2: Added [piece] because [reason]`                         |
| **R3** | Architecture change needed           | **STOP.** Do NOT implement. Surface issue + proposed alternative. Wait for human. |
| **R4** | Out of scope idea                    | Do NOT implement. Write to `.planning/seeds/seed-NNNN.md` with trigger condition. |

---

## 3. Context Loading

What each agent reads before acting. Read in this order, skip what's already in context.

**All agents — language rule:** read `profile.yaml` per `.riff/references/PROFILE-RESOLUTION.md` for `user.conversational_language` (chat output) and `user.artifact_language` (committed files). Reply to the user in `conversational_language`; write all `.planning/**` artifacts and code in `artifact_language`. Defaults: both `en`. See `.riff/CLAUDE.md` § Language.

### Planner reads

1. **Always:** ROADMAP.yaml, STATE.md, PROJECT.md, taste.md (`## Architecture`), `profile.yaml` (resolved per `.riff/references/PROFILE-RESOLUTION.md`)
2. **If exists:** CONTEXT.md, previous SUMMARY.md files, `.planning/expertise/planner.md`
3. **Relevant taste section:** `## Backend` for backend tasks, `## Frontend` for frontend, etc.
4. **The codebase:** Read the actual files you're planning to modify. Never plan blind.

If `profile.yaml` is missing, fall back to the default profile (see `commands/onboard.md`).

### Executor reads

1. **PLAN.md** — your executable prompt, follow it precisely
2. **taste.md** — `## Architecture` always + relevant section
3. **Boundaries** — each task lists which files you CAN modify, nothing else
4. **Previous SUMMARY.md** — if wave 2+, read what wave 1 built
5. **profile.yaml** (resolved per `.riff/references/PROFILE-RESOLUTION.md`): always, for user calibration. Fall back to the default profile if missing.
6. **If exists:** `.planning/expertise/executor.md`

## Step 5 executor orchestration

**Runtime resolution:** see [`MODEL.md`](./MODEL.md) § Executor runtime resolution. Default: **Codex** (via `codex:codex-rescue` in-process). Falls back to Claude sub-agent (Sonnet) when `executor_model: sonnet` or `codex` not in `executors.available`.

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

**After the executor sub-agent returns, check for crash residue.** Full procedure (CRASH.json schema + 3 AskUserQuestion sub-cases): [`POST-PHASE.md`](./POST-PHASE.md) § Executor crash residue.

1. **SUMMARY.md absent** → silent crash. Write `CRASH.json` (`crash_type: executor_silent_exit`, `verdict: pending`). Prompt **Trigger auto-debug** (`failure_type: executor_silent_exit`, `artifact: CRASH.json`) / **Resume manually** (halt, Step 0 detects partial state on next run) / **Abort** (set `verdict: abandoned`, STATE.md `## Active Phase` Step → `CRASHED`).
2. **SUMMARY.md exists with `FAILED` / `ERROR` / `unresolved`** → auto-debug with `failure_type: executor_fail`, `artifact: SUMMARY.md`.
3. **Successful completion** (incl. after auto-debug RESOLVED) → `rm -f .planning/phases/N-slug/CRASH.json`.

## Step 5b simplifier orchestration

**Skip if `scope: scratch`.** Runs before review so reviewers audit simplified code.

**Gate:** `simplify:` from phase ROADMAP entry. `false` → skip. `true` → always run. `auto` (default) → [`AUTO-TRIGGERS.md#simplifier-auto`](./AUTO-TRIGGERS.md#simplifier-auto).

**If running:** Agent tool, `model: "haiku"`. Prompt: branch, phase N-slug, _"Read `agents/simplifier.md`. Scope: diff of `riff/phase-N-slug` against main only. Apply the protocol. Write REFACTOR.md. Commit simplifications as separate `refactor(phase-N): ...` commits, staging explicitly."_

**Prompt capture:** PROMPTS.md § Simplifier (append the section if absent in template).

### Verifier reads (for manual re-audits and post-build doc check)

1. **PLAN.md** — goal, tasks, acceptance criteria
2. **SUMMARY.md** — what the executor claims happened
3. **`.planning/warnings.log`** — hook warnings from the phase
4. **The codebase** — verify independently, don't trust claims

### Security reviewer reads

- Files modified in the phase (from SUMMARY.md or git diff)
- OWASP checklist (see `agents/security-reviewer.md`)
- `profile.yaml` (resolved per `.riff/references/PROFILE-RESOLUTION.md`) for user calibration. Fall back to the default profile if missing.

---

## 4. Wave Execution

Tasks in the same wave run in **parallel via separate agents**. They MUST have **zero file overlap** in their entire boundary list.

### Planning waves

Explicitly state waves in the plan. Common conflicts to watch for:

- Barrel exports (`index.ts`) — both tasks add exports → separate waves
- Schema files (`schema.ts`) — both tasks add tables → separate waves
- Config files (`package.json`, route manifests) — both add entries → separate waves

**When in doubt, use separate waves. Sequential is always safe.**

### Logical dependency check

Zero file overlap is necessary but NOT sufficient. Each task MUST list `requires:` — symbols, exports, or files produced by other tasks. If task B `requires` something from task A, B's wave must be strictly later than A's.

### Executing waves

- **Multi-task wave:** Use the Agent tool to spawn all task agents in a **single message** (parallel). Each Agent tool call gets: task description, boundaries, taste.md, and `model` set per the task's `Model:` field. Do NOT implement any task inline — every task runs in its own Agent subagent. After the wave completes, read committed changes before starting next wave.
- **Conflict detected:** Two agents modified the same file → planner error. Log as R1, resolve manually.

---

## 5. Test Suite Detection

Shared by executor, debugger, simplifier. Detect and run the first match:

1. `package.json` with `scripts.test` → `npm test`
2. `pytest.ini` / `pyproject.toml` → `pytest`
3. `go.mod` → `go test ./...`
4. `Cargo.toml` → `cargo test`
5. `Makefile` with `test` target → `make test`

If none detected: note it in the agent's output artifact. Do not silently skip.

## Project Scope (scratch vs production)

Set at `/riff:start` Stage 1, stored in `.planning/config.json` as `scope: scratch | production`. Default when missing → `production` (existing projects are unaffected).

> Project scope and project profile are independent. Scope drives which stages and gates run; profile drives persona, strictness, language, and budget. For per-project profile override, see `references/PROFILE-RESOLUTION.md`.

### scratch

Personal/local apps, no auth, no public exposure, no other users.

- `/riff:start` skips Stages 2 / 2.5 / 4.5, runs light Stages 3 / 4, bootstraps only PROJECT.md + ROADMAP.yaml + STATE.md.
- `/riff:next` skips planner adversarial, simplifier, security-reviewer, adversarial Codex.
- Executor stays language-agnostic.
- Of the production code-quality rules, only "no hardcoded secrets" applies (the rest don't fit Python/bash/local-only scripts).

### production

Full RIFF discipline.

- All discovery stages run.
- All `/riff:next` gates run (planner adversarial, simplifier, security-reviewer, adversarial Codex).
- All non-negotiable code-quality rules apply.

### Promotion

When the user says "promote to production" (or equivalent, see CLAUDE.md § Conversational triggers), read `protocols/PROMOTE.md` and run the flow. No slash command.

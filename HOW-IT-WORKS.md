```
██████╗ ██╗███████╗███████╗
██╔══██╗██║██╔════╝██╔════╝
██████╔╝██║█████╗  █████╗
██╔══██╗██║██╔══╝  ██╔══╝
██║  ██║██║██║     ██║
╚═╝  ╚═╝╚═╝╚═╝     ╚═╝

Solo dev framework for Claude Code
Build like a band of six. Ship like one.
```

---

## What RIFF is

RIFF turns "I want to build X" into a repeatable loop: **plan, build, verify, commit**, one phase at a time. Each phase runs in a fresh Claude Code context with full state on disk, so you can stay in the loop and correct as you go, or leave it running unattended.

RIFF works on any project, new or existing. It ships **13 specialized agents**, **14 slash commands**, **18 hooks** in 3 buckets, a local web dashboard, and a small `profile.yaml` that tunes everything to you.

**Who it's for:** solo developers using Claude Code who want structure, quality, and the ability to walk away from the keyboard without the project falling apart.

---

## Table of contents

- [Install](#install)
- [Quick start](#quick-start)
- [The two paths: greenfield vs brownfield](#the-two-paths-greenfield-vs-brownfield)
- [The 14 commands](#the-14-commands)
- [The /riff:next pipeline, step by step](#the-riffnext-pipeline-step-by-step)
- [The 13 agents](#the-13-agents)
- [Wave parallelization](#wave-parallelization)
- [Profile and budget](#profile-and-budget)
- [Hooks: the 3 buckets](#hooks-the-3-buckets)
- [Unattended runs: /riff:wave](#unattended-runs-riffwave)
- [Dashboard](#dashboard)
- [Debug and improver](#debug-and-improver)
- [File structure](#file-structure)
- [Model selection](#model-selection)
- [Philosophy](#philosophy)

---

## Install

RIFF installs into your project via a symlink to your local framework repo. One source of truth, every project stays in sync.

```bash
git clone <riff-repo-url> ~/your/path/riff
cd ~/your/path/riff
```

Open Claude Code in the framework directory and run:

```
/riff:onboard
```

This walks you through 13 questions (or writes the default profile) and writes `profile.yaml` at the framework root. The path is registered at `~/.config/riff/config.yaml` on first onboard, so other RIFF commands locate the framework without any hardcoded location.

Then, in any project directory:

```bash
cd ~/my-project
riff init
```

Or from inside Claude Code in the project:

```
/riff:init
```

`riff init` does the following:

1. **Links the framework** — `.riff/` becomes a symlink to your RIFF clone.
2. **Creates symlinks** from `.claude/commands/riff/` and `.claude/agents/riff/` to `.riff/`.
3. **Creates local files** that are project-specific (`.planning/`, scope config).
4. **Installs hooks** — git hooks (security scan, commit message) + Claude Code hooks (`settings.json`).
5. **Adds `.riff/` to `.gitignore`** (the symlink is local, not portable).

### How symlinks work

```
~/your/path/riff/                            <-- your local repo (single source of truth)
        ^
        |
.riff/ -> symlink                            <-- project points to the repo
        |
        v
.claude/commands/riff/next.md                <-- symlink to ../../../.riff/commands/next.md
                                                  which resolves to the real file in your repo
```

When you type `/riff:next`, Claude Code reads `.claude/commands/riff/next.md`, follows the symlink chain, and executes the real file from your repo. Update the repo once, every project sees the change instantly.

> **Restart Claude Code after `/riff:init`.** The just-installed commands (`/riff:start`, `/riff:next`, etc.) will not appear in the current window. Close and reopen Claude Code in the project before continuing.

---

## Quick start

After `/riff:init`:

```
/riff:start        # greenfield discovery (5 stages: problem, users, MVP, research, roadmap)
                   # OR /riff:map for an existing codebase
/riff:next         # the main loop: plan a phase, execute, review, open a PR
/riff:dashboard    # open the local web dashboard (kanban + plain-language explanations)
```

Run `/riff:status` anytime to see where you are. Run `/riff:wave` to bundle N parallel-eligible phases and let Codex execute them while you're away.

---

## The two paths: greenfield vs brownfield

### Greenfield: `/riff:start`

For a brand-new project. 5 stages of discovery, each gated:

1. **Problem definition** — what are we building, for whom, why now. Includes scope choice (`scratch` vs `production`).
2. **System architecture** — high-level design, stack, key risks. Adversarial review gate (Codex CLI pass).
3. **MVP scope** — what ships in v1 vs later.
4. **Research** — competitive landscape, prior art, tooling.
5. **Roadmap** — `ROADMAP.yaml` with ordered phases. Adversarial review gate.

Outputs: `PROJECT.md`, `ROADMAP.yaml`, `STATE.md`, `.planning/config.json` (scope), plus `taste.md`, `INCIDENTS.md`, `CONTEXT.md` in production scope.

### Brownfield: `/riff:map`

For an existing codebase. RIFF reads the code, infers the stack, and seeds a roadmap of work it can see (bugs, missing tests, security gaps, refactors). Outputs `PROJECT.md`, `taste.md`, and a seeded `ROADMAP.yaml`.

### Scope: scratch vs production

Set at Stage 1 of `/riff:start` (or at `/riff:init` Step 3b):

- **`production`** — others will use it, deployed, has auth/payments/PII, or is destined to. Full RIFF discipline (security review on every phase, R3 architecture gates, all hooks wired).
- **`scratch`** — personal/local script, no auth, no public exposure. Skips adversarial review, skips security review, only the "no hardcoded secrets" rule applies.

When a scratch project gets serious, ask Claude to "promote to production". RIFF runs the skipped discovery stages and flips the scope. When the app is deployed, say "set up monitoring" to wire error tracking, uptime checks, and scheduled smoke tests via `protocols/POST-DEPLOY.md`.

---

## The 14 commands

All grouped in [`commands/INDEX.md`](./commands/INDEX.md). Summary:

### Framework (global)

| Command            | When to run                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `/riff:onboard`    | First time setting up RIFF, or to override the profile for one specific project.                         |
| `/riff:learn-stack`| Teach RIFF a new stack (Rust, Go, FastAPI, etc.). Writes a taste rule file.                              |
| `/riff:dashboard`  | Open the local web dashboard (kanban view, plain-language explanations, generation metadata).             |

### Setup (project lifecycle)

| Command          | When to run                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `/riff:init`     | Install RIFF into the current project (symlinks, hooks, scope, profile).                                  |
| `/riff:resync`   | Re-link symlinks after the framework adds or removes files. Idempotent.                                  |
| `/riff:start`    | Greenfield 5-stage discovery (problem → users → MVP → research → roadmap).                                |
| `/riff:map`      | Brownfield: point at an existing codebase to onboard RIFF onto it.                                       |

### Core loop (daily)

| Command          | When to run                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| `/riff:next`     | The main command. Plans, executes, reviews, opens PR for the next phase.                                 |
| `/riff:wave`     | Bundle N parallel-eligible phases (tagged `mode: AFK`) and delegate execution to Codex. Opus plans, Codex executes, browser-check proves it works. |
| `/riff:status`   | "Where am I?" — current phase, next phase, blocked phases, pending expertise patches.                    |

### Off-loop

| Command                         | When to run                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/riff:add-phase [name] [goal]` | Append a new phase to `ROADMAP.yaml`.                                                              |
| `/riff:quick <task>`            | One-off task that doesn't deserve a phase (config tweak, copy fix, dependency bump).               |
| `/riff:debug <bug>`             | Manual debug invocation outside the auto-debug pipeline.                                          |
| `/riff:improver [N\|--all]`     | Batch the improver across the last N phases to harvest learnings into `.planning/expertise/`.      |

### Conversational triggers (no slash command)

Rare lifecycle actions live as protocol files. Trigger them by saying a phrase:

- "log incident" → append entry to `INCIDENTS.md`
- "incident review" → quarterly review, runs `incident-adversarial-reviewer`
- "promote to production" → flip scope, run skipped discovery stages, set up post-deploy monitoring (Sentry, health endpoint, smoke test)
- "re-audit phase N" → re-run scope-check + adversarial + security against a phase
- "deep audit" / "milestone review" → `deep-auditor` runs across phases at a milestone boundary
- "resync riff" → run `bash .riff/riff-resync.sh`
- "set my notification channel to X" → edit `profile.yaml` directly

Full mapping in `CLAUDE.md` § Conversational triggers.

---

## The /riff:next pipeline, step by step

`/riff:next` is the heart of RIFF. One invocation = one phase = one PR. The pipeline runs as a sequence of inline steps and sub-agent calls. Full spec in [`commands/next.md`](./commands/next.md).

```
Step 0   Sync main, reconcile stale bookkeeping
Step 1   Read state (STATE.md, ROADMAP.yaml)
Step 2   Pick next phase
Step 2b  Create phase branch (riff/phase-N-slug)
Step 2c  Ensure PROMPTS.md exists
Step 3   Confidence gate (planner self-rates)
Step 4   Plan ────────────────────────────── planner (inline)
Step 4b  Plan adversarial review ─────────── plan-adversarial-reviewer (gated)
Step 4c  Pre-exec explanation ───────────── haiku, for dashboard (fail-silent)
Step 5   Execute ────────────────────────── executor (sub-agent)
Step 5b  Simplify ───────────────────────── simplifier (gated)
Step 5c  Scope check ────────────────────── scope-check.mjs (mechanical)
Step 5d  Fallow audit ───────────────────── mechanical, no LLM (gated)
Step 5e  Smoke test (browser) ───────────── headless browser (gated)
Step 5f  Post-mortem explanation ───────── haiku, for dashboard (fail-silent)
                       Steps 6 + 7 RUN IN PARALLEL
Step 6   Adversarial review ──────────────── adversarial-reviewer (Codex CLI)
Step 7   Security review ──────────────────── security-reviewer (Sonnet)
                       (skipped both if scope=scratch)
Step 7b  Improver (background, gated)
Step 8   Create PR
Step 9   Learn (append to taste.md, expertise/)
Step 10  Report + usage tracking
```

### Confidence gate

At Step 3, the planner self-rates its confidence in the plan from 1 to 10 against the AC. If confidence is below the threshold set in `profile.yaml`, the pipeline pauses and asks you to clarify. The threshold defaults to 7. Higher thresholds = more questions, more safety; lower = more initiative.

### R1 to R4 deviations

When the executor hits something outside the plan, it picks one of four behaviors:

- **R1** — minor bug: fix it, log the deviation in SUMMARY.md.
- **R2** — missing piece that's obvious: add it, log in SUMMARY.md.
- **R3** — architecture change: STOP, ask the user.
- **R4** — out of scope: seed a new phase, don't build it now.

R1/R2 keep things moving without bothering you. R3/R4 protect you from drift.

### Atomic commits

One commit per task in the plan. Conventional commit prefixes (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`). No `git add .`. Pre-commit hook runs `security-scan.sh`, which blocks obvious secrets and `.env` files and warns on common quality issues.

### Auto-debug

If any step fails (executor crash, scope-check FAIL, adversarial FAIL, security BLOCKED, smoke test fail), the pipeline routes to the `debugger` agent. The debugger reads the failing artifact, opens the failing route in a browser if relevant, attaches screenshots, writes `.planning/phases/N-slug/DEBUG.md`, and proposes a fix. On RESOLVED, the failed step re-runs.

Limit: 2 debug attempts per phase. After that, the pipeline pauses for you.

### Production vs scratch

If `scope: scratch`, Steps 6 (adversarial) and 7 (security) are skipped entirely. The pipeline goes straight from Step 5f to Step 8 (PR). This keeps personal scripts moving fast without spurious gates.

---

## Agents and Mechanical Gates

Each agent lives as a single markdown file in `agents/`. The file IS the instruction, fully editable.

### Planner (`agents/planner.md`)

Builds `PLAN.md` from a phase goal. Goal-backward planning: start from the AC (acceptance criteria), decompose into tasks, group tasks into waves (parallel batches), pick a model per task. Reads `profile.yaml` for length, jargon policy, risk preference. Reads `taste.md` for project conventions. Default model: Opus. Configurable per phase via `planner_model:` in `ROADMAP.yaml`.

### Executor (`agents/executor.md`)

Implements `PLAN.md` tasks one by one, atomic commits. Reads the wave grouping and parallelizes within a wave. Applies the R1-R4 deviation protocol. Default runtime: Codex (via `codex:codex-rescue`). Falls back to Claude Sonnet when `executor_model: sonnet` is set or Codex is unavailable.

### Simplifier (`agents/simplifier.md`)

Structural smell pass on the diff. Looks for premature abstraction, misnaming, dead branches, copy-pasted code that should be a function. Gated by budget. Default model: Haiku.

### Scope Check (`scripts/scope-check.mjs`)

Diffs `PLAN.md` vs `SUMMARY.md`. Flags tasks that were silently dropped and smoke commands that were not reported. Runs inline with no LLM. Source of truth: `protocols/SCOPE-CHECK.md`.

### Adversarial-reviewer (`agents/adversarial-reviewer.md`)

Hunts logic bugs, race conditions, edge cases, missing error handling, off-by-one, incorrect assumptions. Runs on the **Codex CLI** as a different model family (catches Claude's blind spots). If the Codex CLI is unavailable, falls back to Opus with the adversarial prompt. Writes `REVIEW.md`. PASS or FAIL verdict.

### Plan-adversarial-reviewer (`agents/plan-adversarial-reviewer.md`)

Pre-execution pass on `PLAN.md`. Challenges optimistic plans, missing edge cases in AC, ambiguous task boundaries. Gated (Step 4b). Codex CLI.

### Architecture-adversarial-reviewer (`agents/architecture-adversarial-reviewer.md`)

Invoked at `/riff:start` Stage 2.5. Challenges the System Architecture before scope and roadmap lock.

### Roadmap-adversarial-reviewer (`agents/roadmap-adversarial-reviewer.md`)

Invoked at `/riff:start` Stage 4.5. Challenges `ROADMAP.yaml` before bootstrap (ordering, dependencies, phase granularity).

### Incident-adversarial-reviewer (`agents/incident-adversarial-reviewer.md`)

Invoked by the quarterly incident review (`protocols/INCIDENT.md` § Part 2). Challenges the synthesis draft before it's committed.

### Security-reviewer (`agents/security-reviewer.md`)

OWASP top-10 scan on every production phase: auth, input validation, injection, IDOR, secrets, error handling. Reads `SUMMARY.md` and `git diff main...HEAD`. Writes `SECURITY.md` with verdict `PASS`, `PASS-WITH-WARNINGS`, or `BLOCKED`. CRITICAL/HIGH findings auto-trigger debugger. Default model: Sonnet, with thinking budget per `protocols/MODEL.md`.

### Debugger (`agents/debugger.md`)

Auto-triggered on FAIL across the pipeline. Reads the failing artifact, opens the failing route in a headless browser (for frontend failures), takes a screenshot, writes `DEBUG.md` with root cause and proposed fix. Default model: Opus; Sonnet is an explicit `debug_model: sonnet` cost override.

### Improver (`agents/improver.md`)

Harvests learnings from recent phases into `.planning/expertise/.pending/`. Patches get reviewed and either merged into `taste.md` / stack files, or deferred, or rejected. Run via `/riff:improver` or auto-triggered at Step 7b when a phase meets the improver heuristic.

### Deep-auditor (`agents/deep-auditor.md`)

Cross-phase audit at milestone boundaries (phases tagged `milestone: <name>` in `ROADMAP.yaml`). Reads all phases in the milestone, identifies systemic issues, contradictions, decay. Triggered conversationally ("deep audit", "milestone review") or automatically at `/riff:next` Step 10 when the just-completed phase has a `milestone:` tag.

---

## Wave parallelization

Inside a phase, the planner groups independent tasks into **waves**. Tasks in the same wave have no dependencies on each other and can be executed in parallel by the executor.

Example PLAN.md:

```yaml
wave 1:
  - task 1: add User schema to schema.ts
  - task 2: add Product schema to schema.ts   # SAME FILE as task 1, NOT parallel-safe
wave 2:
  - task 3: add users.test.ts                  # depends on wave 1
  - task 4: add products.test.ts               # depends on wave 1
```

The planner's job is to detect cases like task 1+2 above (same file = serialize) and split them into separate waves. The executor trusts the wave grouping.

---

## Profile and budget

### profile.yaml

One file at the framework root by default, optionally overridden per project at `<project>/.planning/profile.yaml`. Resolution order: project override → framework default → default profile (`templates/profile.default.yaml`).

Fields (full schema in `commands/onboard.md` § Profile schema):

- `user.*` — programming level, AI agents experience, domains, work mode, side activities, conversational vs artifact vs narrative language
- `risk.sensitive_task_preference` — `cautious` / `balanced` / `fast`
- `style.*` — length, jargon policy, when to ask vs take initiative, explanation level
- `budget.default_quality` — `frugal` / `balanced` / `max`
- `notifications.channel` — `none` / `telegram` / `email`, where AFK mode pings you
- `git.merge_strategy` — `github_button` / `local_no_ff`
- `dashboard.language` — language for plain-language explanations

Edit by hand anytime, or ask Claude conversationally to update specific fields.

### Default profile

`default` is the 0-question shortcut during onboarding: a safe baseline (intermediate, generalist, standard length, first-mention jargon, balanced budget, no notifications). The `custom` path asks the full question set instead. The same map is the tier-3 fallback at the bottom of the resolution chain, shipped as `templates/profile.default.yaml`.

### Budget resolution

Four-level fallback chain for every decision (model choice, whether to run optional pipeline steps):

1. Per-phase override in `ROADMAP.yaml` (`executor_model:`, `simplify:`, etc.)
2. Per-project override in `ROADMAP.yaml` (`budget_quality:` top-level)
3. Profile default in `profile.yaml` (`budget.default_quality`)
4. Hardcoded default: `balanced`

Full spec: `protocols/MODEL.md` § Budget and model resolution.

---

## Hooks: the 3 buckets

Hooks are grouped into 3 buckets. Your profile picks which ones wire.

### Bucket A, always wired (universal discipline)

- `destructive-guard.sh` — block `rm -rf`, force-push to main, hard reset of upstream branches.
- `boundary-check.sh` — block cross-boundary imports (e.g., backend imports from frontend).
- `typecheck-gate.sh` — block commits that break `tsc --noEmit`.
- `test-gate.sh` — block commits that break the test suite.

### Bucket B, security-adaptable (driven by `risk.sensitive_task_preference`)

- `route-auth-guard.sh` — protect routes that touch auth-sensitive surfaces.
- `idor-detector.sh` — flag queries that don't scope to the authenticated user.
- `input-validation-guard.sh` — flag handlers that accept input without validation.
- `todo-orphan-guard.sh` — block `// TODO` without a seeded phase.

Wired all-on for `cautious`, partial for `balanced`, off for `fast`.

### Bucket C, stack/convention helpers

- `registry-reminder.sh` — remind to update the registry when a new module is added.
- `migration-gate.sh` — block commits that change a migration without running it.
- `notify-human.sh` — ping the user via the configured `notifications.channel`.

`registry-reminder.sh` and `migration-gate.sh` are invoked by `security-scan.sh` when matching files are staged. `notify-human.sh` is a manual helper for agents, not an init-selected hook.

### Shared infrastructure

- `commit-msg.sh` — no-op placeholder; commit wording is a RIFF convention, not a hook-enforced format.
- `security-scan.sh` — staged-file secret scan, `.env` blocking, quality warnings, and project tests when dependencies are installed.
- `log-warning.sh` — central warning logger.
- `orphan-file-check.sh` — flag files created but not imported.
- `test.sh` — test runner helper.

Details: `hooks/README.md` § Buckets.

---

## Unattended runs: /riff:wave

`/riff:wave` bundles N parallel-eligible phases and delegates execution to Codex. Opus plans, Codex executes, and opt-in smoke/browser checks prove it works.

Eligibility: phase has `status: todo`, `mode: AFK`, `provider_mode != production`, all upstream `depends_on` are `done`.

Two routes (decided per Step 4 of `commands/wave.md`):

- **In-process** — ≤1 phase under 30 min: spawned via the `codex:codex-rescue` skill, blocks Claude until done.
- **Out-of-process** — ≥2 phases or over 30 min: Claude prints the exact `codex --dangerously-bypass-approvals-and-sandbox` command, the user runs it in a separate Codex terminal. Come back with `/riff:wave --resume W{N}`.

It stops on: FAIL on any phase, security BLOCKED, smoke/browser-check FAIL after fix-retest cycles, or scope drift. Phases marked `mode: HITL` never enter a wave.

### HITL vs AFK phases

- **AFK** (default) — autonomous. Code-only auth/payment/security work qualifies (security-reviewer + adversarial-reviewer are the safety net).
- **HITL** — requires you present. Reserved for: real OAuth/SSO against a prod IdP, real payment checkout, MFA / hardware token, DNS / prod cutover, irreversible migrations.
- **Sandbox HITL** — provider flows in sandbox mode (`provider_mode: sandbox`). `/riff:next` does NOT pause — routed through the browser verification protocol (`references/BROWSER-VERIFICATION.md`, Lightpanda + chrome-devtools-mcp) instead of pausing for human OAuth or test-checkout.

---

## Dashboard

`/riff:dashboard` boots a local web server (Bun, port 4000) with:

- Kanban view of all phases (todo, in-progress, done, blocked, skipped).
- Plain-language pre-execution and post-mortem explanations, generated at the level your `profile.yaml` declares (technical, simple, eli5).
- Generation metadata per phase: real duration from git timestamps, file diff stats, gate outcomes (Step 4b plan-adversarial, 5b simplifier, 5d fallow, 6 adversarial, 7 security), Codex CLI usage (model / effort / outcome / duration), agents observed in commit trailers.

Read-only. Driving still happens in the terminal.

Details: `dashboard/README.md`.

---

## Debug and improver

### Auto-debug

Runs automatically on FAIL across the pipeline. Reads the failing artifact, opens the failing route in a headless browser when relevant (Lightpanda + chrome-devtools-mcp), attaches screenshots to `DEBUG.md`, proposes and applies a fix. On RESOLVED, the failed step re-runs.

Limit: 2 attempts per phase. After that, the pipeline pauses for you. Re-run with `/riff:debug <bug>` for a manual third attempt.

### Manual debug

`/riff:debug <bug>` for bugs that surfaced post-merge or outside `/riff:next`. Writes `.planning/debug/YYYY-MM-DD-<slug>.md`.

### Improver

Two paths:

- **Auto** — at Step 7b of `/riff:next`, gated by the improver heuristic (recurring corrections, novel pattern, surprising deviation). Writes a patch proposal to `.planning/expertise/.pending/<agent>-<phase>.md`.
- **Manual** — `/riff:improver N` (default 3) or `/riff:improver --all` to backfill across the recent phase history.

Pending expertise patches are reviewed at the end of the next `/riff:next` Step 10. Three options: review now (apply or reject), defer to next phase, reject all.

---

## File structure

```
~/your/path/riff/                # framework root
├── README.md                    # 1-page pitch + install
├── HOW-IT-WORKS.md              # this file
├── CLAUDE.md                    # rules, always loaded
├── DECAY.md                     # pruning protocol
├── profile.yaml                 # YOUR config (gitignored)
├── profile.yaml.example         # schema with field comments
├── riff                         # node CLI shim (riff init ...)
├── agents/                      # 13 agents (single markdown each)
├── commands/                    # 14 slash commands + INDEX.md
├── hooks/                       # 18 hooks + README.md
├── protocols/                   # ~20 workflow contracts: EXECUTION, MODEL, QUALITY, INCIDENT, PROMOTE, etc.
├── references/                  # ~10 references: PROFILE-RESOLUTION, BROWSER-VERIFICATION, taste/, etc.
├── templates/                   # PROJECT.md, ROADMAP.yaml, settings JSONs, banner.sh, etc.
├── scripts/                     # riff-init.mjs, riff-codex.mjs, gates-update.mjs, etc.
└── dashboard/                   # local web dashboard (Bun + React)
```

Project side (after `/riff:init`):

```
<project>/
├── .riff/                       # symlink to ~/your/path/riff/ (gitignored)
├── .claude/
│   ├── commands/riff/           # symlinks to .riff/commands/
│   ├── agents/riff/             # symlinks to .riff/agents/
│   └── hooks/riff/              # symlinks to .riff/hooks/
├── .git/hooks/
│   ├── pre-commit               # symlink to .riff/hooks/security-scan.sh
│   └── commit-msg               # symlink to .riff/hooks/commit-msg.sh
├── .planning/
│   ├── config.json              # scope: production | scratch
│   ├── profile.yaml             # OPTIONAL per-project override
│   ├── phases/                  # one folder per phase: PLAN.md, SUMMARY.md, REVIEW.md, etc.
│   ├── expertise/.pending/      # improver proposals waiting for review
│   ├── seeds/                   # R4 out-of-scope seeds
│   ├── debug/                   # manual /riff:debug artifacts
│   └── quick/                   # /riff:quick artifacts
├── PROJECT.md                   # product definition (from /riff:start)
├── ROADMAP.yaml                 # ordered phases
├── STATE.md                     # current position
├── taste.md                     # project conventions
└── INCIDENTS.md                 # production incidents (production scope)
```

---

## Model selection

RIFF dispatches across 3 model families. Each has a job it's good at.

| Family    | When used                                                                                  |
| --------- | ------------------------------------------------------------------------------------------ |
| **Opus**  | Planning (default). Debug (default). Adversarial fallback when Codex CLI is unavailable.   |
| **Sonnet**| Claude fallback execution. Security review. Debug cost override. Most general-purpose work. |
| **Haiku** | Simplifier. Pre-exec + post-mortem explanations for the dashboard.                         |
| **Codex** | Adversarial review (different model family, catches Claude's blind spots).                 |

### Where the decision lives

| Step                             | Mechanism             | Default model        | Override                                                  |
| -------------------------------- | --------------------- | -------------------- | --------------------------------------------------------- |
| Step 4: Plan                     | Inline (frontmatter)  | Opus                 | `planner_model:` per phase in `ROADMAP.yaml`              |
| Step 4b: Plan adversarial        | Sub-agent (Codex)     | Codex CLI            | Falls back to Opus if Codex unavailable                   |
| Step 4c: Pre-exec explanation    | Sub-agent             | Haiku                | (none)                                                    |
| Step 5: Execute                  | Codex (in-process)    | Codex CLI (default)  | `executor_model: sonnet` forces Claude fallback            |
| Step 5b: Simplify                | Sub-agent             | Haiku                | `simplify_model:` per phase                                |
| Step 6: Adversarial review       | Sub-agent (Codex)     | Codex CLI            | Falls back to Opus                                        |
| Step 7: Security review          | Sub-agent             | Sonnet               | `security_model:` per phase                                |
| Step 7b: Improver                | Sub-agent             | Haiku                | (gated, see AUTO-TRIGGERS.md)                             |

### Codex CLI fallback

The Codex CLI (`@openai/codex`) is optional. If unavailable, RIFF falls back automatically:

- Adversarial review → Opus with the adversarial prompt.
- Plan adversarial → Opus with the plan-adversarial prompt.

The fallback is announced in the pipeline output. To get the Codex pass, install `@openai/codex` and run `codex auth` once.

Full spec: `protocols/MODEL.md`.

---

## Philosophy

The creator of Claude Code runs on roughly 100 lines of CLAUDE.md, a handful of terminals, plan mode, and a small set of slash commands. That's the target. RIFF gives you scaffolding to reach it without reinventing the planner, security reviewer, or hook discipline from scratch.

**Inspect before adopting.** Every file in this repo is meant to be edited. Agents are markdown, the file IS the instruction. Commands are markdown with YAML frontmatter. Hooks are bash. No black boxes.

**Delete when redundant.** When Claude Code ships a native feature that replaces one of your hooks or commands, you delete the piece. The framework is a kit, not a contract.

**Prune quarterly.** Walk through `DECAY.md` and remove what isn't earning its keep.

Your framework is yours.

---

## Where to go next

- [`README.md`](./README.md) — 1-page pitch and install path
- [`commands/INDEX.md`](./commands/INDEX.md) — every slash command, one-liner each
- [`commands/next.md`](./commands/next.md) — full `/riff:next` pipeline spec (every step in detail)
- [`agents/`](./agents/) — read the agent you want to understand
- [`protocols/EXECUTION.md`](./protocols/EXECUTION.md) — confidence gates, R1-R4 deviations, waves
- [`protocols/MODEL.md`](./protocols/MODEL.md) — model dispatch and budget resolution
- [`protocols/QUALITY.md`](./protocols/QUALITY.md) — post-build quality checks
- [`references/PROFILE-RESOLUTION.md`](./references/PROFILE-RESOLUTION.md) — profile chain
- [`hooks/README.md`](./hooks/README.md) — hook buckets
- [`dashboard/README.md`](./dashboard/README.md) — local web dashboard
- [`DECAY.md`](./DECAY.md) — pruning protocol

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

## What Is RIFF?

RIFF is a structured development framework for Claude Code. It turns "I want to build X" into a repeatable loop: **plan, build, verify, commit**, one phase at a time.

Each phase runs in a fresh context with full state on disk. You can stay in the loop and correct as you go, or leave it running unattended while you do something else.

RIFF works on **any project**, new or existing. It gives you 8 specialized agents (planner, executor, simplifier, scope-checker, adversarial-reviewer, security-reviewer, improver, debugger), shared protocols, and 14 commands that orchestrate them.

**Who it's for:** solo developers building with Claude Code who want structure, quality, and the ability to step away from the keyboard without everything falling apart.

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [The Two Paths: Greenfield vs Brownfield](#the-two-paths-greenfield-vs-brownfield)
- [Commands Reference](#commands-reference)
- [The Core Loop: /riff:next](#the-core-loop-riffnext)
- [Git Workflow: Branch per Phase](#git-workflow-branch-per-phase)
- [Wave Parallelization](#wave-parallelization)
- [The Agents](#the-agents)
- [Debugging](#debugging)
- [Unattended Mode (Ralph Loop)](#unattended-mode-ralph-loop)
- [Framework Updates and Self-Improvement](#framework-updates-and-self-improvement)
- [Key Concepts](#key-concepts)
- [File Structure](#file-structure)
- [Using RIFF on Your Own Projects](#using-riff-on-your-own-projects)
- [Model Selection](#model-selection)
- [AI-Readable Documentation](#ai-readable-documentation)
- [Philosophy](#philosophy)

---

## Installation

RIFF installs into your project via a symlink to your local framework repo. One source of truth, every project stays in sync.

```bash
# In your project directory, run:
/riff:init
```

This does the following:

1. **Links the framework** — `.riff/` becomes a symlink to `~/DEV/frameworks/riff/`
2. **Creates symlinks** from `.claude/commands/riff/` and `.claude/agents/riff/` to `.riff/`
3. **Creates local files** that are project-specific (`.planning/`, `STATE.md`)
4. **Installs hooks** — git hooks (security scan, commit message) + Claude Code hooks (settings.json)
5. **Adds `.riff/` to `.gitignore`** (the symlink is local, not portable)

### How Symlinks Work

```
~/DEV/frameworks/riff/                    <-- your local repo (single source of truth)
        ^
        |
.riff/ -> symlink                         <-- project points to the repo
        |
        v
.claude/commands/riff/next.md             <-- symlink to ../../../.riff/commands/next.md
                                               which resolves to the real file in your repo
```

When you type `/riff:next`, Claude Code reads `.claude/commands/riff/next.md`, follows the symlink chain, and executes the real file from your repo. Update the repo once, every project sees the change instantly.

**Result:**

```
your-project/
  .riff/ -> ~/DEV/frameworks/riff/   # symlink to framework repo (gitignored)
  .claude/
    commands/riff/next.md            # symlink -> .riff/commands/next.md
    agents/riff/planner.md           # symlink -> .riff/agents/planner.md
    agents/riff/CLAUDE.md            # local COPY (project-specific rules)
    hooks/riff/boundary-check.sh     # symlink -> .riff/hooks/boundary-check.sh
    settings.json                    # Claude Code hooks config
  # riff-loop.sh lives inside .riff/ (no root symlink)
  .planning/                         # local (plans, expertise, seeds)
  taste.md                           # local (project-specific rules)
  ROADMAP.yaml                       # local (project state)
```

### Updating RIFF

No action needed. `.riff/` is a symlink to your local repo. Any changes you make in `~/DEV/frameworks/riff/` are immediately available in all projects.

---

## Quick Start

### New project (greenfield)

```bash
/riff:init              # Install RIFF into the project
/riff:start             # Define what to build (questions, wireframes, roadmap)
/riff:next              # Build the next phase
/riff:status            # Where am I?
```

### Existing project (brownfield)

```bash
/riff:init              # Install RIFF into the project
/riff:map               # Explore the codebase, extract architecture + conventions
/riff:next              # Start working on it
```

That's it. Everything else flows from these entry points.

---

## The Two Paths: Greenfield vs Brownfield

### Path A: Greenfield (new project from scratch)

You have an idea. No code exists yet. Here's the full workflow:

```
/riff:init
    |
    v
/riff:start  <-- 5-stage discovery pipeline (interactive)
    |
    |  Stage 1: Deep Questioning (9 extraction axes)
    |    - End Goal, Core Problem, User Types, Business Model
    |    - MVP Functionalities, Key User Stories, Competitive Context
    |    - Success Metrics, Constraints
    |    - "Follow energy" style, not checklist walking
    |    - Optional: reads .research/findings.md if present
    |
    |  Stage 2: Product Design Modules (draft-first, user adjusts)
    |    - Pages & Functionality (with ASCII wireframes per screen)
    |    - Data Model Strategy (entities, fields, relationships)
    |    - System Architecture (mermaid diagram, external services)
    |    - Module activation matrix by project type
    |      (saas/web-app = all 3, api = data + arch, cli/skill = skip)
    |
    |  Stage 2.5: Cross-Module Validation (agent-style checks)
    |    - Every user story -> at least one page
    |    - Every page with data -> entity in data model
    |    - Every entity -> stored in a component in architecture
    |    - Every external service -> visible in at least one page
    |    - Every v1 feature -> appears in at least one module
    |
    |  Stage 3: Feature Scoping (v1 / Later / Out of Scope)
    |    - AI proposes initial categorization, user adjusts
    |
    |  Stage 4: Roadmap Generation with Self-Critique
    |    - Vertical slices, not horizontal layers
    |    - Phase 1 is always a tracer bullet (thin end-to-end)
    |    - HITL only for phases needing manual verification (OAuth flow, payment, prod cutover)
    |    - Self-critique: ordering, dependencies, gaps, sizing
    |
    |  Stage 5: Bootstrap
    |    - Writes PROJECT.md, ROADMAP.yaml, CONTEXT.md
    |    - Initial taste.md (Architecture + Stack-specific + Backend, Security, Testing, UX)
    |    - STATE.md, .planning/ directory structure
    |
    v
/riff:next  <-- The build loop (repeat until done)
    |
    |  Pick next phase -> Plan -> Execute -> Simplify -> Scope check -> Review -> PR -> Update state
    |  (see "The Core Loop" section below for details)
    |
    v
/riff:status  <-- Check progress, review proposed taste rules, see what's next
```

**What you get after `/riff:start`:**

| File           | What's inside                                                               |
| -------------- | --------------------------------------------------------------------------- |
| `PROJECT.md`   | Vision, users, features, user stories, wireframes, architecture, data model |
| `ROADMAP.yaml` | All phases with status, priority, mode (AFK/HITL), dependencies             |
| `CONTEXT.md`   | Every decision made during discovery, locked for reference                  |
| `taste.md`     | Architectural rules Claude must follow when writing code                    |
| `STATE.md`     | Current position, blockers, what's next                                     |

### Path B: Brownfield (existing project)

You inherited a codebase, joined an existing project, or want to apply RIFF to something already built. The challenge: RIFF's agents need to understand the project before they can work on it.

```
/riff:init
    |
    v
/riff:map  <-- Codebase exploration (automated + human review)
    |
    |  Step 1: Stack Detection
    |    - Languages, frameworks, package manager, build tools
    |    - Runtime versions, deployment target
    |    - What do the scripts (build, dev, test, lint) actually run?
    |
    |  Step 2: Architecture Mapping
    |    - Project structure pattern (monorepo, standard, custom)
    |    - Directory map with purpose annotations
    |    - Entry points, data flow, external dependencies
    |    - Infrastructure (Docker, CI, env vars)
    |
    |  Step 3: Convention Extraction
    |    - Naming conventions, code style patterns
    |    - Component patterns, data fetching approach
    |    - Testing patterns, auth patterns, error handling
    |    - Linting/formatting config
    |
    |  Step 4: Dependency & Risk Map
    |    - Tightly coupled modules, outdated dependencies
    |    - Tech debt signals (TODOs, disabled tests, commented-out code)
    |    - Missing pieces (no tests, no types, no validation)
    |    - Security concerns
    |
    |  Step 5: Spec Backfill
    |    - Brief spec per major feature/module
    |    - These specs let the planner work on this project
    |      the same way it works on greenfield
    |
    |  Step 6: Summary & Handoff
    |    - Key findings, recommended first actions
    |    - Open questions for you to answer
    |
    v
Human review  <-- You correct what the explorer got wrong
    |
    v
/riff:next  <-- Start building (same loop as greenfield)
```

**What you get after `/riff:map`:**

| File                        | What's inside                                          |
| --------------------------- | ------------------------------------------------------ |
| `.planning/architecture.md` | Stack summary, directory map, data flow, external deps |
| `taste.md`                  | Extracted conventions (marked for your review)         |
| `.planning/risks.md`        | Dependency issues, tech debt, security concerns        |
| `.planning/specs/*.md`      | One spec per major feature/module                      |
| `SUMMARY.md`                | Key findings, recommendations, open questions          |
| `STATE.md`                  | Updated: mapped, ready for planning                    |

**`/riff:map` options:**

| Usage                               | What it does                                                    |
| ----------------------------------- | --------------------------------------------------------------- |
| `/riff:map`                         | Full exploration of the entire project                          |
| `/riff:map --quick`                 | Fast scan, stack + architecture only (2 min)                    |
| `/riff:map --focus=backend`         | Deep dive into one concern (backend, frontend, api, auth, data) |
| `/riff:map src/api --focus=backend` | Deep dive into a specific directory                             |

---

## Commands Reference

| Command                  | When to use it                                                |
| ------------------------ | ------------------------------------------------------------- |
| `/riff:init`             | Once, at the start. Installs RIFF into the project.           |
| `/riff:start`            | Greenfield only. Define what to build before writing code.    |
| `/riff:map`              | Brownfield only. Explore an existing codebase.                |
| `/riff:next`             | The main loop. Plan, build, verify, commit the next phase.    |
| `/riff:next --plan-only` | Create the plan but don't execute. Review before building.    |
| `/riff:next [phase-N]`   | Target a specific phase instead of auto-picking.              |
| `/riff:status`           | Dashboard: progress, blockers, pending taste rules, seeds.    |
| `/riff:quick <task>`     | Small task without phase overhead. Bug fixes, tweaks, config. |
| `/riff:check`            | Manual verification + security review on demand.              |
| `/riff:check [phase-N]`  | Verify a specific phase.                                      |
| `/riff:debug <issue>`    | Structured debugging with root cause analysis.                |
| `/riff:add-phase`        | Add one or more phases to ROADMAP.yaml.                       |
| `/riff:review-expertise` | Review pending expertise patches proposed by the improver.    |
| `/riff:onboard`          | Write `profile.yaml` (13 questions or pick a preset).         |
| `/riff:preferences`      | Re-answer one or more profile questions.                      |
| `/riff:learn-stack`      | Add a new stack reference file under `references/taste/stacks/`. |
| `/riff:loop`             | Run unattended mode (Ralph loop) for AFK phases.              |
| `/riff:incident`         | Log a production incident.                                    |
| `/riff:incident-review`  | Quarterly review of logged incidents.                         |

### When to use what

| Situation                                | Command                                    |
| ---------------------------------------- | ------------------------------------------ |
| Starting a brand new project             | `/riff:init` then `/riff:start`            |
| Joining an existing project              | `/riff:init` then `/riff:map`              |
| Building the next feature                | `/riff:next`                               |
| Want to review the plan before building  | `/riff:next --plan-only`                   |
| Quick bug fix or config change           | `/riff:quick fix the login redirect`       |
| Something broke                          | `/riff:debug users see other users' data`  |
| Want to add phases to the roadmap        | `/riff:add-phase Manual Campaigns`         |
| Want to check current progress           | `/riff:status`                             |
| Want a security audit                    | `/riff:check`                              |
| Want to leave Claude building unattended | `.riff/riff-loop.sh` (see Unattended Mode) |

---

## The Core Loop: /riff:next

This is the heartbeat of RIFF. Every call to `/riff:next` runs this sequence:

```
Read state
    |
    v
Pick next phase  <-- From ROADMAP.yaml (highest priority, deps met, not blocked)
    |
    v
Create branch  <-- riff/phase-N-slug (or checkout existing if fixing a failed phase)
    |
    v
Confidence gate  <-- Scope clear? Codebase understood? Output defined? Risks?
    |               If not ready: asks you questions instead of guessing
    v
Planner (inline, Opus)  <-- Creates PLAN.md (goal-backward: what must be TRUE when done?)
    |                        2-4 tasks per plan, wave grouping, explicit file boundaries
    v
Executor (sub-agent, Sonnet)  <-- Implements tasks with atomic commits
    |                              Same-wave tasks run in parallel (Agent subagents)
    |                              Follows R1-R4 deviation rules (see Key Concepts)
    v
Simplifier (sub-agent, Haiku, gated)  <-- Reviews diff for dead code, naming, over-engineering
    |                                      Applies after confirmation, separate refactor commits
    v
Scope-checker (sub-agent, Haiku)  <-- Diffs PLAN tasks vs SUMMARY entries
    |                                  On DROPPED: stops, asks user how to reconcile
    v
Adversarial review (Codex)  ‖  Security review (Sonnet)  <-- IN PARALLEL
    |                                                          Codex hunts logic/race/edge bugs
    |                                                          Sonnet runs OWASP top 10
    v
Improver (sub-agent, Haiku, background, gated)  <-- Proposes expertise patches
    |                                                Writes to .planning/expertise/.pending/
    v
Documentation check (BLOCKING)  <-- project-details, architecture.md, taste.md up to date?
    |                                Spawn Haiku sub-agent to fix gaps if any
    v
Push branch + create PR (no merge)  <-- gh pr create with phase title, artifacts, status
    |                                    User reviews and merges manually
    v
Update state on main (after merge)  <-- ROADMAP.yaml + STATE.md committed on main
    |
    v
Learn  <-- Taste proposals (PENDING in taste.md), seed triggers
    |
    v
Report + usage  <-- Tokens, duration, pending expertise count
```

**If verification fails:** the next `/riff:next` reads the previous VERIFICATION.md. If it has `FAIL`, no new phase is picked. A fix plan is created on the existing branch instead. You don't skip broken phases.

**If the plan seems wrong:** use `/riff:next --plan-only` to review the plan first. Correct it, then run `/riff:next` to execute.

**Auto-debug pattern:** when the executor errors, the adversarial review FAILs, or the security review finds CRITICAL/HIGH, the debugger fires automatically. It diagnoses, attempts a targeted fix, writes DEBUG.md, then the originating step re-runs. Disable per phase with `auto_debug: false`.

---

## Git Workflow: Branch per Phase

Every phase runs on its own git branch and produces a pull request.

```
main
  └─ riff/phase-1-tracer-bullet
  │    ├─ feat(phase-1): create user schema and migration
  │    ├─ feat(phase-1): add login route with loader
  │    └─ PR #1 → user reviews → squash merge → main
  └─ riff/phase-2-dashboard
       ├─ feat(phase-2): create dashboard layout
       ├─ feat(phase-2): add stats API endpoint
       └─ PR #2 → user reviews → squash merge → main
```

**Commit message format, conventional commits:**

```
type(scope): short description of what it does
```

- **type**: `feat`, `fix`, `test`, `refactor`, `docs`, `chore`
- **scope**: `phase-N`, `quick-N`, or module name
- **description**: what the commit DOES, readable by someone who doesn't know what "phase 2" means internally

State updates (ROADMAP.yaml, STATE.md) are committed on `main` AFTER the PR merges, never on the feature branch and never as separate "chore: mark phase done" commits on a feature branch.

**How it works:**

1. Before planning, RIFF creates `riff/phase-N-slug` from `main`
2. All task commits happen on the branch (executor, then simplifier as a separate `refactor:` commit)
3. After scope check + parallel reviews pass, RIFF creates a PR via `gh`
4. **RIFF never auto-merges.** The user reviews the PR and merges manually.
5. After the user merges, the orchestrator switches to `main`, pulls, and commits the state update

**If a phase fails verification:** the branch stays open. The next `/riff:next` checks out the existing branch and creates a fix plan. No new branch, no orphaned work.

**Benefits:**

- Clean `main` history (one squash commit per phase + one state-update commit)
- Easy rollback (revert one PR)
- Every PR is reviewed before merge, safe for production repos
- Full task-level history preserved in the branch

---

## Wave Parallelization

Within a single phase, tasks are grouped into **waves** by the planner. Tasks in the same wave have zero file overlap and run in parallel.

```
Phase 3: User Dashboard
  Wave 1: Task 1 (stats component) + Task 2 (activity feed)    <- parallel
  Wave 2: Task 3 (dashboard page wiring stats + feed)          <- sequential
```

**How it works:**

1. The planner assigns tasks to waves based on file boundaries
2. The executor spawns one Agent sub-agent per task in the same wave
3. All agents in a wave launch simultaneously (parallel execution)
4. After the wave completes, the executor reads what was built before starting the next wave

**Safety guarantees:**

- The planner verifies **zero file overlap** in boundaries before grouping tasks into a wave
- The planner also verifies **logical dependencies** via each task's `requires:` field (symbols, exports, or files produced by other tasks). If task B `requires` output from task A, B must be in a strictly later wave, even when their file lists do not overlap. Example: task A creates `lib/auth.ts` exporting `verifyToken`; task B in `routes/admin.ts` imports `verifyToken`, so B's wave > A's wave.
- Common conflict sources are explicitly checked: barrel exports, schema files, config files
- If a conflict is detected at runtime, it's logged as R1 and resolved manually
- **When in doubt, the planner uses separate waves.** Sequential is always safe.

**Single-task waves** execute normally (no sub-agent overhead).

---

## The Agents

RIFF has 8 specialized agents. Each runs in a fresh context with only the files it needs. Agents reference shared **protocols** (`protocols/`) for common rules like the Confidence Gate, R1-R4 deviation rules, model selection, and wave execution, keeping each agent file compact while maintaining consistent behavior.

### Planner

**Role:** senior software architect.
**Model:** Opus (runs inline in `/riff:next`, not as a sub-agent).
**What it does:** creates PLAN.md files that are executable prompts. Plans goal-backward: starts with "what must be TRUE when this phase is done" and works backwards to tasks.
**Key behaviors:**

- 2-4 tasks per plan, each with explicit file boundaries
- Wave grouping (parallel tasks in same wave, dependent tasks in separate waves)
- Model recommendation per phase (default Sonnet, Opus only for novel architecture, 10+ tightly coupled files, or unfamiliar external API integration)
- Adds security-aware ACs automatically (input validation, IDOR scoping, auth checks)
- Auto-proposes TDD mode for auth/payment/business rules/public API contracts/bug-fix phases
- Calibrates plan density and safety from `profile.yaml` (e.g. tighter ACs for `novice`/`learner`, terser plans for `expert`)

### Executor

**Role:** senior full-stack developer.
**Model:** Sonnet default. Override per phase with `executor_model: opus`.
**What it does:** receives a PLAN.md and implements it task by task with atomic commits.
**Key behaviors:**

- Reads taste.md, profile.yaml, expertise files, and stack-specific gotchas (Drizzle, Zod, RR7, Vitest, Node ESM) before writing
- Launches parallel sub-agents for tasks marked `parallel:` in PLAN.md
- Verifies each AC with actual evidence (3-Level check: EXISTS / SUBSTANTIVE / WIRED)
- Non-negotiable code quality: no `any`, no `console.log`, no hardcoded secrets, no IDOR, no `// TODO` without seed/issue
- Stages explicitly (never `git add .`), one conventional commit per task
- Updates project documentation (`.claude/references/project-details.md`, `docs/architecture.md`, `taste.md`) at end of phase

### Simplifier

**Role:** ruthless but respectful code simplifier.
**Model:** Haiku (diff-scoped pattern work needs no deep reasoning).
**What it does:** runs after the executor and BEFORE adversarial + security review (Step 5b in `/riff:next`), so reviewers audit the simplified code. Reviews the branch diff for dead code, naming issues, structural complexity, and over-engineering. Proposes targeted simplifications respecting project taste rules.
**Key behaviors:**

- Gated by `simplify:` field in ROADMAP.yaml (`true` | `false` | `auto`); `auto` skips phases with <3 changed files or `config-only`/`trivial` tags
- Scope discipline: never touches files outside the branch diff
- Applies after confirmation, never auto-applies in pipeline
- Writes `.planning/phases/N-slug/REFACTOR.md` with proposals, applied changes, lines saved, and test results
- Commits as separate `refactor(phase-N):` commits
- Emits expertise to `.planning/expertise/.pending/` when recurring over-engineering patterns appear (3+ consecutive phases)

### Scope-checker

**Role:** plan-vs-completion auditor.
**Model:** Haiku.
**What it does:** diffs PLAN.md tasks against SUMMARY.md completion entries. Flags silently dropped tasks so the executor cannot quietly reduce scope.
**Key behaviors:**

- Returns exactly one of: `MATCH` (every PLAN task acknowledged in SUMMARY), `DROPPED: <comma-separated task names>` (one or more PLAN tasks unacknowledged), `MALFORMED: <reason>` (could not parse)
- On `DROPPED`, the orchestrator surfaces each task to the user: mark done / defer to new phase / reject with rationale
- Loops until `MATCH` before proceeding to review
- Does not propose fixes, just reports

### Adversarial reviewer (Codex)

**Role:** different-model code reviewer. Catches Claude's blind spots.
**Model:** Codex (GPT). If the local Codex CLI is unavailable, falls back to Opus with the adversarial prompt.
**What it does:** reviews the branch diff for real bugs using a different model than the one that wrote the code. Same-model review catches less.
**Key behaviors:**

- Runs in parallel with the security reviewer
- Hunts logic errors, race conditions, edge cases (empty arrays, null, zero-length), missing error handling, broken contracts, incorrect assumptions about external APIs
- Does NOT do style nitpicks, OWASP, architecture, or test coverage (other agents/hooks handle those)
- Severity: BLOCKER (must fix) > WARNING (should fix) > NOTE (consider)
- FAIL = any BLOCKER finding, or tests/typecheck fail
- Gated by `adversarial:` in ROADMAP.yaml. On FAIL, auto-debug fires, then Step 6 re-runs after RESOLVED
- Writes `.planning/phases/N-slug/REVIEW.md`

### Security reviewer

**Role:** OWASP top 10 safety net.
**Model:** Sonnet, with thinking keyword `think harder` for auth/payment/public-API surfaces and `think hard` otherwise.
**What it does:** OWASP top 10 scan focused on the changes made in each phase. Adversarial reasoning ("how would an attacker abuse this?") before mapping to OWASP categories.
**Key behaviors:**

- Runs in parallel with the adversarial reviewer
- IDOR check on every database query with an ID parameter
- Input validation check on every API endpoint (Zod or equivalent)
- Auth check on every protected route (`requireUserId` or equivalent)
- Calibrates from `profile.yaml`: stricter when user has no backend/security domain or low programming level
- Severity: CRITICAL > HIGH > MEDIUM > LOW
- CRITICAL/HIGH blocks PR creation, auto-debug fires
- Pre-commit lightweight mode runs in the git hook (secrets, `console.log` of sensitive data, `any` types, missing auth on new routes, unvalidated DB input)

### Improver

**Role:** lightweight retrospective coach.
**Model:** Haiku, runs in the background.
**What it does:** runs after the parallel reviews pass. Reads the phase SUMMARY and existing expertise files, then proposes a patch to one or more `expertise/<agent>.md` files. Also flags missing commands or documentation gaps in RIFF itself.
**Key behaviors:**

- Single Haiku run, file output only, never blocks the pipeline
- Writes proposals to `.planning/expertise/.pending/<agent>-<phase>.md`
- Tier each pattern: `STACK:<name>` / `ARCHITECTURE` / `PROJECT` (controls destination, framework reference vs project expertise)
- Surfaces framework gaps as `framework-<phase>.md` proposals
- **Never auto-merges.** Human always validates via `/riff:review-expertise`
- `/riff:status` surfaces pending patch counts. At 3+ pending patches the loop pauses and asks whether to review before the next phase

### Debugger

**Role:** autonomous root-cause investigator.
**Model:** Opus (debug is reasoning-heavy and failures are high-stakes). Override with `debug_model: sonnet`.
**What it does:** diagnoses failures in the pipeline (executor errors, adversarial FAIL, security CRITICAL/HIGH) and attempts a targeted fix. Also invoked manually via `/riff:debug`. Writes `DEBUG.md` with a structured report.
**Key behaviors:**

- No interactive questions, receives failure context, diagnoses from what it has
- Auto-selects thinking budget from failure artifact (ultrathink for race conditions / flaky / 2+ failed attempts → none for typos)
- Forms falsifiable hypotheses, tests each with evidence, fixes root cause
- After fix: re-runs the originating step, OR accepts RESOLVED without re-run when debugger ran with Opus AND verification reports tests green + tsc clean AND every finding has a corresponding new test pinning the fix
- Gated by `auto_debug:` in ROADMAP.yaml (default `true`)
- If root cause requires an architectural decision (R3): writes UNRESOLVED and surfaces to user instead of guessing

---

## Debugging

RIFF has two levels of debugging.

### Level 1: pipeline auto-debug + /riff:debug

**Auto-triggered** inside `/riff:next` when the executor fails, adversarial review returns FAIL, or security finds CRITICAL/HIGH. The Debugger agent (`agents/debugger.md`) fires automatically, diagnoses the failure, attempts a fix, writes `DEBUG.md`, and re-runs the check that failed to confirm resolution.

**Manual** via `/riff:debug` for bugs you notice outside the pipeline:

```bash
/riff:debug users can see other users' data on the dashboard
/riff:debug the build fails with "Cannot find module" after adding the new component
/riff:debug webhook handler returns 500 intermittently
```

**What happens:**

1. Quick triage, simple error? Fix inline without spawning.
2. Check `.planning/debug/` for an existing session (resumes if found).
3. Spawn Debugger agent (Opus): auto-selects thinking budget, forms falsifiable hypotheses, tests each with evidence, fixes root cause.
4. Writes `.planning/debug/YYYY-MM-DD-[slug].md` with a structured report (issue, triage tier, hypotheses, root cause, fix, verification, status).
5. If recurring pattern: log in `.planning/mistakes/`.

Disable auto-triggers for a specific phase with `auto_debug: false` in ROADMAP.yaml.

### Level 2: /debug (the skill)

For complex bugs that resist the standard process. Loads comprehensive debugging methodology + domain-specific expertise (React, Rust, Python, Swift, etc.).

**When to escalate:** after the Debugger returns UNRESOLVED, or when dealing with unfamiliar library/framework behavior requiring deep research.

---

## Unattended Mode (Ralph Loop)

Leave RIFF building while you do something else. It spawns a fresh Claude Code agent per iteration, each reading state from disk.

```bash
# Basic usage
.riff/riff-loop.sh /path/to/project

# Single iteration (test one loop pass)
.riff/riff-loop.sh -n 1

# Run exactly 3 iterations
.riff/riff-loop.sh -n 3 /path/to/project

# With Telegram notifications
RIFF_TELEGRAM_BOT_TOKEN=xxx RIFF_TELEGRAM_CHAT_ID=yyy .riff/riff-loop.sh /path/to/project
```

**How it works:**

```
Loop iteration:
    |
    v
Read ROADMAP.yaml  <-- Any AFK phases left?
    |
    v
Spawn fresh Claude Code agent  <-- Runs /riff:next in AFK mode
    |                               Only picks mode: AFK phases
    |                               Proceeds on Confident/Likely
    v
Agent finishes  <-- Commits changes, updates state
    |
    v
Check stop conditions:
    - Verification failure    -> STOP, notify
    - R3 (architecture change) -> STOP, notify
    - Security CRITICAL/HIGH   -> STOP, notify
    - Unclear assumptions      -> STOP, notify
    - All phases complete      -> STOP, notify "BUILD COMPLETE"
    - No stop condition        -> Next iteration (after cooldown)
```

**Configuration:**

| Option / Env variable     | Default | Description                                    |
| ------------------------- | ------- | ---------------------------------------------- |
| `-n <count>`              | 20      | Max iterations (flag overrides env var)        |
| `RIFF_MAX_ITERATIONS`     | 20      | Safety limit on loop iterations                |
| `RIFF_COOLDOWN`           | 5       | Seconds between iterations                     |
| `RIFF_TELEGRAM_BOT_TOKEN` | -       | Telegram bot token (optional, see setup below) |
| `RIFF_TELEGRAM_CHAT_ID`   | -       | Telegram chat ID (optional, see setup below)   |

**HITL protection:** the loop only runs phases marked `mode: AFK` in ROADMAP.yaml. Phases marked `mode: HITL` (human-in-the-loop) are skipped, they need you present. HITL is reserved for phases requiring manual human verification: OAuth/SSO browser flow, real payment checkout, DNS/prod cutover, irreversible migrations. Code-only auth/payment/security work stays AFK, security-reviewer + adversarial Codex are the safety net. When only HITL phases remain, the loop stops and notifies you.

### Telegram Notifications Setup

The loop can notify you via Telegram when it stops (verification failure, HITL needed, build complete, etc.). Setup:

1. **Create a bot:** message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`, follow the prompts. You get a token like `123456:ABC-DEF...`
2. **Get your chat ID:** message your new bot, then open `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser. Find `"chat":{"id":XXXXXXX}`, that number is your chat ID.
3. **Set the env vars** (add to your shell profile or `.env`):
   ```bash
   export RIFF_TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
   export RIFF_TELEGRAM_CHAT_ID="987654321"
   ```
4. **Test:** run `.riff/riff-loop.sh -n 1`, you should get a Telegram message when the iteration completes.

---

## Framework Updates and Self-Improvement

RIFF learns from every phase it runs. There are two levels of learning.

### Project-level learning (automatic)

These stay local to your project:

- **Expertise files** (`.planning/expertise/`), each agent writes lessons learned after each phase
- **Pending expertise patches** (`.planning/expertise/.pending/<agent>-<phase>.md`), the improver tags each proposal with a tier (`STACK:<name>` / `ARCHITECTURE` / `PROJECT`). `/riff:review-expertise` walks them and routes each to the right destination (framework reference or project expertise).
- **Seeds** (`.planning/seeds/`), out-of-scope ideas captured during execution

### Framework-level learning (HITL)

When an agent modifies a framework file (in `.riff/`), RIFF detects it and asks you to review.

**In interactive mode** (after each phase):

```
Framework modifications detected in .riff/:
  modified: agents/executor.md
  modified: agents/planner.md

These changes could improve RIFF for all future projects.
Push to upstream? [yes/no/diff]
```

**In AFK mode** (Ralph loop):

Changes are logged in `STATE.md` and displayed when the loop finishes:

```
Framework Changes Pending Review
  modified: agents/executor.md
  modified: agents/planner.md

Review:  cd .riff && git diff
Accept:  cd .riff && git add -A && git commit -m "learn: description" && git push
Discard: cd .riff && git checkout .
```

You always have the final say. The framework never auto-pushes changes.

---

## Key Concepts

### Confidence Gate

Before any execution, Claude checks 4 dimensions:

1. **Scope**, is it clear what to do?
2. **Target**, is the file/system/module understood?
3. **Output**, is the expected result defined?
4. **Risk**, could this action be destructive or irreversible?

Any "no" = specific questions before proceeding. Claude never guesses.

### Assumptions Mode

Before any planning:

1. Claude reads the codebase and existing files
2. States what it intends to do with confidence levels: **Confident** / **Likely** / **Unclear**
3. Waits for your correction before proceeding

This means you only need to correct what's wrong, not explain everything from scratch.

### Deviation Rules (R1-R4)

When reality doesn't match the plan during execution:

| Rule   | Situation                            | Action                                                            |
| ------ | ------------------------------------ | ----------------------------------------------------------------- |
| **R1** | Minor bug found                      | Fix it, log in SUMMARY.md. Continue.                              |
| **R2** | Missing piece (import, type, config) | Add it, log in SUMMARY.md. Continue.                              |
| **R3** | Architecture change needed           | **STOP.** Ask the human. Never decide alone.                      |
| **R4** | Out of scope idea                    | Log in `.planning/seeds/` with trigger condition. Don't build it. |

### taste.md (index + on-demand topics)

Project-specific rules that Claude must follow when writing code. Structured as an **index plus topic files** so agents only load what the current task touches.

```
taste.md                # ~30-50 lines: always-apply architecture + index
taste/
├── frontend.md         # routes, components, loaders, actions
├── backend.md          # services, jobs, providers, HTTP client
├── security.md         # auth, webhooks, env vars, multi-tenant
└── testing.md          # tests, fixtures, mocks, stories
```

**Contract:**

- `taste.md` is read on EVERY task (it's short, cheap to load). It contains:
  - "Always-apply architecture" section (stack-agnostic load-bearing principles)
  - "Load on-demand" table mapping what the task touches → which topic file to read
  - "Decisions log" (non-obvious choices to prevent re-litigation)
- `taste/*.md` files are read conditionally based on the index triggers. Agents must NOT load them eagerly.
- Each topic file stays under **~50 lines**. If it grows past 50, split it further (e.g. spin `taste/database.md` out of `backend.md`).

**Framework-level taste** (shared across all RIFF projects) lives at `references/taste/`:

- `architecture.md`, `backend.md`, `security.md`, `testing.md`, stack-agnostic baseline, seeded into project taste at `/riff:start`.
- `stacks/INDEX.md` + `stacks/<slug>.md`, stack-specific gotchas (Drizzle, Zod, Vitest, React Router 7, Node ESM). Agents read these directly on-demand when touching that tech, they do not get copied into the project taste.

Rules grow over time: the improver agent proposes new rules after each phase, sorted by tier (`STACK:<name>` / `ARCHITECTURE` / `PROJECT`). You validate via `/riff:review-expertise`, each accepted rule is routed to the correct destination (framework reference for shared gains, project expertise for local quirks).

### 3-Level Verification

| Level           | Question                     | Example failure                                  |
| --------------- | ---------------------------- | ------------------------------------------------ |
| **EXISTS**      | Does the file exist on disk? | File was planned but never created               |
| **SUBSTANTIVE** | Is it real code, not a stub? | Component returns `<div>TODO</div>`              |
| **WIRED**       | Is it actually used?         | File exists with real code but is never imported |

Level 3 (WIRED) is the most important. Orphaned code that exists but isn't connected is the #1 silent failure in AI-assisted development.

The executor applies this check on every acceptance criterion. The scope-checker enforces it across the whole phase by diffing PLAN tasks against SUMMARY entries.

### Seeds

Ideas that come up during execution but are out of scope. Instead of building them now (scope creep) or forgetting them (lost ideas), they're saved in `.planning/seeds/` with a trigger condition.

Example: "When we add the dashboard phase, also add real-time notifications", trigger: `phase: dashboard`.

Seeds are checked at the start of each `/riff:next`. When a trigger condition is met, you're asked if you want to promote it to a ROADMAP phase.

### TDD Red-Green Mode (opt-in, per phase)

Phases in `ROADMAP.yaml` can opt into strict test-first discipline by setting `mode: tdd` (combinable with AFK/HITL, e.g. `mode: [AFK, tdd]`).

When a phase is `mode: tdd`, the planner structures tasks as sequential waves:

1. **RED**, write failing test, run it, confirm failure
2. **GREEN**, write minimal code to make the test pass
3. **REFACTOR** (optional), clean up while tests stay green

The verifier audits the phase git log and logs an R1 deviation if a `feat:`/`fix:` commit isn't preceded by its `test:` commit.

**Auto-proposed for:** auth flows, payment calculations, business rules / data transformations, public API contracts, and bug-fix phases (a fix without a regression test is debt).

**Not proposed for:** UI/component phases (Storybook covers it), refactors, integrations, skills/scripts/automation.

### REGISTRY.md staleness reminder

A pre-commit sub-hook (`hooks/registry-reminder.sh`) warns when a commit touches the public surface (`app/routes/`, `app/components/`, `app/lib/`, `schema.*`, `.env*`) but doesn't update `REGISTRY.md`. Set `RIFF_SKIP_REGISTRY=1` to bypass intentionally. The hook is chained automatically by `security-scan.sh`, no extra install step.

### DECAY.md (quarterly pruning)

`DECAY.md` at the repo root is a discipline document that lists every RIFF component (commands, agents, hooks, scripts) and forces a review every 3 months: when did I last use it, what real problem did it solve, can it be removed or simplified? It also keeps a **Considered and rejected** section so settled debates (Docker sandbox, expertise.yaml, meta-agents, ADWs, worktrees, STATS dashboard, etc.) are not reopened without new evidence. Pruning protects RIFF from framework bloat.

### Hooks test script

`hooks/test.sh` exercises the critical hooks against known-bad inputs in an isolated temp git repo (with a stubbed `npx`). It covers `security-scan.sh` (secrets, `any`, `console.log`, staged `.env`) and `registry-reminder.sh` (surface change without `REGISTRY.md`, with `REGISTRY.md` staged, and `RIFF_SKIP_REGISTRY=1` bypass). Run `./hooks/test.sh`, it exits 0 when every hook behaves correctly.

### Expertise Files

Each agent writes lessons learned to `.planning/expertise/`. These files survive across phases and conversations. A fresh-context agent reads its expertise file before starting work, so it benefits from past experience.

Capped at 15 entries per agent. When full, similar entries are merged and low-impact ones are dropped.

---

## File Structure

```
project/
  .riff/ -> ~/DEV/frameworks/riff/  # Symlink to framework repo (gitignored)
    protocols/                      # Shared rules: EXECUTION.md (confidence gate, R1-R4, context, waves), QUALITY.md (doc check, expertise, review), MODEL.md (model selection), AUTO-TRIGGERS.md (gate heuristics)
    agents/                         # Agent definitions (planner, executor, simplifier, scope-checker, adversarial-reviewer, security-reviewer, improver, debugger)
    commands/                       # Command definitions (next, start, check, etc.)
    hooks/                          # Hook scripts (security, linting, boundaries, etc.)
    templates/                      # File templates for new projects
  .claude/
    commands/riff/                  # Symlinks -> .riff/commands/
    agents/riff/                    # Symlinks -> .riff/agents/ (except CLAUDE.md)
      CLAUDE.md                     # Local copy, project-specific execution rules
    hooks/riff/                     # Symlinks -> .riff/hooks/
    settings.json                   # Claude Code hooks config
  # riff-loop.sh lives inside .riff/ (no root symlink)
  PROJECT.md                      # Product definition (greenfield: from /riff:start)
  ROADMAP.yaml                    # Phases with status, priority, mode, dependencies
  STATE.md                        # Current position, blockers, next action
  CONTEXT.md                      # Locked decisions from discovery
  REGISTRY.md                     # Cumulative API surface (agent menu, updated every phase)
  SUMMARY.md                      # Latest summary (brownfield: from /riff:map)
  taste.md                        # Architectural rules, sectioned by concern
  .planning/
    architecture.md             # Codebase architecture (brownfield: from /riff:map)
    risks.md                    # Risk assessment (brownfield: from /riff:map)
    phases/
      1-tracer-bullet/
        PLAN.md                 # What to build and how
        SUMMARY.md              # What was actually built
        REFACTOR.md             # Simplifier proposals + applied changes
        REVIEW.md               # Adversarial review verdict
        VERIFICATION.md         # Evidence that it works
        DEBUG.md                # Debugger output (if auto-debug fired)
        USAGE.md                # Tokens, duration, tool calls
      2-auth-system/
        ...
    specs/                      # Feature specs (brownfield: backfilled by explorer)
    expertise/
      planner.md                # Planner lessons learned
      executor.md               # Executor lessons learned
      security-reviewer.md      # Security reviewer lessons learned
      .pending/                 # Improver proposals awaiting /riff:review-expertise
    seeds/                      # Deferred ideas with trigger conditions
    debug/                      # Persistent debug sessions
    quick/                      # Ad-hoc task records
    mistakes/                   # Recurring bug patterns
```

---

## Using RIFF on Your Own Projects

RIFF is designed for solo developers building with Claude Code. To use it on your own projects:

### 1. Fork the repo

```bash
# Fork alexadark/riff on GitHub, then:
git clone https://github.com/YOUR_USERNAME/riff.git ~/DEV/frameworks/riff
```

### 2. Customize

Key files to personalize:

- **`agents/*.md`**, adjust the agent identities and behaviors to your style
- **`protocols/*.md`**, modify shared rules (confidence gate thresholds, model selection criteria, etc.)
- **`templates/taste.md`**, set your default architectural rules
- **`templates/settings.json`**, configure Claude Code hooks for your workflow
- **`references/taste/*.md`**, stack-agnostic rules (architecture, backend, security, testing)
- **`references/taste/stacks/*.md`**, stack-specific rules injected at `/riff:start` (e.g. `react-router-7.md`). Add a new file here the first time you use a new stack, it's reusable for every future project.

### 3. Use it

```bash
cd your-project
/riff:init          # Creates .riff/ symlink to ~/DEV/frameworks/riff/, sets up .claude/ symlinks
/riff:start         # or /riff:map for existing projects
/riff:next          # Start building
```

### Why a local symlink?

Every project's `.riff/` points to the same local repo. Edit the framework once, every project benefits immediately. When RIFF learns from your projects and you push improvements, they go to **your fork**. Your framework evolves with your coding style. You can still pull updates from the upstream repo.

---

## Model Selection

RIFF doesn't use one model for everything. Each pipeline step, agent, and review is dispatched to the model best suited for it. The authoritative policy lives in [`protocols/MODEL.md`](./protocols/MODEL.md), this section is the summary.

### Four Models

| Model      | Strengths                                             | When RIFF uses it                                                              |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Opus**   | Deepest reasoning, cross-file analysis                | Parent `/riff:next` session, inline planner, debugger, complex executor opt-in |
| **Sonnet** | Strong reasoning at 1/5 Opus cost                     | Default executor, security review, standard components                         |
| **Haiku**  | ~1/3 Sonnet cost, reliable tool use                   | Improver, simplifier, scope-checker, doc updater, low-stakes pattern work      |
| **Codex**  | Different model family, catches Claude's blind spots  | Adversarial review (bugs, race conditions, rollback safety)                    |

### Pipeline-wide policy

| Step                       | Where it runs   | Model                | Thinking                                                |
| -------------------------- | --------------- | -------------------- | ------------------------------------------------------- |
| `/riff:next` orchestration | Inline (parent) | **Opus** (forced)    | none                                                    |
| Step 4: Planner            | **Inline**      | Opus (parent)        | Dynamic per phase                                       |
| Step 5: Executor           | Sub-agent       | Sonnet (Opus opt-in) | none, or `think hard` if `complex_execution:`           |
| Step 5b: Simplifier        | Sub-agent       | Haiku                | none                                                    |
| Step 5c: Scope-checker     | Sub-agent       | Haiku                | none                                                    |
| Step 6: Adversarial review | Sub-agent       | Codex                | N/A (controlled inside the Codex skill)                 |
| Step 7: Security review    | Sub-agent       | Sonnet               | `think harder` (auth/pay/public-API), else `think hard` |
| Step 7b: Improver          | Sub-agent (bg)  | Haiku                | none                                                    |
| Step 8a: Doc updater       | Sub-agent       | Haiku                | none                                                    |
| `/riff:debug` + auto-debug | Sub-agent       | Opus (Sonnet opt-in) | Dynamic per failure signal                              |

### Two design decisions worth knowing

**1. `/riff:next` is forced to Opus via frontmatter.** the command's YAML sets `model: opus`, so the parent session (orchestration + inline planner) always gets top-tier reasoning, no matter what the user has selected via `/model`. Sub-agents override their own model via the Agent tool's `model:` parameter.

**2. The planner runs inline, not as a sub-agent.** by Step 4, the parent has already read ROADMAP, STATE, previous SUMMARY, and run the confidence gate. Spawning a sub-agent would force a fresh-context re-read of the same files (~7x the tokens) for worse output. Inline wins on both cost and quality when the parent already has the context. See `protocols/MODEL.md` for the math (Anthropic's multi-agent research benchmarks a 3-agent team at ~7x single-agent consumption).

### Thinking budget: keyword-based, injected dynamically

Claude Code does not expose a `thinking_budget` parameter. Thinking is triggered by keywords embedded in the skill or agent content:

| Keyword        | Budget  | Typical use                                                                        |
| -------------- | ------- | ---------------------------------------------------------------------------------- |
| `ultrathink`   | Maximum | P0 + architecture/novel design, CRITICAL security, debug of intermittent/race bugs |
| `think harder` | High    | P0 standard, auth/payment security review, multi-service debug                     |
| `think hard`   | Medium  | P1 standard planning, standard security review, localized debug                    |
| `think`        | Low     | Edge cases during execution                                                        |
| (none)         | None    | Mechanical work, Haiku pattern tasks                                               |

`/riff:next` injects the right keyword per step based on phase metadata (priority + tags in ROADMAP.yaml). The debugger auto-selects its keyword from failure signals (e.g., "race condition" → `ultrathink`).

### ROADMAP.yaml fields that affect behavior

Per-phase overrides:

| Field                | Effect                                                                                |
| -------------------- | ------------------------------------------------------------------------------------- |
| `executor_model:`    | Force `opus` or `sonnet` for the executor (overrides PLAN.md recommendation)          |
| `complex_execution:` | Inject `think hard` into the executor prompt                                          |
| `security_critical:` | Upgrade security review to `think harder` (auto-detected for auth/payment/public-API) |
| `simplify:`          | `true` / `false` / `auto`, gate Step 5b (default `auto`)                              |
| `adversarial:`       | `true` / `false` / `auto`, gate Step 6 (default `auto`)                               |
| `auto_debug:`        | Gate pipeline auto-debug triggers (default `true`)                                    |
| `debug_model:`       | Force `sonnet` for the debugger on this phase (default `opus`)                        |

### Fallback

Codex requires the local CLI (`@openai/codex`) and credits. If unavailable, RIFF falls back automatically:

- Codex adversarial review → falls back to Opus with adversarial prompt

Opus, Sonnet, and Haiku are always available (no fallback needed).

---

## AI-Readable Documentation

RIFF maintains documentation that agents can read efficiently. The principle: every session starts with no memory, so the codebase itself must teach the agent what it needs to know.

### The Documentation Chain

```
README.md          - What is this project? How do I run it? What's the structure?
  |
  v
CLAUDE.md          - Agent-specific: conventions, patterns, barrel imports, how to build features
  |
  v
REGISTRY.md        - Cumulative API surface: every function, component, route, table available
  |
  v
Code               - The actual implementation (agent reads only what it needs)
```

An agent reads top-down and stops when it has enough context. Each layer is self-sufficient for its depth.

### What Gets Updated and When

| File                                    | Updated when                                | By whom  |
| --------------------------------------- | ------------------------------------------- | -------- |
| `REGISTRY.md`                           | Every phase (mandatory)                     | Executor |
| `README.md`                             | When structure or setup changes             | Executor |
| `.planning/architecture.md`             | When architecture changes                   | Executor |
| `.claude/references/project-details.md` | New/renamed/split files                     | Executor |
| `CLAUDE.md`                             | When new conventions are established (rare) | Executor |
| Phase `SUMMARY.md`                      | Every phase (mandatory)                     | Executor |

### REGISTRY.md, the agent menu

A cumulative file listing every public API in the project. Agents scan this before writing code that depends on existing modules. No need to grep the codebase.

Contains tables for: Server Utilities, Components, Routes, Schema, Environment Variables, Hooks & Events. Each entry shows the signature, description, and which phase added it.

### SUMMARY.md, agent context section

Every phase summary includes an "Agent Context" section written for the next agent:

- **New public APIs**, what's now available to import
- **Changed interfaces**, types or props that changed shape
- **New env vars**, variables this phase requires
- **Wiring notes**, how outputs connect to the rest of the app

### AI-Readiness Principles (from audit-codebase)

RIFF follows 7 criteria for AI-friendly codebases:

1. **File system = mental model**, folder structure mirrors business logic
2. **Deep modules**, lots of code behind simple barrel exports
3. **Clear boundaries**, import only through public APIs
4. **Progressive disclosure**, understand modules via types/exports without reading internals
5. **Graybox modules**, change internals without breaking distant code
6. **Tests as feedback loops**, fast, comprehensive, per module
7. **Documentation references modules**, plans and docs point to actual code structure

---

## Philosophy

- **The context window is RAM, not disk.** all state lives in files. Conversations end, files persist.
- **The human is the product director.** Claude is the senior dev. She decides WHAT, Claude figures out HOW.
- **Security is automatic, not optional.** every phase gets a security review. Auth/payment phases require human presence only when manual verification is needed (OAuth flow, real payment checkout); code-only auth/payment work stays AFK and relies on security-reviewer + adversarial Codex.
- **Verification requires evidence, not assertions.** "It works" is not proof. Show the output.
- **Fresh context per task.** each agent starts clean, reads state from disk. No context rot.
- **One phase at a time.** don't batch. Don't skip. The loop is the power.

---

## Pitfalls and Lessons Learned

Hard-won lessons from real usage. Read these before modifying the framework.

### 1. "Spawn agent" is not the same as "Use the Agent tool" (2026-04-09)

**Problem:** commands said "Spawn planner in fresh context" and Claude interpreted this as a process description, doing ALL the work inline instead of calling the Agent tool. Result: no fresh context, no PLAN.md/SUMMARY.md/VERIFICATION.md artifacts, full context rot.

**Fix:** every command that needs a sub-agent now uses three explicit mechanisms:

1. **Positive directive:** "Use the Agent tool to invoke the `riff/planner` subagent"
2. **Negative directive:** "Do NOT implement this step inline"
3. **Blocking gate:** "Do NOT proceed until PLAN.md exists on disk"

**Rule:** never write "Spawn X" or "Run X agent" in a command file. Always write "Use the Agent tool to invoke X".

### 2. Executor commits code, not the orchestrator (2026-04-09)

**Problem:** `next.md` Step 8 said "Create one commit per logical change during execution" which made the orchestrator batch everything into one giant commit at the end. The executor agent should commit after each task.

**Fix:** Step 8 renamed to "Update State" with explicit note: "Code commits happen INSIDE the executor agent (Step 5), not here." The executor prompt now says "YOU are responsible for committing code."

**Rule:** the orchestrator (`/riff:next`) only commits ROADMAP.yaml + STATE.md, on `main`, after the user merges the PR. All code commits come from the executor (and simplifier) sub-agents on the feature branch.

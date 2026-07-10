# RIFF Commands — Index

15 RIFF slash commands at a glance. Use this as a routing table when you've forgotten which command does what. Some lifecycle actions live as conversational triggers instead — see § Conversational triggers below.

## Framework (global to the framework install)

| Command                 | When to run                                                                                                         | Output                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `/riff:onboard`         | First time installing RIFF, or to override the profile for one specific project. Detects context: framework root → `profile.yaml`, project root → `.planning/profile.yaml`. | `profile.yaml` (framework or project) |
| `/riff:learn-stack`     | When you want RIFF to build a taste rule file for a stack it doesn't already know (Rust, Go, FastAPI, etc).         | `references/taste/stacks/<stack>.md`       |
| `/riff:dashboard`       | Open the local web dashboard for the current project (kanban of phases, plain-language explanations, metadata). Terminal equivalent: `riff dashboard` (`--stop` to terminate). | Browser at `http://localhost:4000`         |

## Setup (one-shot, project lifecycle)

| Command          | When to run                                                                                                                                              | Output                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/riff:init`     | Claude wrapper for terminal `riff init`. Installs `.riff/` symlink, `.planning/` skeleton, Claude runtime symlinks, settings, and hooks.                        | `.riff/`, `.planning/`, `.claude/`, hooks                                                                                           |
| `/riff:resync`   | Re-link `.riff/` symlinks after the framework adds/removes files (new agent, dropped command). Idempotent. Bootstrap: `bash .riff/riff-resync.sh`.       | Refreshed symlinks under `.claude/{commands,agents,hooks}/riff/`, dangling links removed, CLAUDE.md drift report                    |
| `/riff:start`    | Greenfield project — before any code. 5-stage discovery (problem → users → MVP → research → roadmap). Asks `scratch` vs `production` scope at Stage 1. | `PROJECT.md`, `ROADMAP.yaml`, `STATE.md`, `.planning/config.json` (+ `taste.md`, `INCIDENTS.md`, `CONTEXT.md` in production scope) |
| `/riff:map`      | Brownfield project — point at an existing codebase to onboard RIFF onto it.                                                                              | `PROJECT.md`, `taste.md`, `ROADMAP.yaml` (seeded from real code)                                                                    |

## Core loop (you'll run these every day)

| Command          | When to run                                                                                        | Output                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/riff:next`     | The main command. Plans + executes + reviews + opens PR for the next phase.                        | `PLAN.md`, `SUMMARY.md`, `REVIEW.md`, security report, USAGE.md, PR |
| `/riff:wave [W{N}\|--solo P\|--resume W{N}]` | Bundle N parallel-eligible phases (or 1 solo) and delegate to Codex. Opus plans, Codex executes, opt-in smoke/browser checks prove it works. | `.planning/waves/W{N}.bundle.md`, `.RESULT.md`, `.SUMMARY.md` |
| `/riff:status`   | "Where am I?" — shows current phase, next phase, blocked phases, pending expertise.                | Console output                                                      |

## Off-loop work (when you need to act outside the roadmap)

| Command                         | When to run                                                                                                         | Output                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `/riff:add-phase [name] [goal]` | Append a new phase to ROADMAP.yaml. Use `depends_on` for ordering, `status: skipped` to remove.                     | Updated `ROADMAP.yaml`            |
| `/riff:quick <task>`            | One-off task that doesn't deserve a phase (config tweak, copy fix, dependency bump).                                | Direct commit, no phase artifacts |
| `/riff:debug <bug>`             | Manual debug invocation outside the auto-debug pipeline. For bugs that surfaced post-merge or outside `/riff:next`. | `.planning/debug/YYYY-MM-DD-[slug].md`    |
| `/riff:improver [N\|--all]`     | Batch the improver across the last N phases (default 3) to harvest learnings into `.planning/expertise/.pending/`. Fallback when Step 7b auto-trigger didn't fire. | `.planning/expertise/.pending/<agent>-<phase>.md` (+ sentinels) |
| `/riff:stress [--target <url>]`  | Adversarial + load test the whole app. Static always; with `--target`, real attacks (parallel red-team agents) + a real load ramp. Local/staging only. | `.planning/stress/YYYY-MM-DD-stress.md` |

## Conversational triggers (no slash command)

These rare lifecycle actions live as protocol files Claude reads when you say the trigger phrase. Reduces command sprawl. Full mapping in framework `CLAUDE.md` § Conversational triggers.

| You say...                                                                | What happens                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| "log incident", "j'ai un bug en prod"                                     | Read `protocols/INCIDENT.md` § Part 1, append entry to `INCIDENTS.md`                                                                  |
| "incident review", "review du trimestre"                                  | Read `protocols/INCIDENT.md` § Part 2, write quarterly draft, run Codex adversarial pass                                               |
| "promote to production", "passe en production"                            | Read `protocols/PROMOTE.md`, flip `scope: scratch → production`, run skipped discovery stages                                          |
| "re-audit phase N", "re-run security on this branch"                      | Mirror `/riff:next` Steps 5c, 6, 7 against the named phase, write `VERIFICATION.md`                                                    |
| "deep audit", "audit ce module", "milestone review"                       | Read `protocols/DEEP-AUDIT.md`, run cross-phase Codex audit at a milestone boundary                                                    |
| "set up monitoring", "configure post-deploy", "wire sentry"               | Read `protocols/POST-DEPLOY.md`, one-shot production monitoring setup (Sentry, health endpoint, scheduled smoke). User-triggered when app is deployed. |
| "resync riff", "sync framework"                                           | Run `bash .riff/riff-resync.sh` to refresh symlinks; same as `/riff:resync` but works pre-bootstrap                                    |
| "set my notification channel to X", "edit profile.yaml"                   | Edit the active profile directly (project override `.planning/profile.yaml` if it exists, else framework default). See `references/PROFILE-RESOLUTION.md`. |
| "what's pending", "pending inbox", "what am I forgetting"                 | Run `node .riff/scripts/riff-pending.mjs` — cross-project inbox of finishers, unreviewed decisions, parked branches. Format the sorted list, offer to open artifacts. |
| (automatic at end of phase) Pending expertise patches                     | Inline review (Stack/Architecture/Project routing) via `/riff:next` Step 10 with Review now / Defer to next phase / Reject all options |

## Cheat sheet — "I want to..."

- **Set up RIFF for the first time** → `/riff:onboard`
- **Change a profile field** → edit `profile.yaml` directly, or ask Claude conversationally
- **Teach RIFF a new stack** → `/riff:learn-stack <stack>`
- **Start a brand new project** → `/riff:init` then `/riff:start`
- **Onboard RIFF onto an existing codebase** → `/riff:init` then `/riff:map`
- **Build the next thing on the roadmap** → `/riff:next`
- **Walk away and let it run** → `/riff:wave` (Codex executes the bundle while you're away)
- **Launch an hours-long unattended session (one approval, zero questions, one report)** → `/riff:wave --autonomous` (or `/riff:next --autonomous` for a single phase). Lifecycle: `protocols/AUTONOMY.md`
- **See everything waiting on me across ALL my apps** → ask Claude "what's pending" (runs `.riff/scripts/riff-pending.mjs`)
- **Group N parallel phases into one Codex wave run** → `/riff:wave` (and `--resume W{N}` when Codex finishes)
- **Delegate one risky/slow phase to Codex** → `/riff:wave --solo P{N}`
- **Check where I left off** → `/riff:status`
- **Add work the planner didn't think of** → `/riff:add-phase`
- **Fix a tiny thing that doesn't need a phase** → `/riff:quick`
- **Hunt down a bug not caught by auto-debug** → `/riff:debug`
- **Harvest learnings from recent phases** → `/riff:improver` (or `/riff:improver --all` for the full backlog)
- **Re-audit a phase before merging** → ask Claude to "re-audit phase N"
- **Pull a framework update into a project** → `/riff:resync` (or `bash .riff/riff-resync.sh` if not bootstrapped yet)
- **See where I am with a kanban view + plain-language explanations** → `/riff:dashboard`
- **Log a production incident** → ask Claude to "log incident"
- **Quarterly review of incidents** → ask Claude for "incident review"
- **My local/perso script is going public** → ask Claude to "promote to production"

## Protocols referenced by commands

- `protocols/HANDOFF.md` — session checkpoint contract for `/riff:start`, `/riff:next`, `/riff:wave`. Session bloats past safe context → propose `/clear`, reopen with STATE.md. Read at Stage / Step boundaries when 2+ heuristics fire (sub-agents, revisions, tool calls, files written).
- `protocols/WAVE-BUNDLE.md` — assembled by `/riff:wave` Step 3 to package N phases for Codex wave execution. Defines the single contract Codex reads (goal, per-phase plans, acceptance criteria, RESULT.md shape).
- `protocols/CODEX-DELEGATION.md` — read by `/riff:wave` Steps 4-5 for the in-process vs out-of-process routing and the three prompt templates (wave, solo, solo-strict).
- `protocols/HOOKS.md` — Claude Code project hook contract, installed events, templates, and test workflow.
- `protocols/BROWSER-CHECK.md` — read by `/riff:wave` Step 3 (auto-enable rules) and by Codex during execution. The "prove the feature actually works" contract for wave and solo execution.
- `protocols/FALLOW.md` — read by `/riff:next` Step 5d for the deterministic fallow static audit on the phase diff (dead code, duplication, complexity, boundaries).
- `protocols/DISCOVERY-DETECTION.md` — read by `/riff:start` Stage 0 to branch greenfield / starter / brownfield and route the brownfield audit-codebase prompt.
- `protocols/DISCOVERY-DETECTION.md` § Stack Source Gate — read by `/riff:start` Stage 1 to capture how the stack decision is made (`starter-local | starter-clone | known | discussed`) so Stage 5 knows whether to run the starter clone.
- `protocols/ADVERSARIAL-REVIEW.md` — shared protocol for `/riff:start` Stages 2.5 (architecture) and 4.5 (roadmap). Codex invocation, REVISE/PROCEED loop, 2-cycle cap, skip-safely fallback. Each stage supplies its 5 parameters.
- `protocols/DISCOVERY-DETECTION.md` § Starter Clone — read by `/riff:start` Stage 5 only when `stack_source: starter-clone`. Registry match heuristic, clone flow, install verification.
- `protocols/BOOTSTRAP-FILES.md` — read by `/riff:start` Stage 5 to create persistent artifacts. Two paths: scratch (light) and production (full taste / CONTEXT / INCIDENTS / README), plus the stack-detection slug table.
- `protocols/BOOTSTRAP-FILES.md` § Dashboard Registration — read by `/riff:start` Stage 5 final step. Best-effort ping so the new project shows up in a running `/riff:dashboard` immediately.
- `protocols/POST-DEPLOY.md` — production monitoring setup (Sentry, uptime health check, scheduled Playwright smoke). User-triggered via conversational trigger ("set up monitoring") or `/riff:post-deploy`. One-shot, runs when the app is deployed. Each category opt-outable via `ROADMAP.yaml`. Also available as global skill `/post-deploy` for non-RIFF projects.
- `protocols/AUTONOMY.md` — autonomous session lifecycle for `/riff:next --autonomous` and `/riff:wave --autonomous`: front-loaded decisions, no-questions build with a DECISIONS ledger, batched end-of-run verification, finishers + `.riff/scripts/riff-pending.mjs` cross-project inbox.

## Agents referenced by commands and protocols

- `agents/planner.md` — read inline by `/riff:next` Step 4 (goal-backward planning policy, AC rules, HITL/AFK criteria, TDD mode, anti-patterns).
- `agents/adversarial-reviewer.md` — read by the Codex sub-agent invoked at `/riff:next` Step 6 (review contract, severity scale, REVIEW.md format).
- `protocols/SCOPE-CHECK.md` + `.riff/scripts/scope-check.mjs` — invoked by `/riff:next` Step 5c to diff PLAN.md vs SUMMARY.md and flag silently dropped tasks, smokes, and uxtest flow updates before review.
- `protocols/FALLOW.md` — invoked by `/riff:next` Step 5d to run fallow against `main...HEAD` and block only on `fail`.
- `agents/architecture-adversarial-reviewer.md` — invoked by `/riff:start` Stage 2.5 to challenge the System Architecture before scope and roadmap lock.
- `agents/roadmap-adversarial-reviewer.md` — invoked by `/riff:start` Stage 4.5 to challenge `ROADMAP.yaml` before bootstrap.
- `agents/plan-adversarial-reviewer.md` — invoked by `/riff:next` Step 4b to challenge `PLAN.md` before execution.
- `agents/incident-adversarial-reviewer.md` — invoked by the quarterly incident review (`protocols/INCIDENT.md` § Part 2) to challenge the synthesis draft.

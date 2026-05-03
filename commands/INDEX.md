# RIFF Commands — Index

12 RIFF slash commands at a glance. Use this as a routing table when you've forgotten which command does what. Some lifecycle actions live as conversational triggers instead — see § Conversational triggers below.

## Framework (global to the framework install)

| Command                 | When to run                                                                                                         | Output                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `/riff:onboard`         | First time installing RIFF, or to override the profile for one specific project. Detects context: framework root → `profile.yaml`, project root → `.planning/profile.yaml`. | `profile.yaml` (framework or project) |
| `/riff:learn-stack`     | When you want RIFF to build a taste rule file for a stack it doesn't already know (Rust, Go, FastAPI, etc).         | `references/taste/stacks/<stack>.md`       |
| `/riff:dashboard`       | Open the local web dashboard for the current project (kanban of phases, plain-language explanations, metadata).     | Browser at `http://localhost:4000`         |

## Setup (one-shot, project lifecycle)

| Command          | When to run                                                                                                                                              | Output                                                                                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `/riff:init`     | First thing in a brand-new project. Installs `.riff/` symlink, hooks, `.planning/` skeleton, CLAUDE.md section.                                          | `.riff/`, `.planning/`, hooks, updated `CLAUDE.md`                                                                                  |
| `/riff:resync`   | Re-link `.riff/` symlinks after the framework adds/removes files (new agent, dropped command). Idempotent. Bootstrap: `bash .riff/riff-resync.sh`.       | Refreshed symlinks under `.claude/{commands,agents,hooks}/riff/`, dangling links removed, CLAUDE.md drift report                    |
| `/riff:start`    | Greenfield project — before any code. 5-stage discovery (problem → users → MVP → research → roadmap). Asks `scratch` vs `production` scope at Stage 1. | `PROJECT.md`, `ROADMAP.yaml`, `STATE.md`, `.planning/config.json` (+ `taste.md`, `INCIDENTS.md`, `CONTEXT.md` in production scope) |
| `/riff:map`      | Brownfield project — point at an existing codebase to onboard RIFF onto it.                                                                              | `PROJECT.md`, `taste.md`, `ROADMAP.yaml` (seeded from real code)                                                                    |

## Core loop (you'll run these every day)

| Command          | When to run                                                                                        | Output                                                              |
| ---------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/riff:next`     | The main command. Plans + executes + reviews + opens PR for the next phase.                        | `PLAN.md`, `SUMMARY.md`, `REVIEW.md`, security report, USAGE.md, PR |
| `/riff:loop [N]` | Run `/riff:next` N times unattended (AFK). Stops on confidence gate, FAIL, CRITICAL/HIGH security. | Multiple phase artifacts + PRs                                      |
| `/riff:status`   | "Where am I?" — shows current phase, next phase, blocked phases, pending expertise.                | Console output                                                      |

## Off-loop work (when you need to act outside the roadmap)

| Command                         | When to run                                                                                                         | Output                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `/riff:add-phase [name] [goal]` | Append a new phase to ROADMAP.yaml. Use `depends_on` for ordering, `status: skipped` to remove.                     | Updated `ROADMAP.yaml`            |
| `/riff:quick <task>`            | One-off task that doesn't deserve a phase (config tweak, copy fix, dependency bump).                                | Direct commit, no phase artifacts |
| `/riff:debug <bug>`             | Manual debug invocation outside the auto-debug pipeline. For bugs that surfaced post-merge or outside `/riff:next`. | `.planning/debug/DEBUG-NNN.md`    |

## Conversational triggers (no slash command)

These rare lifecycle actions live as protocol files Claude reads when you say the trigger phrase. Reduces command sprawl. Full mapping in framework `CLAUDE.md` § Conversational triggers.

| You say...                                                                | What happens                                                                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| "log incident", "j'ai un bug en prod"                                     | Read `protocols/INCIDENT.md` § Part 1, append entry to `INCIDENTS.md`                                                                  |
| "incident review", "review du trimestre"                                  | Read `protocols/INCIDENT.md` § Part 2, write quarterly draft, run Codex adversarial pass                                               |
| "promote to production", "passe en production"                            | Read `protocols/PROMOTE.md`, flip `scope: scratch → production`, run skipped discovery stages                                          |
| "re-audit phase N", "re-run security on this branch"                      | Mirror `/riff:next` Steps 5c, 6, 7 against the named phase, write `VERIFICATION.md`                                                    |
| "deep audit", "audit ce module", "milestone review"                       | Read `protocols/DEEP-AUDIT.md`, run cross-phase Codex audit at a milestone boundary                                                    |
| "resync riff", "sync framework"                                           | Run `bash .riff/riff-resync.sh` to refresh symlinks; same as `/riff:resync` but works pre-bootstrap                                    |
| "set my notification channel to X", "edit profile.yaml"                   | Edit the active profile directly (project override `.planning/profile.yaml` if it exists, else framework default). See `references/PROFILE-RESOLUTION.md`. |
| (automatic at end of phase) Pending expertise patches                     | Inline review (Stack/Architecture/Project routing) via `/riff:next` Step 10 with Review now / Defer to next phase / Reject all options |

## Cheat sheet — "I want to..."

- **Set up RIFF for the first time** → `/riff:onboard`
- **Change a profile field** → edit `profile.yaml` directly, or ask Claude conversationally
- **Teach RIFF a new stack** → `/riff:learn-stack <stack>`
- **Start a brand new project** → `/riff:init` then `/riff:start`
- **Onboard RIFF onto an existing codebase** → `/riff:init` then `/riff:map`
- **Build the next thing on the roadmap** → `/riff:next`
- **Walk away and let it run** → `/riff:loop 5` (or whatever N)
- **Check where I left off** → `/riff:status`
- **Add work the planner didn't think of** → `/riff:add-phase`
- **Fix a tiny thing that doesn't need a phase** → `/riff:quick`
- **Hunt down a bug not caught by auto-debug** → `/riff:debug`
- **Re-audit a phase before merging** → ask Claude to "re-audit phase N"
- **Pull a framework update into a project** → `/riff:resync` (or `bash .riff/riff-resync.sh` if not bootstrapped yet)
- **See where I am with a kanban view + plain-language explanations** → `/riff:dashboard`
- **Log a production incident** → ask Claude to "log incident"
- **Quarterly review of incidents** → ask Claude for "incident review"
- **My local/perso script is going public** → ask Claude to "promote to production"

## Protocols referenced by commands

- `protocols/HANDOFF.md` — session checkpoint contract for `/riff:start`, `/riff:next`, `/riff:loop`. Session bloats past safe context → propose `/clear`, reopen with STATE.md. Read at Stage / Step boundaries when 2+ heuristics fire (sub-agents, revisions, tool calls, files written).

## Agents referenced by commands and protocols

- `agents/scope-checker.md` — invoked by `/riff:next` Step 5c to diff PLAN.md vs SUMMARY.md and flag silently dropped tasks before review.
- `agents/architecture-adversarial-reviewer.md` — invoked by `/riff:start` Stage 2.5 to challenge the System Architecture before scope and roadmap lock.
- `agents/roadmap-adversarial-reviewer.md` — invoked by `/riff:start` Stage 4.5 to challenge `ROADMAP.yaml` before bootstrap.
- `agents/plan-adversarial-reviewer.md` — invoked by `/riff:next` Step 4b to challenge `PLAN.md` before execution.
- `agents/incident-adversarial-reviewer.md` — invoked by the quarterly incident review (`protocols/INCIDENT.md` § Part 2) to challenge the synthesis draft.

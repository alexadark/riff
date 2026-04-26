# RIFF Commands — Index

All 16 RIFF slash commands at a glance. Use this as a routing table when you've forgotten which command does what.

## Framework (global to the framework install)

| Command                 | When to run                                                                                                         | Output                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `/riff:onboard`         | First time installing RIFF. Interactive questionnaire (or preset), writes `profile.yaml` to personalize the agents. | `profile.yaml` at the framework root       |
| `/riff:preferences`     | Change one or more profile answers later without re-walking all 13 questions.                                       | Updated `profile.yaml` + `profile.yaml.bak` |
| `/riff:learn-stack`     | When you want RIFF to build a taste rule file for a stack it doesn't already know (Rust, Go, FastAPI, etc).         | `references/taste/stacks/<stack>.md`       |

## Setup (one-shot, project lifecycle)

| Command       | When to run                                                                                                     | Output                                                           |
| ------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `/riff:init`  | First thing in a brand-new project. Installs `.riff/` symlink, hooks, `.planning/` skeleton, CLAUDE.md section. | `.riff/`, `.planning/`, hooks, updated `CLAUDE.md`               |
| `/riff:start` | Greenfield project — before any code. 5-stage discovery (problem → users → MVP → research → roadmap).           | `PROJECT.md`, `taste.md`, `ROADMAP.yaml`, `STATE.md`             |
| `/riff:map`   | Brownfield project — point at an existing codebase to onboard RIFF onto it.                                     | `PROJECT.md`, `taste.md`, `ROADMAP.yaml` (seeded from real code) |

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

## Verification (review what already happened)

| Command                  | When to run                                                                                               | Output                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `/riff:check [phase]`    | Re-run security + adversarial review on an already-built phase (e.g. before final merge).                 | Updated `REVIEW.md`, security report           |
| `/riff:review-expertise` | Walk through `.planning/expertise/.pending/` files written by the improver. Accept or reject each lesson. | Updated `.planning/expertise/<agent>.md` files |
| `/riff:incident`         | Log a production incident into `INCIDENTS.md` (append-only regression ledger).                            | New entry in `INCIDENTS.md`                    |
| `/riff:incident-review`  | Quarterly: read `INCIDENTS.md`, propose `taste.md` rules / adversarial triggers / test patterns.          | `.planning/incident-review-YYYY-MM-DD.md` draft |

## Cheat sheet — "I want to..."

- **Set up RIFF for the first time** → `/riff:onboard`
- **Change one or a few profile answers later** → `/riff:preferences`
- **Teach RIFF a new stack** → `/riff:learn-stack <stack>`
- **Start a brand new project** → `/riff:init` then `/riff:start`
- **Onboard RIFF onto an existing codebase** → `/riff:init` then `/riff:map`
- **Build the next thing on the roadmap** → `/riff:next`
- **Walk away and let it run** → `/riff:loop 5` (or whatever N)
- **Check where I left off** → `/riff:status`
- **Add work the planner didn't think of** → `/riff:add-phase`
- **Fix a tiny thing that doesn't need a phase** → `/riff:quick`
- **Hunt down a bug not caught by auto-debug** → `/riff:debug`
- **Re-audit a phase before merging** → `/riff:check`
- **Process pending expertise updates** → `/riff:review-expertise`
- **Log a production incident I just hit** → `/riff:incident`
- **Quarterly review of incidents** → `/riff:incident-review`

## Agents referenced by commands

- `agents/scope-checker.md` — invoked by `/riff:next` Step 5c to diff PLAN.md vs SUMMARY.md and flag silently dropped tasks before review.

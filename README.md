```
██████╗ ██╗███████╗███████╗
██╔══██╗██║██╔════╝██╔════╝
██████╔╝██║█████╗  █████╗
██╔══██╗██║██╔══╝  ██╔══╝
██║  ██║██║██║     ██║
╚═╝  ╚═╝╚═╝╚═╝     ╚═╝
```

> **Build like a band of six. Ship like one.**
> Solo dev framework for Claude Code.

Lean, profile-driven coding agent framework for Claude Code. Clone, answer the onboarding questions (or take the default profile), build your own version.

## Why this exists

Most agent frameworks are a trap. You adopt 40KB agent definitions, pay a token tax on every call, and accumulate maintenance debt while Claude Code ships native features that replace half of what you installed. Then you are stuck rewriting your framework to keep up.

RIFF is not a framework you adopt. It is a kit: a small universal core, modular pieces you can delete, and a `profile.yaml` that wires only what fits you. The 13 agents total ~60KB, between 1.4KB and 6KB each. Every piece is reviewable in under 10 minutes.

When Claude Code ships a native feature that replaces one of your hooks or commands, you delete the piece. No framework-wide migration.

## What you get

- **Agents + mechanical gates**: planner, executor, security-reviewer, adversarial-reviewer (post-build, runs on Codex as a different model family), plan / architecture / roadmap / incident adversarial reviewers (pre-artifact passes), debugger, simplifier, improver, deep-auditor, plus mechanical scope-check via `scripts/scope-check.mjs`.
- **14 slash commands**: framework (onboard, learn-stack, dashboard), project lifecycle (init, start, map, resync), daily loop (next, wave, status), off-loop (add-phase, quick, debug, improver). Lifecycle actions like incident logging, quarterly review, scratch→production promotion, and re-audits are conversational triggers (no slash command), see [`commands/INDEX.md`](./commands/INDEX.md) § Conversational triggers.
- **Claude Code hooks** in profile-selected buckets: A (universal discipline), B (security-adaptable), C (stack-specific). Your profile picks which ones wire.
- **23 protocols**: EXECUTION (confidence gates, R1-R4 deviations, waves), MODEL (dispatch and budget resolution), QUALITY (post-build checks), browser verification, wave bundling, promotion, incident review, and related workflow contracts.
- **Mechanical-quality gate** via [`fallow`](https://github.com/fallow-rs/fallow) on every TS/JS phase: dead code, duplication, complexity, and boundary violations on the diff. Sub-second, deterministic, no LLM. Auto-installed as a devDep at `/riff:start`.
- **Browser-based verification** for TS/JS: opt-in smoke test gate (`smoke_test: true`) boots the dev server and loads changed routes in a headless browser; sandbox provider flows (`provider_mode: sandbox`) verify autonomously via the framework-native browser verification protocol (`references/BROWSER-VERIFICATION.md` — Lightpanda + chrome-devtools-mcp) instead of pausing for human OAuth or test-checkout; the `debugger` agent opens the failing route and attaches screenshots to `DEBUG.md` for frontend failures.
- **Local web dashboard** (`/riff:dashboard`): kanban view of phases, plain-language pre/post explanations at the level your `profile.yaml` declares, generation metadata (models, durations, gates) per phase. Read-only — driving still happens in the terminal.
- **Taste references** for architecture, backend, security, testing, plus stack files for Drizzle, Node ESM, React Router 7, Vitest, Zod. Add your own with `/riff:learn-stack`.

## Install

**1. In your terminal**, clone the repo and link the commands:

```bash
git clone <this-repo-url> ~/your/path/riff
cd ~/your/path/riff
./riff resync
```

`./riff resync` creates the `/riff:*` slash commands. You run it once: a fresh clone has none yet, so without it the commands will not show up in Claude Code. Clone wherever you like. The framework path is registered at `~/.config/riff/config.yaml` on first onboard, so other RIFF commands locate the framework without any hardcoded location.

**2. In Claude Code**, open that folder and run:

```
/riff:onboard
```

This walks you through the profile questions (or writes the default profile) and writes `profile.yaml` at the framework root. Every agent reads it on startup.

> Your `profile.yaml` is gitignored — it stays local, never gets committed when you contribute back. See [`profile.yaml.example`](./profile.yaml.example) for the schema with field comments if you'd rather edit by hand.

## Quickstart in a project

```bash
cd ~/my-project
riff init
```

`riff init` symlinks this RIFF clone into the project as `.riff/`, then installs Claude Code runtime files (commands, agents, hooks, settings). Codex remains the default executor runtime through the configured skill/CLI; it is not installed as a project harness. After installing files, init starts profile onboarding when the terminal is interactive. Use `--profile default`, `--profile custom`, or `--no-onboard` for scripted runs.

Or, from inside Claude Code in the project directory, run the wrapper:

```
/riff:init         # installs RIFF, picks scope (production/scratch), and asks
                   # whether to keep the framework profile or customize one for this project
```

> **Restart Claude Code before continuing.** `/riff:init` installs new slash commands, agents, and hooks into the project. Claude Code only discovers them at session start, so the just-installed commands (`/riff:start`, `/riff:next`, etc.) will not appear in your current window. Close the Claude Code window and open a fresh one in the same project directory before running the next command.

```
/riff:start        # greenfield discovery (5 stages: problem, users, MVP, research, roadmap)
                   # OR /riff:map for an existing codebase
/riff:next         # the main loop: plan a phase, execute, review, open a PR
/riff:dashboard    # open the local web dashboard (kanban + plain-language explanations)
```

> Most projects keep the framework profile. The per-project override is for genuinely divergent setups (stricter client work, different artifact language, workshop demo). Resolution order and edge cases: [`references/PROFILE-RESOLUTION.md`](./references/PROFILE-RESOLUTION.md).

Run `/riff:status` anytime to see where you are. Run `/riff:wave` to bundle N parallel-eligible phases and let Codex execute them while you're away. Run `/riff:dashboard` to watch progress in a browser.

## Key concepts

### profile.yaml: the personalization layer

One file at the framework root by default, optionally overridden per project at `<project>/.planning/profile.yaml`. Holds your user context, risk appetite, style, budget, notification channel. Every agent reads the resolved profile on startup and adapts. Resolution order: [`references/PROFILE-RESOLUTION.md`](./references/PROFILE-RESOLUTION.md).

Fields (full schema in `commands/onboard.md` § Profile schema):

- `user.*`: programming level, AI agents experience, domains, work mode, side activities, conversational vs artifact language
- `risk.sensitive_task_preference`: `cautious` / `balanced` / `fast`
- `style.*`: length, jargon policy, when to ask vs take initiative
- `budget.default_quality`: `frugal` / `balanced` / `max`
- `notifications.channel`: where unattended runs ping you
- `metadata.pr_body`: `off` / `standard` / `full` for generated PR metadata detail

Edit by hand anytime, or ask Claude conversationally to update specific fields (e.g. "set my notification channel to slack").

### Default profile

0-question shortcut. Pick `default` during onboarding for a safe baseline (intermediate, generalist, standard length, first-mention jargon, balanced budget, no notifications), then tweak `profile.yaml` by hand. The custom path asks the full question set instead. The default profile is also the tier-3 fallback at the bottom of the resolution chain.

### Budget resolution

Four-level fallback chain for every decision (model choice, whether to run optional pipeline steps):

1. Per-phase override in ROADMAP.yaml (`executor_model:`, `simplify:`, etc.)
2. Per-project override in ROADMAP.yaml (`budget_quality:` top-level)
3. Profile default in `profile.yaml` (`budget.default_quality`)
4. Hardcoded default: `balanced`

Full spec: `protocols/MODEL.md` § Budget and model resolution.

### Hook buckets

- **A** (always wired): destructive-guard, boundary-check, typecheck-gate, test-gate
- **B** (security-adaptable, driven by `risk.sensitive_task_preference`): route-auth-guard, idor-detector, input-validation-guard, todo-orphan-guard
- **C** (stack/convention helpers): registry-reminder and migration-gate run from `security-scan.sh` when relevant files are staged; notify-human is manual.

Details: `hooks/README.md` § Buckets.

### Agents read profile.yaml

Each agent has a `## Calibration` section that spells out which profile fields it uses and how. Example from `agents/planner.md`:

- `user.programming_level`, `user.domains`: detail and safety-awareness in plans
- `risk.sensitive_task_preference`: whether every sensitive surface gets an explicit AC
- `style.*`: PLAN.md density and whether to surface questions
- `budget.default_quality`: Model Recommendation bias

If `profile.yaml` is missing, agents fall back to the default profile.

## Commands

All 14 slash commands listed in [`commands/INDEX.md`](./commands/INDEX.md), grouped by purpose:

- **Framework (global):** onboard, learn-stack, dashboard
- **Setup (project lifecycle):** init, start, map, resync
- **Core loop:** next, wave, status
- **Off-loop:** add-phase, quick, debug, improver

Plus conversational triggers for rare lifecycle actions (incident logging, quarterly review, scratch→production promotion, re-audits, profile edits) — see INDEX.md § Conversational triggers.

## Customize and extend

Every file in this repo is meant to be edited.

- **Agents:** rewrite any agent's markdown to match your process. The file IS the instruction.
- **Commands:** change a command's steps, add new ones. Markdown with YAML frontmatter.
- **Hooks:** delete hooks you do not use. Add new hooks and register them in the right `settings-*.json` template.
- **Taste rules:** add project-specific taste files in `references/taste/`, or stack files via `/riff:learn-stack <stack>`.
- **Protocols:** the 4 files in `protocols/` are the framework's contract. Edit carefully.

When Claude Code ships a native feature that overlaps one of your pieces, delete the piece. Prune quarterly via `DECAY.md`.

## Philosophy

The creator of Claude Code runs on roughly 100 lines of CLAUDE.md, a handful of terminals, plan mode, and a small set of slash commands. That is the target. RIFF gives you scaffolding to reach it without reinventing the planner, security reviewer, or hook discipline from scratch.

Inspect before adopting. Delete when redundant. Your framework is yours.

## Docs

- [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md): full mechanics, pipeline, agents, key concepts, model selection
- [`CLAUDE.md`](./CLAUDE.md): rules, always loaded
- [`commands/INDEX.md`](./commands/INDEX.md): command catalog
- [`protocols/EXECUTION.md`](./protocols/EXECUTION.md): agent behavior (confidence gates, deviations, waves)
- [`protocols/MODEL.md`](./protocols/MODEL.md): model dispatch and budget resolution
- [`protocols/QUALITY.md`](./protocols/QUALITY.md): post-build quality checks
- [`hooks/README.md`](./hooks/README.md): hook buckets and descriptions
- [`dashboard/README.md`](./dashboard/README.md): local web dashboard (kanban, plain-language explanations, generation metadata)
- [`DECAY.md`](./DECAY.md): pruning protocol

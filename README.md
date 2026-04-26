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

Lean, profile-driven coding agent framework for Claude Code. Clone, answer 13 questions (or pick a preset), build your own version.

## Why this exists

Most agent frameworks are a trap. You adopt 40KB agent definitions, pay a token tax on every call, and accumulate maintenance debt while Claude Code ships native features that replace half of what you installed. Then you are stuck rewriting your framework to keep up.

RIFF is not a framework you adopt. It is a kit: a small universal core, modular pieces you can delete, and a `profile.yaml` that wires only what fits you. The 12 agents total ~60KB, between 1.4KB and 6KB each. Every piece is reviewable in under 10 minutes.

When Claude Code ships a native feature that replaces one of your hooks or commands, you delete the piece. No framework-wide migration.

## What you get

- **12 agents** (~60KB total): planner, executor, security-reviewer, adversarial-reviewer (post-build), plan/architecture/roadmap/incident adversarial reviewers (pre-artifact Codex passes), scope-checker, debugger, simplifier, improver. Each has a clear single job.
- **14 slash commands**: setup (onboard, preferences, learn-stack), project lifecycle (init, start, map), daily loop (next, loop, status), off-loop (add-phase, quick, debug), verification (check, review-expertise).
- **17 hooks** in 3 buckets: A (universal discipline), B (security-adaptable), C (stack-specific). Your profile picks which ones wire.
- **4 protocols**: EXECUTION (confidence gates, R1-R4 deviations, waves), MODEL (dispatch and budget resolution), QUALITY (post-build checks), plus a MODEL-rationale companion.
- **Taste references** for architecture, backend, security, testing, plus stack files for Drizzle, Node ESM, React Router 7, Vitest, Zod. Add your own with `/riff:learn-stack`.

## Install

```bash
git clone <this-repo-url> ~/DEV/frameworks/riff
cd ~/DEV/frameworks/riff
```

Open Claude Code in the framework directory and run:

```
/riff:onboard
```

This walks you through 13 questions (or picks a preset) and writes `profile.yaml` at the framework root. Every agent reads it on startup.

## Quickstart in a project

```bash
cd ~/my-project
```

Open Claude Code and run:

```
/riff:init         # installs RIFF into this project, wires hooks per your profile
/riff:start        # greenfield discovery (5 stages: problem, users, MVP, research, roadmap)
                   # OR /riff:map for an existing codebase
/riff:next         # the main loop: plan a phase, execute, review, open a PR
```

Run `/riff:status` anytime to see where you are. Run `/riff:loop 5` to let it build 5 phases unattended.

## Key concepts

### profile.yaml: the personalization layer

One file at the framework root. Holds your user context, risk appetite, style, budget, notification channel. Every agent reads it on startup and adapts.

Fields (full schema in `commands/onboard.md` § Profile schema):

- `user.*`: programming level, AI agents experience, domains, work mode, side activities, parallel projects count, conversational vs artifact language
- `risk.sensitive_task_preference`: `cautious` / `balanced` / `fast`
- `style.*`: length, jargon policy, when to ask vs take initiative
- `budget.default_quality`: `frugal` / `balanced` / `max`
- `notifications.channel`: where AFK mode pings you

Edit by hand anytime, or run `/riff:preferences` to re-answer any subset of questions.

### 4 presets

0-question shortcuts. Pick one during onboarding, or start from one and tweak `profile.yaml` later.

- **`expert`**: team specialist, terse, free jargon, takes initiative, balanced budget. Closest to vanilla Claude Code.
- **`neutre`**: safe middle, standard length, first-mention jargon, balanced budget, no notifications.
- **`apprentissage`**: cautious, detailed explanations, no jargon, always asks, balanced budget. Learner-friendly.
- **`alex`**: cautious, terse, no jargon, important-only asks, max budget. Full pipeline.

### Budget resolution

Four-level fallback chain for every decision (model choice, whether to run optional pipeline steps):

1. Per-phase override in ROADMAP.yaml (`executor_model:`, `simplify:`, etc.)
2. Per-project override in ROADMAP.yaml (`budget_quality:` top-level)
3. Profile default in `profile.yaml` (`budget.default_quality`)
4. Hardcoded default: `balanced`

Full spec: `protocols/MODEL.md` § Budget and model resolution.

### Hook buckets

- **A** (always wired): destructive-guard, boundary-check, typecheck-gate, lint-gate, test-gate
- **B** (security-adaptable, driven by `risk.sensitive_task_preference`): route-auth-guard, idor-detector, input-validation-guard, todo-orphan-guard
- **C** (stack-specific, picked at `/riff:init`): registry-reminder, migration-gate, notify-human

Details: `hooks/README.md` § Buckets.

### Agents read profile.yaml

Each agent has a `## Calibration` section that spells out which profile fields it uses and how. Example from `agents/planner.md`:

- `user.programming_level`, `user.domains`: detail and safety-awareness in plans
- `risk.sensitive_task_preference`: whether every sensitive surface gets an explicit AC
- `style.*`: PLAN.md density and whether to surface questions
- `budget.default_quality`: Model Recommendation bias

If `profile.yaml` is missing, agents fall back to `neutre` preset defaults.

## Commands

All 14 commands listed in [`commands/INDEX.md`](./commands/INDEX.md), grouped by purpose:

- **Framework (global):** onboard, preferences, learn-stack
- **Setup (project lifecycle):** init, start, map
- **Core loop:** next, loop, status
- **Off-loop:** add-phase, quick, debug
- **Verification:** check, review-expertise

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

- [`HOW-IT-WORKS.md`](./HOW-IT-WORKS.md): full mechanics — pipeline, agents, key concepts, model selection
- [`CLAUDE.md`](./CLAUDE.md): rules, always loaded
- [`commands/INDEX.md`](./commands/INDEX.md): command catalog
- [`protocols/EXECUTION.md`](./protocols/EXECUTION.md): agent behavior (confidence gates, deviations, waves)
- [`protocols/MODEL.md`](./protocols/MODEL.md): model dispatch and budget resolution
- [`protocols/QUALITY.md`](./protocols/QUALITY.md): post-build quality checks
- [`hooks/README.md`](./hooks/README.md): hook buckets and descriptions
- [`DECAY.md`](./DECAY.md): pruning protocol

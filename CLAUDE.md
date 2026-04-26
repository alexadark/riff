# RIFF Framework

## Core rules (always-on)

- **R1** Minor bug → fix, log in SUMMARY. **R2** Missing piece → add if obvious, log in SUMMARY. **R3** Architecture change → STOP, ask human. **R4** Out of scope → seed it, do not build.
- **Atomic commits.** One commit per task. Never `git add .`. Use normal conventional-commit messages that describe the feature or bug (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`). Do NOT mention `riff`, phase numbers, or task numbers in commit messages — that metadata lives in SUMMARY.md and ROADMAP.yaml. Pre-commit hook must pass.
- **Non-negotiable code quality (production scope).** No `any`. No `console.log`. No hardcoded secrets. No `// TODO` without a seed. Validate input at boundaries. Auth check on every protected route. Scope queries to the authenticated user (no IDOR). In `scope: scratch` projects, only the "no hardcoded secrets" rule applies (the rest don't fit Python/bash/local-only scripts).

## Project scope

Set at `/riff:start` Stage 1, stored in `.planning/config.json` as `scope: scratch | production`. Default when missing → `production` (existing projects are unaffected).

- **scratch** — personal/local apps, no auth, no public exposure, no other users. `/riff:start` skips Stages 2/2.5/4.5, runs light Stages 3/4, bootstraps only PROJECT.md + ROADMAP.yaml + STATE.md. `/riff:next` skips planner adversarial, simplifier, security-reviewer, adversarial Codex. Executor stays language-agnostic.
- **production** — full RIFF discipline. All discovery stages run. All `/riff:next` gates run.
- **Promotion:** `/riff:promote` flips scratch → production and runs the skipped stages retroactively when an app is going public.

## Where to look

- User profile: `profile.yaml` at the framework root (written by `/riff:onboard`, edited by `/riff:preferences` or by hand). Every agent reads it on startup to calibrate persona, strictness, length, and budget.
- Command catalog: `commands/INDEX.md` (17 commands grouped by purpose).
- Project scope: `.planning/config.json` `scope: scratch | production`. Drives whether security-reviewer / adversarial Codex / simplifier / taste rules run on `/riff:next`. Missing field → `production`.
- Planning: `agents/planner.md` (Confidence Gate, Assumptions Mode, Model Selection, Wave grouping, Logical Dependency Check)
- Executing: `agents/executor.md` (Confidence Gate, Model Dispatch, Documentation Updates after every phase)
- Security: `agents/security-reviewer.md` (auto-runs after every build phase). HITL is reserved for phases requiring manual human verification (OAuth/SSO browser flow, real payment checkout, DNS/prod cutover, irreversible migrations); code-only auth/payment/security work runs AFK and relies on security-reviewer + adversarial Codex.
- Style rules: `taste.md` (read `## Architecture` always + the `## Stack: {{stack}}` section on every frontend/route task + section relevant to current task). Stack-specific rules live in `references/taste/stacks/` inside RIFF and are injected into project `taste.md` at `/riff:start`.
- Hook buckets and profile wiring: `hooks/README.md` § Buckets.
- Budget and model resolution: `protocols/MODEL.md` § Budget and model resolution.
- Roadmap mutations: `commands/add-phase.md` (append phases to ROADMAP.yaml; no insert/remove needed — use depends_on for ordering, status: skipped to remove)
- Project state: `STATE.md` + `ROADMAP.yaml`
- What's changed: `SUMMARY.md` per phase
- Discipline: `DECAY.md` (quarterly pruning, rejected ideas)

## Context budget

FRESH (60-100%) batch aggressively. MODERATE (40-60%) re-read key files before architectural calls. DEPLETED (<40%) checkpoint, prepare handoff, summarize before acting.

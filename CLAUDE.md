# RIFF Framework

## Core rules (always-on)

- **R1** Minor bug → fix, log in SUMMARY. **R2** Missing piece → add if obvious, log in SUMMARY. **R3** Architecture change → STOP, ask human. **R4** Out of scope → seed it, do not build.
- **Atomic commits.** One commit per task. Never `git add .`. Use normal conventional-commit messages that describe the feature or bug (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`). Do NOT mention `riff`, phase numbers, or task numbers in commit messages — that metadata lives in SUMMARY.md and ROADMAP.yaml. Pre-commit hook must pass.
- **Non-negotiable code quality (production scope).** No `any`. No `console.log`. No hardcoded secrets. No `// TODO` without a seed. Validate input at boundaries. Auth check on every protected route. Scope queries to the authenticated user (no IDOR). In `scope: scratch` projects, only the "no hardcoded secrets" rule applies (the rest don't fit Python/bash/local-only scripts).

## Project scope

Set at `/riff:start` Stage 1, stored in `.planning/config.json` as `scope: scratch | production`. Default when missing → `production` (existing projects are unaffected).

- **scratch** — personal/local apps, no auth, no public exposure, no other users. `/riff:start` skips Stages 2/2.5/4.5, runs light Stages 3/4, bootstraps only PROJECT.md + ROADMAP.yaml + STATE.md. `/riff:next` skips planner adversarial, simplifier, security-reviewer, adversarial Codex. Executor stays language-agnostic.
- **production** — full RIFF discipline. All discovery stages run. All `/riff:next` gates run.
- **Promotion:** when the user says "promote to production" (or equivalent, see § Conversational triggers), read `protocols/PROMOTE.md` and run the flow. No slash command.

## Conversational triggers

These actions are NOT slash commands. Read the listed protocol or just do the thing inline when the user says one of these:

| User says...                                                                            | Do                                                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| "log incident", "j'ai un bug en prod", "log this as an incident"                        | Read `protocols/INCIDENT.md` § Part 1, run logging flow                                                  |
| "incident review", "review du trimestre", "quarterly incident review"                   | Read `protocols/INCIDENT.md` § Part 2, run quarterly review flow                                          |
| "promote to production", "passe en production", "this app is going public"              | Read `protocols/PROMOTE.md`, run promotion flow (always confirm at Step 1)                                |
| "re-audit phase N", "re-run security on this branch", "verify phase N before merge"     | Mirror `/riff:next` Steps 5c, 6, 7: spawn scope-checker + adversarial Codex + security-reviewer in parallel against the named phase. Write `.planning/phases/N-slug/VERIFICATION.md`. |
| "deep audit", "audit ce module", "milestone review", "review complète"                  | Read `protocols/DEEP-AUDIT.md`, run flow                                                                  |
| "resync riff", "sync framework", "re-link riff symlinks"                                | Run `bash .riff/riff-resync.sh` from the project root, paste output back. Surfaces CLAUDE.md drift; never auto-patches. |
| "change my profile X to Y", "set my notification channel to Z", "edit profile.yaml"     | Edit `profile.yaml` at framework root directly. Preserve other fields. Confirm the change.                |

Discoverable via this section. Do not invent commands the user did not invoke.

## Where to look

- User profile: `profile.yaml` at the framework root (written by `/riff:onboard`, edited by hand or conversationally — see § Conversational triggers). Every agent reads it on startup to calibrate persona, strictness, length, and budget.
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

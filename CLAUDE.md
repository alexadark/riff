# RIFF Framework

## Core rules (always-on)

- **R1** Minor bug → fix, log in SUMMARY. **R2** Missing piece → add if obvious, log in SUMMARY. **R3** Architecture change → STOP, ask human. **R4** Out of scope → seed it, do not build.
- **Atomic commits.** One commit per task. Never `git add .`. Use normal conventional-commit messages that describe the feature or bug (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`). Do NOT mention `riff`, phase numbers, or task numbers in commit messages — that metadata lives in SUMMARY.md and ROADMAP.yaml. Pre-commit hook must pass.
- **Non-negotiable code quality (production scope).** No `any`. No `console.log`. No hardcoded secrets. No `// TODO` without a seed. Validate input at boundaries. Auth check on every protected route. Scope queries to the authenticated user (no IDOR). In `scope: scratch` projects, only the "no hardcoded secrets" rule applies (the rest don't fit Python/bash/local-only scripts).

## Project scope

`scope: scratch | production` in `.planning/config.json`, set at `/riff:start` Stage 1. Default when missing → `production`. Drives which stages run on `/riff:start` and which gates run on `/riff:next`. Per-scope behavior, code-quality rule applicability, and promotion trigger: `references/PROJECT-SCOPE.md`.

## Language

Reply in `user.conversational_language` from `profile.yaml`. Write artifacts in `user.artifact_language`. Resolution order, edge cases, agent-by-agent applicability: `references/LANGUAGE.md`.

## Profile resolution

Every reference to "`profile.yaml`" in this framework resolves per `references/PROFILE-RESOLUTION.md`: project override (`.planning/profile.yaml`) → framework default (`<framework_root>/profile.yaml`) → `neutre` preset.

## Explanation level

Calibrate from `style.terminal_explanation_level` (override) → `style.explanation_level` → default `simple`. Per-level vocabulary rules: `references/EXPLANATION-LEVEL.md`. Same rule governs `AskUserQuestion` prompts mid-pipeline (see `references/EXPLANATION-LEVEL.md` § Interactive questions).

## Conversational triggers

These actions are NOT slash commands. Read the listed protocol or just do the thing inline when the user says one of these:

The triggers below are matched by the FULL phrase, not by isolated words. If the user says only "review" (with no qualifier like "incident", "milestone", "phase N"), do NOT silently load DEEP-AUDIT or INCIDENT — ask which one they mean.

| User says...                                                                            | Do                                                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| "log incident", "log this as an incident", "production bug"                             | Read `protocols/INCIDENT.md` § Part 1, run logging flow                                                  |
| "incident review", "quarterly incident review"                                          | Read `protocols/INCIDENT.md` § Part 2, run quarterly review flow                                          |
| "promote to production", "this app is going public"                                     | Read `protocols/PROMOTE.md`, run promotion flow (always confirm at Step 1)                                |
| "re-audit phase N", "re-run security on this branch", "verify phase N before merge"     | Mirror `/riff:next` Steps 5c, 6, 7: spawn scope-checker + adversarial Codex + security-reviewer in parallel against the named phase. Write `.planning/phases/N-slug/VERIFICATION.md`. |
| "deep audit", "audit this module", "milestone review", "full milestone review"          | Read `protocols/DEEP-AUDIT.md`, run flow. **Milestone boundary** = a phase tagged `milestone: <name>` in ROADMAP.yaml; the audit covers all phases in that group. Also auto-triggers at `/riff:next` Step 10 when the just-completed phase has a `milestone:` tag. Frequency: decided by milestone tag placement in roadmap, no fixed cadence. |
| "audit codebase", "health check", "assess this project"                                 | Read skill `audit-codebase` SKILL.md, run mode `bug` / `ai` / `full` based on user phrasing (default `full`). Skip silently if `scope=scratch`. |
| "resync riff", "sync framework", "re-link riff symlinks"                                | Run `bash .riff/riff-resync.sh` from the project root, paste output back. Surfaces CLAUDE.md drift; never auto-patches. |
| "change my profile X to Y", "set my notification channel to Z", "edit profile.yaml"     | Edit the active profile (project override `.planning/profile.yaml` if it exists, else framework default; see `references/PROFILE-RESOLUTION.md`). Preserve other fields. Confirm the change. |

Discoverable via this section. Do not invent commands the user did not invoke.

## Where to look

- User profile: `profile.yaml` (resolved per `references/PROFILE-RESOLUTION.md`: project override `.planning/profile.yaml` → framework default). Every agent reads it on startup for persona, strictness, length, budget.
- Command catalog: `commands/INDEX.md`.
- Planning: `agents/planner.md` (Confidence Gate, Assumptions Mode, Wave grouping, Logical Dependency Check).
- Executing: `agents/executor.md` (Confidence Gate, Model Dispatch, Documentation Updates).
- Security: `agents/security-reviewer.md` (auto-runs after every build phase). HITL reserved for phases requiring manual human verification against a **production** surface (real OAuth/SSO against a prod IdP, real payment checkout, MFA / hardware token, DNS/prod cutover, irreversible migrations); code-only auth/payment work runs AFK on security-reviewer + adversarial Codex. **Sandbox provider flows** (`provider_mode: sandbox`) also run AFK — the loop routes the verification through the browser verification protocol (Lightpanda headless, see `references/BROWSER-VERIFICATION.md`) instead of pausing. See `agents/planner.md` § `provider_mode` and `commands/loop.md` § HITL vs sandbox-HITL.
- Style rules: `taste.md` (`## Architecture` always + `## Stack: {{stack}}` on frontend/route tasks). Stack files live in `references/taste/stacks/`, injected at `/riff:start`.
- Hooks: `hooks/README.md` § Buckets.
- Budget and model resolution: `protocols/MODEL.md` § Budget and model resolution.
- Roadmap mutations: `commands/add-phase.md` (append-only; use `depends_on` for ordering, `status: skipped` to remove).
- Project state: `STATE.md` + `ROADMAP.yaml`. Phase changes: `SUMMARY.md` per phase. Pruning: `DECAY.md`.

## Context budget

GREEN under 100k, YELLOW 100k-200k (be selective), RED 200k+ (checkpoint, propose `/clear`). Sub-agent returns and inline file reads are the biggest bloat source. Full guidance: `references/CONTEXT-BUDGET.md`. Session handoff contract (when to propose `/clear` mid-command, what STATE.md must carry for clean reprise): `protocols/HANDOFF.md`.

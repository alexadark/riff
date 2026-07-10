# RIFF Framework

## Core rules (always-on)

- **R1** Minor bug → fix, log in SUMMARY. **R2** Missing piece → add if obvious, log in SUMMARY. **R3** Architecture change → STOP, ask human. **R4** Out of scope → seed it, do not build.
- **Atomic commits.** One commit per task. Never `git add .`. Use normal conventional-commit messages that describe the feature or bug (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`). Do NOT mention `riff`, phase numbers, or task numbers in commit messages — that metadata lives in SUMMARY.md and ROADMAP.yaml. Pre-commit hook must pass.
- **Non-negotiable code quality (production scope).** No `any`. No `console.log`. No hardcoded secrets. No `// TODO` without a seed. Validate input at boundaries. Auth check on every protected route. Scope queries to the authenticated user (no IDOR). In `scope: scratch` projects, only the "no hardcoded secrets" rule applies (the rest don't fit Python/bash/local-only scripts).

## Project scope

`scope: scratch | production` in `.planning/config.json`, set at `/riff:start` Stage 1. Default when missing → `production`. Drives which stages run on `/riff:start` and which gates run on `/riff:next`. Per-scope behavior, code-quality rule applicability, and promotion trigger: `protocols/EXECUTION.md` § Project Scope.

## Language

Reply in `user.conversational_language` from `profile.yaml`. Write artifacts in `user.artifact_language`. Resolution order, edge cases, agent-by-agent applicability: `references/LANGUAGE.md`.

## Profile resolution

Every reference to "`profile.yaml`" in this framework resolves per `references/PROFILE-RESOLUTION.md`: project override (`.planning/profile.yaml`) → framework default (`<framework_root>/profile.yaml`) → default profile (`templates/profile.default.yaml`).

## Explanation level

Calibrate from `style.terminal_explanation_level` (override) → `style.explanation_level` → default `simple`. Per-level vocabulary rules: `references/EXPLANATION-LEVEL.md`. Same rule governs `AskUserQuestion` prompts mid-pipeline (see `references/EXPLANATION-LEVEL.md` § Interactive questions).

Explanation level sets vocabulary, NOT length. Length is governed by `style.length` and applies to ALL terminal output (progress reports, TLDRs, answers), not just SUMMARY.md/PLAN.md. When `style.length: terse`: lead with the answer or action, no preamble; ban flattery, self-narration ("je me suis trompé", "voici l'état réel"), hedge openers ("un bémol", "pour être honnête"), rhetorical antithesis for emphasis ("pas X, c'est Y"), and transition fluff; every sentence carries info. Full rules: `references/EXPLANATION-LEVEL.md` § Length.

## Conversational triggers

These actions are NOT slash commands. Read the listed protocol or just do the thing inline when the user says one of these:

Incident, promotion, and deep-audit flows are project-scoped skills (auto-triggered by phrase); the rows below are the remaining inline triggers.

The triggers below are matched by the FULL phrase, not by isolated words. If the user says only "review" (with no qualifier like "incident", "milestone", "phase N"), do NOT silently load DEEP-AUDIT or INCIDENT — ask which one they mean.

| User says...                                                                            | Do                                                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| "re-audit phase N", "re-run security on this branch", "verify phase N before merge"     | Mirror `/riff:next` Steps 5c, 6, 7: run `.riff/scripts/scope-check.mjs`, adversarial Codex, and security-reviewer against the named phase. Write `.planning/phases/N-slug/VERIFICATION.md`. |
| "audit codebase", "health check", "assess this project"                                 | Read skill `audit-codebase` SKILL.md, run mode `bug` / `ai` / `full` based on user phrasing (default `full`). Skip silently if `scope=scratch`. |
| "resync riff", "sync framework", "re-link riff symlinks"                                | Run `bash .riff/riff-resync.sh` from the project root, paste output back. Surfaces CLAUDE.md drift; never auto-patches. |
| "set up monitoring", "configure post-deploy", "wire sentry", "post-deploy"               | Read `protocols/POST-DEPLOY.md`, run the one-shot monitoring setup (Sentry, health endpoint, scheduled smoke). User-triggered when the app is deployed.  |
| "change my profile X to Y", "set my notification channel to Z", "edit profile.yaml"     | Edit the active profile (project override `.planning/profile.yaml` if it exists, else framework default; see `references/PROFILE-RESOLUTION.md`). Preserve other fields. Confirm the change. |
| "what's pending", "pending inbox", "what am I forgetting", "où j'en suis partout"       | Run `node .riff/scripts/riff-pending.mjs` (works from any RIFF project; the same file lives at the framework root). Format the sorted cross-project list of finishers, unreviewed decisions, and parked branches; offer to open artifacts or resolve finishers. |
| "finisher F{N} ok, merge it", "resolve finisher F{N}", "reject finisher F{N}"           | Read the run's `finishers.yaml` + the finisher's artifact, apply the human verdict (merge the parked branch / discard), flip `status: resolved`. See `protocols/AUTONOMY.md` § Finishers. |
| "stop the loop", "arrête la boucle", "stop the autonomous loop"                          | `touch .planning/autonomy/STOP` — the loop finishes the in-flight run cleanly, then stops. See `protocols/AUTONOMY.md` § Loop mode. |

Discoverable via this section. Do not invent commands the user did not invoke.

## Where to look

- User profile: `profile.yaml` (resolved per `references/PROFILE-RESOLUTION.md`: project override `.planning/profile.yaml` → framework default). Every agent reads it on startup for persona, strictness, length, budget.
- Command catalog: `commands/INDEX.md`.
- Planning: `agents/planner.md` (Confidence Gate, Assumptions Mode, Wave grouping, Logical Dependency Check).
- Executing: `agents/executor.md` (Confidence Gate, Model Dispatch, Documentation Updates).
- Security: `agents/security-reviewer.md` (auto-runs after every build phase). HITL reserved for phases requiring manual human verification against a **production** surface (real OAuth/SSO against a prod IdP, real payment checkout, MFA / hardware token, DNS/prod cutover, irreversible migrations); code-only auth/payment work runs AFK on security-reviewer + adversarial Codex. **Sandbox provider flows** (`provider_mode: sandbox`) also stay AFK — `/riff:next` routes the verification through the browser verification protocol (Lightpanda headless, see `references/BROWSER-VERIFICATION.md`) instead of pausing. See `agents/planner.md` § `provider_mode`.
- Style rules: `taste.md` (`## Architecture` always + `## Stack: {{stack}}` on frontend/route tasks). Stack files live in `references/taste/stacks/`, injected at `/riff:start`.
- Hooks: `hooks/README.md` § Buckets.
- Budget and model resolution: `protocols/MODEL.md` § Budget and model resolution.
- Autonomous sessions (`--autonomous` on `/riff:next` or `/riff:wave`): `protocols/AUTONOMY.md` — front-loaded decisions, zero questions during build, DECISIONS ledger, batched end verification, finishers awaiting human sign-off. Cross-project inbox: `.riff/scripts/riff-pending.mjs`.
- Roadmap mutations: `commands/add-phase.md` (append-only; use `depends_on` for ordering, `status: skipped` to remove).
- Project state: `STATE.md` + `ROADMAP.yaml`. Phase changes: `SUMMARY.md` per phase. Pruning: `DECAY.md`.

## Context budget

GREEN under 100k, YELLOW 100k-200k (be selective), RED 200k+ (checkpoint, propose `/clear`). Sub-agent returns and inline file reads are the biggest bloat source. Full guidance: `references/CONTEXT-BUDGET.md`. Session handoff contract (when to propose `/clear` mid-command, what STATE.md must carry for clean reprise): `protocols/HANDOFF.md`.

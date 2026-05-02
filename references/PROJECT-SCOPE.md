# Project scope

Set at `/riff:start` Stage 1, stored in `.planning/config.json` as `scope: scratch | production`. Default when missing → `production` (existing projects are unaffected).

> Project scope and project profile are independent. Scope drives which stages and gates run; profile drives persona, strictness, language, and budget. For per-project profile override, see `references/PROFILE-RESOLUTION.md`.

## scratch

Personal/local apps, no auth, no public exposure, no other users.

- `/riff:start` skips Stages 2 / 2.5 / 4.5, runs light Stages 3 / 4, bootstraps only PROJECT.md + ROADMAP.yaml + STATE.md.
- `/riff:next` skips planner adversarial, simplifier, security-reviewer, adversarial Codex.
- Executor stays language-agnostic.
- Of the production code-quality rules, only "no hardcoded secrets" applies (the rest don't fit Python/bash/local-only scripts).

## production

Full RIFF discipline.

- All discovery stages run.
- All `/riff:next` gates run (planner adversarial, simplifier, security-reviewer, adversarial Codex).
- All non-negotiable code-quality rules apply.

## Promotion

When the user says "promote to production" (or equivalent, see CLAUDE.md § Conversational triggers), read `protocols/PROMOTE.md` and run the flow. No slash command.

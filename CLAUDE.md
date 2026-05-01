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

## Explanation level

When you report work, explain a bug, summarize an operation, or describe what's happening in the terminal, calibrate vocabulary and depth from `profile.yaml`.

**Resolution order** (first found wins):
1. `style.terminal_explanation_level` — explicit terminal override
2. `style.explanation_level` — canonical user preference
3. `dashboard.level` — legacy field, back-compat
4. Default: `simple`

**If the resolved value is `eli5` and no terminal override is set, treat it as `simple`** — analogy-based phrasing doesn't fit terminal contexts (debugging, reporting, ops). When `style.terminal_explanation_level: eli5` is set explicitly, honor it.

**Per-level rules in the terminal:**

- `technical` → name functions, types, files, paths, libs (e.g. `buildPrePrompt`, `services/claude.ts`, `Bun.serve`). Tech vocab assumed. Implementation details welcome when they explain what works differently. Surface architecture decisions, not just behavior.
- `simple` → plain words, replace tech terms with what they mean (`registry` → "list of projects", `SSE` → "live updates"). Focus on what changed for the system or the user. Concrete examples beat abstract descriptions.
- `eli5` (only if explicitly set as terminal override) → one analogy if it helps. Zero tech vocabulary. Focus on user-visible outcome. 2-4 sentences max.

**This gates HOW you explain, not WHAT you show.** Logs, stack traces, error output, and commit hashes stay verbatim. The level only affects the prose around them.

## Conversational triggers

These actions are NOT slash commands. Read the listed protocol or just do the thing inline when the user says one of these:

| User says...                                                                            | Do                                                                                                       |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| "log incident", "j'ai un bug en prod", "log this as an incident"                        | Read `protocols/INCIDENT.md` § Part 1, run logging flow                                                  |
| "incident review", "review du trimestre", "quarterly incident review"                   | Read `protocols/INCIDENT.md` § Part 2, run quarterly review flow                                          |
| "promote to production", "passe en production", "this app is going public"              | Read `protocols/PROMOTE.md`, run promotion flow (always confirm at Step 1)                                |
| "re-audit phase N", "re-run security on this branch", "verify phase N before merge"     | Mirror `/riff:next` Steps 5c, 6, 7: spawn scope-checker + adversarial Codex + security-reviewer in parallel against the named phase. Write `.planning/phases/N-slug/VERIFICATION.md`. |
| "deep audit", "audit ce module", "milestone review", "review complète"                  | Read `protocols/DEEP-AUDIT.md`, run flow                                                                  |
| "audit codebase", "health check", "assess this project", "audit santé"                  | Read skill `audit-codebase` SKILL.md, run mode `bug` / `ai` / `full` based on user phrasing (default `full`). Skip silently if `scope=scratch`. |
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

Models with 1M context windows tempt you to fill them. Don't. Quality degrades well before the hard limit — hallucination risk rises sharply past ~200k effective tokens, regardless of nominal capacity. Aim for absolute token counts, not percentages.

**Targets (assume 1M-class window):**

- **GREEN (under 100k):** ideal. Batch tool calls, read files freely, work normally.
- **YELLOW (100k-200k):** acceptable. Be selective about file reads, prefer grep/glob over full reads, delegate analysis to sub-agents instead of inline reasoning over big bodies of code.
- **RED (200k+):** stop and checkpoint. Hallucination risk is real here even though the window allows more. Propose a session break at the next natural boundary in the protocol.

**Why not percentages anymore.** With 1M windows, "60% remaining" is 600k — plenty of nominal headroom but already deep in degradation territory. Use raw token counts.

**Natural session-break points in `/riff:next`:** see `commands/next.md` § Session checkpoints. Three boundaries (PLAN PROCEED, SUMMARY written, Step 7 PASS) where the parent context can be flushed via `/clear` and resumed from artifacts on disk without losing work.

**Sub-agent results count toward the parent's budget.** A 5k verdict from Codex or a 15k summary from the executor lands in your context permanently when the agent returns. Multiplied across 4-6 sub-agents per phase, that's 50-100k of accumulated returns alone. Plan for it.

**Inline file reads are the biggest bloat source.** A 200-line route file is ~5k tokens. Five of those is 25k. Prefer: spawn an Explore-style sub-agent for analysis, get back a short summary, keep the parent lean.

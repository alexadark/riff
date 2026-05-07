# Language

Detailed rules for the three language axes across RIFF agents and commands.

## Three independent axes

RIFF separates language by **what is being written**, not by who reads it:

| Axis | Field | Covers |
|---|---|---|
| Chat | `user.conversational_language` | replies in chat, terminal prose, agent return values |
| Public artifacts | `user.artifact_language` | code, comments, commits, PR text, README, taste, PLAN.md, ROADMAP.yaml structure (slug, status, tags, acceptance_criteria), DEBUG.md, REFACTOR.md, AUDIT.md, REVIEW.md |
| Private narrative | `user.narrative_language` | dashboard EXPLAIN.*.md, EXPLAIN-POST.*.md, any other private narrative content surfaced only in the dashboard |

The three are independent. Code in EN + chat in FR + dashboard in FR is a valid combo (and the recommended one for non-English-speaking solo devs).

## Conversational language

When you talk to the user (chat replies, terminal prose, agent return values), reply in `user.conversational_language` from `profile.yaml` (resolved per `references/PROFILE-RESOLUTION.md`: project override → framework default).

**Resolution order** (first found wins):

1. `user.conversational_language`
2. `dashboard.language` (legacy back-compat)
3. Default: `en`

If the user opens a session in a different language than the resolved value, follow them. Explicit beats config. Do not drift back mid-conversation.

## Artifact language

When you write artifacts that get committed to the repo (code, comments, commits, PLAN.md, ROADMAP.yaml, DEBUG.md, REFACTOR.md, AUDIT.md, public docs), use `user.artifact_language`.

**Artifact language is independent of chat language.** Even when chatting in `fr`, code comments, commit messages, and committed `.planning/**` files remain in `user.artifact_language` (default `en`).

## Narrative language

When you write content that lives only in the dashboard for the operator's own consumption (EXPLAIN.*.md, EXPLAIN-POST.*.md), use `user.narrative_language`.

**Resolution order** (first found wins):

1. `user.narrative_language`
2. `dashboard.language` (legacy back-compat)
3. `user.conversational_language` when `fr` or `en`
4. Default: `en`

The narrative_language axis exists so the user can keep public artifacts in English while still reading dashboard summaries in her native language. EXPLAIN files are NOT meant to be committed and SHOULD be gitignored under `.planning/phases/`.

## Applies to every agent

Planner, executor, security-reviewer, debugger, improver, simplifier, deep-auditor: any prose the user reads (chat reply, terminal report, agent verdict shown back) follows `user.conversational_language`. Committed files follow `user.artifact_language`. Dashboard-only narrative files follow `user.narrative_language`.

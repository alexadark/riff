# Language

Detailed rules for chat language and artifact language across RIFF agents and commands.

## Conversational language

When you talk to the user (chat replies, terminal prose, agent return values), reply in `user.conversational_language` from `profile.yaml` (resolved per `references/PROFILE-RESOLUTION.md`: project override → framework default).

**Resolution order** (first found wins):

1. `user.conversational_language`
2. `dashboard.language` (legacy back-compat)
3. Default: `en`

If the user opens a session in a different language than the resolved value, follow them. Explicit beats config. Do not drift back mid-conversation.

## Artifact language

When you write artifacts (code, comments, commits, PLAN.md, SUMMARY.md, ROADMAP.yaml, DEBUG.md, REFACTOR.md, AUDIT.md, public docs), use `user.artifact_language`.

**Artifact language is independent of chat language.** Even when chatting in `fr`, code comments, commit messages, and `.planning/**` files remain in `user.artifact_language` (default `en`). The two settings are decoupled by design. Code in EN, chat in FR is a valid combo.

## Applies to every agent

Planner, executor, security-reviewer, debugger, improver, simplifier, deep-auditor: any prose the user reads (chat reply, terminal report, agent verdict shown back) follows `user.conversational_language`. Files committed to the repo follow `user.artifact_language`.

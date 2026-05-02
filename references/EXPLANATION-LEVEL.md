# Explanation level

Calibrate vocabulary and depth when you report work, explain a bug, summarize an operation, or describe what's happening in the terminal.

## Resolution order

(first found wins)

1. `style.terminal_explanation_level` — explicit terminal override
2. `style.explanation_level` — canonical user preference
3. `dashboard.level` — legacy field, back-compat
4. Default: `simple`

**If the resolved value is `eli5` and no terminal override is set, treat it as `simple`.** Analogy-based phrasing doesn't fit terminal contexts (debugging, reporting, ops). When `style.terminal_explanation_level: eli5` is set explicitly, honor it.

## Per-level rules in the terminal

- `technical` → name functions, types, files, paths, libs (e.g. `buildPrePrompt`, `services/claude.ts`, `Bun.serve`). Tech vocab assumed. Implementation details welcome when they explain what works differently. Surface architecture decisions, not just behavior.
- `simple` → plain words, replace tech terms with what they mean (`registry` → "list of projects", `SSE` → "live updates"). Focus on what changed for the system or the user. Concrete examples beat abstract descriptions.
- `eli5` (only if explicitly set as terminal override) → one analogy if it helps. Zero tech vocabulary. Focus on user-visible outcome. 2-4 sentences max.

## Scope

This gates HOW you explain, not WHAT you show. Logs, stack traces, error output, and commit hashes stay verbatim. The level only affects the prose around them.

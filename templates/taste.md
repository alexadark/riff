# Taste - {{PROJECT_NAME}}

> Stack: {{STACK}} | Last reviewed: {{DATE}}
>
> Read this file on EVERY task. Follow the index below to load only the sections relevant to what you're touching. Do not eagerly read all sections — they are conditional by design.

## Always-apply architecture

<!-- Populated by /riff:start from references/taste/architecture.md — stack-agnostic global principles -->
<!-- Plus project-specific architectural decisions surfaced during discovery -->
<!-- Keep this section focused: load-bearing principles only, not every convention -->

## Load on-demand

| Read when the task touches...                                     | File                                     |
| ----------------------------------------------------------------- | ---------------------------------------- |
| Routes, components, loaders, actions, forms, navigation, UI state | [`taste/frontend.md`](taste/frontend.md) |
| Services, jobs, providers, HTTP client, background tasks          | [`taste/backend.md`](taste/backend.md)   |
| Auth, webhooks, env vars, multi-tenant queries, secrets           | [`taste/security.md`](taste/security.md) |
| Tests, fixtures, mocks, stories, E2E                              | [`taste/testing.md`](taste/testing.md)   |

<!-- Add rows as the project grows (database.md, observability.md, etc.) -->
<!-- If a topic file exceeds ~50 lines, split it further rather than scrolling past -->

## Framework-level rules (shared across RIFF projects)

Stack gotchas (Drizzle, Zod, Vitest, React Router 7, Node ESM): see `~/DEV/frameworks/riff/references/taste/stacks/INDEX.md`. Read the relevant file only when touching that tech.

Cross-project architecture / security baseline: `~/DEV/frameworks/riff/references/taste/{architecture,security,backend,testing}.md`.

## Decisions log

<!-- Non-obvious architectural choices made during the project -->
<!-- Format: "Chose X over Y (date) — because Z" -->
<!-- This section prevents re-litigating the same decisions in future phases -->

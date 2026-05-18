---
description: Catalog of stack-specific rule files (auto-gated by their own paths frontmatter)
paths:
  - "**/app/routes/**/*.{ts,tsx}"
  - "**/db/schema/**/*.ts"
  - "**/db/migrations/**"
  - "**/*.test.{ts,tsx}"
  - "**/*.spec.{ts,tsx}"
  - "**/scripts/**/*.ts"
  - "**/*.schema.ts"
---

# Stack-Specific Rules Index

> Each stack file has own `paths:` frontmatter, auto-loads only when Claude reads matching file. Index = catalog, not loader.
>
> **Source of truth:** dir symlinks to `~/DEV/frameworks/riff/references/taste/stacks/`. Edits propagate across all RIFF projects.

| File                          | Read when...                                                                |
| ----------------------------- | --------------------------------------------------------------------------- |
| `react-router-7.md`           | Touching `app/routes/`, loader, action, form, navigation, RR7 auth          |
| `tanstack-start-v1.md`        | TanStack Start v1 root route, server fn, entry files, Tailwind 4, husky 9   |
| `better-auth-ui.md`           | Auth UI work with `@better-auth-ui/react` (basePaths, requireEmailVerification) |
| `shadcn-registry.md`          | shadcn `add <registry-url>` bulk install hygiene, dead-code residue         |
| `react-day-picker.md`         | Calendar / date picker (v10 classname renames)                              |
| `react-router-ssr-query.md`   | Adding `@tanstack/react-router-ssr-query` (version pinning, SSR wiring)     |
| `drizzle.md`                  | DB schema, queries, migrations, JSONB ops, upserts                          |
| `zod.md`                      | Writing/modifying Zod schemas, validation, form parsing                     |
| `vitest.md`                   | Writing tests, mocking modules, MSW handlers                                |
| `node-esm.md`                 | Standalone scripts (`scripts/*.ts`) for seeds, imports, backfills           |
| `server-utilities.md`         | Editing `app/lib/server/**` in saas-starter / web-starter projects          |
| `deep-module.md`              | Adding or refactoring features under `app/lib/server/` or `app/server/services/` |
| `vercel-ai-sdk.md`            | Any LLM streaming, chat UI, structured output (`ai`, `@ai-sdk/*` packages)  |

## When to use

- Task touches tech → read file before writing code.
- Task unrelated → skip.
- Pattern here contradicts project's local `taste.md` → project wins (more specific).

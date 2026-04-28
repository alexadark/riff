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

| File                | Read when...                                                       |
| ------------------- | ------------------------------------------------------------------ |
| `react-router-7.md` | Touching `app/routes/`, loader, action, form, navigation, RR7 auth |
| `drizzle.md`        | DB schema, queries, migrations, JSONB ops, upserts                 |
| `zod.md`            | Writing/modifying Zod schemas, validation, form parsing            |
| `vitest.md`         | Writing tests, mocking modules, MSW handlers                       |
| `node-esm.md`       | Standalone scripts (`scripts/*.ts`) for seeds, imports, backfills  |

## When to use

- Task touches tech → read file before writing code.
- Task unrelated → skip.
- Pattern here contradicts project's local `taste.md` → project wins (more specific).

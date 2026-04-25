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

> Each stack file has its own `paths:` frontmatter and auto-loads only when Claude reads a matching file. This index is a catalog, not a loader.
>
> **Source of truth:** this directory is a symlink to `~/DEV/frameworks/riff/references/taste/stacks/`. Edits propagate to all RIFF projects.

| File                | Read when...                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| `react-router-7.md` | Touching any `app/routes/`, loader, action, form, navigation, or RR7 auth |
| `drizzle.md`        | Writing DB schema, queries, migrations, JSONB operations, upserts         |
| `zod.md`            | Writing or modifying Zod schemas, validation, form parsing                |
| `vitest.md`         | Writing tests, mocking modules, setting up MSW handlers                   |
| `node-esm.md`       | Writing standalone scripts (`scripts/*.ts`) for seeds, imports, backfills |

## When to use

- If the task touches the tech: read the file before writing code.
- If the task is unrelated: do not read these files.
- If a pattern here contradicts the project's local `taste.md`: project-level rules win (they're more specific).

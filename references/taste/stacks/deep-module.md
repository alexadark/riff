---
description: Deep module pattern for organizing server features (folder per feature, barrel as public API, mock the DB not the module)
paths:
  - "**/app/lib/server/**/*.ts"
  - "**/app/server/services/**/*.ts"
---

# Taste Reference - Deep Module Pattern

> Apply when adding or refactoring server features under `app/lib/server/` (saas-starter, web-starter) or `app/server/services/`. The pattern is a project-specific override of "flat utility files" — not a default Claude assumes.

## Why deep modules

A feature is a folder, not a file. The folder has one public file (`index.ts` barrel) and many internal files. AI agents and developers see a narrow, discoverable API instead of dozens of internal helpers leaking through imports.

## Folder structure

When adding a feature like `billing`:

```
app/lib/server/
  billing/
    index.ts          # public barrel: only what callers need
    plans.ts          # internal
    invoices.ts       # internal
    stripe.ts         # internal
    __tests__/
      plans.test.ts
      invoices.test.ts
      stripe.test.ts
  index.ts            # top-level barrel re-exports the feature
```

Top-level barrel:

```ts
// app/lib/server/index.ts
export { createSubscription, cancelSubscription, getInvoices } from "./billing";
```

Single-file utilities (`config.ts`, `logger.ts`) stay flat — only graduate to a folder when internal complexity justifies multiple files.

## Hard rules

1. **Barrel = public API.** If a symbol isn't in `index.ts`, callers must not import it. Internal files are implementation detail. This is the override that makes the pattern work — without it, every internal file becomes a public surface and refactoring breaks consumers.

2. **Mock the DB, not the module.** When testing a function that uses Drizzle, mock the DB chain (`select/insert/update/delete`), not the function itself. Mocking the module verifies your mock, not your code. Reference pattern: `app/lib/server/__tests__/config.test.ts`.

3. **Modules stay independent.** If module A needs something from module B, prefer passing it as a parameter over importing B. Reduces coupling and makes tests trivially mockable. Direct B-from-A imports are allowed but should be a deliberate choice, not the default.

## What this overrides

- "Just put utilities in flat files at the top level" — common in many TS projects, rejected here for discoverability and refactor safety.
- "Mock the module under test" — common AI default, rejected here because it invariably tests the mock instead of the code.

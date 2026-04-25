---
description: Zod gotchas (z.record arity, superRefine + partial, UUID variant bits, boolean default inference)
paths:
  - "**/schemas/**/*.ts"
  - "**/*.schema.ts"
  - "**/validators/**/*.ts"
  - "**/lib/schemas/**/*.ts"
  - "**/app/routes/**/*.{ts,tsx}"
  - "**/app/server/**/*.ts"
---

# Taste Reference - Zod

> Apply when stack includes Zod. Read this file on any schema / validation task.
> When you need API details beyond these rules, use Context7 MCP: `resolve-library-id("zod")` then `query-docs`.

## Core Rules

1. **`z.record()` requires 2 arguments.** Use `z.record(z.string(), z.unknown())`, never the 1-arg `z.record(z.unknown())` form (causes TS2554). For user-facing JSONB input where only string values are allowed, tighten to `z.record(z.string(), z.string())` — this acts as an **injection guard** preventing arbitrary object injection.

2. **`z.boolean().default(false)` changes the inferred OUTPUT type** from `boolean | undefined` to `boolean`, making the field required at call sites (e.g. `BatchTriggerAndWait`, Trigger.dev `trigger()`). For optional task/form payload fields, use `z.boolean().optional()` + destructuring default instead:

   ```ts
   const schema = z.object({ force: z.boolean().optional() });
   const { force = false } = schema.parse(payload); // input stays optional, runtime defaults safely
   ```

3. **`superRefine` + `.partial()` are incompatible.** `.partial()` cannot be called on a `ZodEffects` object (what `superRefine` returns). Extract a base object schema first:

   ```ts
   const baseSchema = z.object({ type: z.enum(...), searchModes: z.array(z.string()).optional() });

   // Create path: apply refinement to the base
   export const createSchema = baseSchema.superRefine((data, ctx) => {
     if (data.type === "search" && !data.searchModes?.length) {
       ctx.addIssue({ code: z.ZodIssueCode.custom, message: "...", path: ["searchModes"] });
     }
   });

   // Update path: partial on the base (no refinement — all fields optional)
   export const updateSchema = baseSchema.partial();
   ```

4. **`superRefine` is the right tool for cross-field conditional requirements.** When a field is required only for certain enum values, or when validation depends on multiple fields, use `superRefine` — not a top-level `.refine()` on each field. The check lives at the object level and can reference siblings.

5. **UUID validation in tests.** `00000000-0000-0000-0000-000000000001` is REJECTED by `z.string().uuid()` because it has variant bits `00` (must be `89ab`). Use properly-formatted UUIDs like `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` in test fixtures and constants.

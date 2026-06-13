---
last_audited: 2026-05-28
description: Zod gotchas (z.record arity, superRefine + partial, UUID variant bits, boolean default inference)
# scoped to schema/validator locations — dropped app/routes/** (owned by
# react-router-7.md) and app/server/** (owned by deep-module.md); both loaded zod
# on every route/server file instead of only on validation work.
paths:
  - "**/schemas/**/*.ts"
  - "**/*.schema.ts"
  - "**/validators/**/*.ts"
  - "**/lib/schemas/**/*.ts"
---

# Taste Reference - Zod

> Apply when stack includes Zod. Read on any schema/validation task.
> API details beyond these rules: Context7 MCP `resolve-library-id("zod")` then `query-docs`.

## Core Rules

1. **`z.record()` requires 2 args.** Use `z.record(z.string(), z.unknown())`, never 1-arg `z.record(z.unknown())` (causes TS2554). User-facing JSONB input where only string values allowed → tighten to `z.record(z.string(), z.string())` — acts as **injection guard** preventing arbitrary object injection.

2. **`z.boolean().default(false)` changes inferred OUTPUT type** from `boolean | undefined` to `boolean`, making field required at call sites (`BatchTriggerAndWait`, Trigger.dev `trigger()`). Optional task/form payload fields → `z.boolean().optional()` + destructuring default:

   ```ts
   const schema = z.object({ force: z.boolean().optional() });
   const { force = false } = schema.parse(payload); // input stays optional, runtime defaults safely
   ```

3. **`superRefine` + `.partial()` incompatible.** `.partial()` cannot be called on `ZodEffects` (what `superRefine` returns). Extract base object schema first:

   ```ts
   const baseSchema = z.object({ type: z.enum(...), searchModes: z.array(z.string()).optional() });

   // Create path: refinement on base
   export const createSchema = baseSchema.superRefine((data, ctx) => {
     if (data.type === "search" && !data.searchModes?.length) {
       ctx.addIssue({ code: z.ZodIssueCode.custom, message: "...", path: ["searchModes"] });
     }
   });

   // Update path: partial on base (no refinement, all fields optional)
   export const updateSchema = baseSchema.partial();
   ```

4. **`superRefine` for cross-field conditional requirements.** Field required only for certain enum values, or validation depends on multiple fields → `superRefine`, not top-level `.refine()` per field. Check lives at object level, references siblings.

5. **UUID validation in tests.** `00000000-0000-0000-0000-000000000001` REJECTED by `z.string().uuid()` — variant bits `00` (must be `89ab`). Use properly-formatted UUIDs like `a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d` in fixtures + constants.

6. **Normalize before validate.** Field with both validation rules AND data cleanup → transform first, validate after. `z.string().email().transform(s => s.trim().toLowerCase())` rejects `"  FOO@Bar.com  "` as "invalid email" even though it would be valid after cleanup. Reorder via `.transform()` then `.pipe()` so the validator sees clean input:

   ```ts
   const EmailSchema = z
     .string()
     .transform((s) => s.trim().toLowerCase())
     .pipe(z.string().email());
   ```

   Same applies to any normalize-then-validate pair (slug formatting + length check, phone-number formatting + regex). User-facing forms hit this most.

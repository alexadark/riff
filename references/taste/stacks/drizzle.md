---
description: Drizzle ORM gotchas (jsonb inference, onConflictDoUpdate constraints, containment queries, select projection drift)
paths:
  - "**/db/schema/**/*.ts"
  - "**/db/migrations/**"
  - "**/*.schema.ts"
  - "**/drizzle.config.{ts,js}"
  - "**/queries/**/*.ts"
  - "**/repositories/**/*.ts"
---

# Taste Reference - Drizzle ORM

> Apply when stack includes Drizzle + postgres.js. Read this file on any DB schema or query task.
> When you need API details beyond these rules, use Context7 MCP: `resolve-library-id("drizzle-orm")` then `query-docs`.

## Core Rules

1. **Untyped jsonb columns are `unknown` in TS.** Casting directly to a narrower type fails TS2352. Cast through unknown: `(val as unknown) as TargetType`. Prefer `.$type<YourType>()` on the column definition for correct inference upstream.

2. **`onConflictDoUpdate` does not accept `sql()` in `target`.** The `target` field only accepts column references, not SQL expressions. `ON CONFLICT ON CONSTRAINT` also does not work for unique _indexes_ (only named constraints). When your conflict column is backed by a functional index (e.g. `lower(firm_name)`), use the **insert-then-select** pattern:

   ```ts
   const inserted = await db
     .insert(table)
     .values(rows)
     .onConflictDoNothing()
     .returning({ id: table.id, key: table.key });

   const insertedKeys = new Set(inserted.map((r) => r.key));
   const missing = rows.map((r) => r.key).filter((k) => !insertedKeys.has(k));

   const existing = missing.length
     ? await db
         .select({ id: table.id, key: table.key })
         .from(table)
         .where(inArray(table.key, missing))
     : [];

   // If pre-existing rows need a merge (e.g. JSONB update), do a separate UPDATE pass.
   ```

   This pattern is idempotent: re-running produces 0 new inserts and 0 side effects.

3. **JSONB containment query (`@>`) with Drizzle `sql` template** — to look up a row by a provider-specific key stored in JSONB:

   ```ts
   where(
     and(
       eq(table.organizationId, orgId),
       sql`${table.externalProviderIds} @> ${JSON.stringify({ provider_key: value })}::jsonb`,
     ),
   );
   ```

   Always scope by `organizationId` (or equivalent) for multi-tenant isolation. Add a `CREATE INDEX ... USING GIN` on the JSONB column for scale.

4. **Adding a column breaks plain `.select({...})` calls.** TypeScript catches the mismatch on return-type extensions (`Row` extending base). Grep for `.select({` on the affected table and add the new column to every projection. Also update any test factory functions that build plain rows.

5. **`jsonb_set` for targeted JSONB merges** — use when only one sub-key needs updating:
   ```ts
   set({
     externalProviderIds: sql`jsonb_set(
       coalesce(${table.externalProviderIds}, '{}'),
       '{provider_key}',
       ${JSON.stringify(value)}::jsonb
     )`,
   });
   ```

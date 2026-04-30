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

> Apply when stack includes Drizzle + postgres.js. Read on any DB schema/query task.
> API details beyond these rules: Context7 MCP `resolve-library-id("drizzle-orm")` then `query-docs`.

## Core Rules

1. **Untyped jsonb columns = `unknown` in TS.** Direct cast to narrower type fails TS2352. Cast through unknown: `(val as unknown) as TargetType`. Prefer `.$type<YourType>()` on column definition for upstream inference.

2. **`onConflictDoUpdate` rejects `sql()` in `target`.** `target` accepts column refs only, not SQL expressions. `ON CONFLICT ON CONSTRAINT` doesn't work for unique _indexes_ (named constraints only). Conflict column backed by functional index (e.g. `lower(firm_name)`) → use **insert-then-select**:

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

   // Pre-existing rows needing merge (e.g. JSONB update) → separate UPDATE pass.
   ```

   Idempotent: re-run produces 0 new inserts, 0 side effects.

3. **JSONB containment query (`@>`) with Drizzle `sql` template** — lookup row by provider-specific key in JSONB:

   ```ts
   where(
     and(
       eq(table.organizationId, orgId),
       sql`${table.externalProviderIds} @> ${JSON.stringify({ provider_key: value })}::jsonb`,
     ),
   );
   ```

   Always scope by `organizationId` (or equivalent) for multi-tenant isolation. `CREATE INDEX ... USING GIN` on JSONB column for scale.

4. **Adding column breaks plain `.select({...})` calls.** TS catches mismatch on return-type extensions (`Row` extending base). Grep `.select({` on affected table, add new column to every projection. Update test factory functions that build plain rows.

5. **`jsonb_set` for targeted JSONB merges** — only one sub-key needs updating:

   ```ts
   set({
     externalProviderIds: sql`jsonb_set(
       coalesce(${table.externalProviderIds}, '{}'),
       '{provider_key}',
       ${JSON.stringify(value)}::jsonb
     )`,
   });
   ```

6. **Drizzle's `sql` template tag does NOT serialize `Date` instances.** `postgres.js` handles Dates natively, but the Drizzle wrapper throws `The "string" argument must be of type string or an instance of Buffer or ArrayBuffer. Received an instance of Date` when it pre-processes the param. Tests that mock `drizzle-orm` won't catch this — only a real DB call does. Pass `.toISOString()` and cast at the SQL site:

   ```ts
   const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
   await db.execute(sql`... WHERE created_at > ${cutoff}::timestamptz`);
   ```

   Same applies to any non-string, non-primitive param passed via `${}` into raw `sql` template (Buffer, BigInt, custom objects). Stringify or use Drizzle's typed query builder (`eq`, `gt`, etc.) which handles serialization correctly.

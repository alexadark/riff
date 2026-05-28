last_audited: 2026-05-28
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

7. **Drizzle DSL does NOT emit `CHECK` constraints.** Schema-level `check(...)` calls in `schema.ts` are typed but `drizzle-kit generate` skips them in the SQL output. The constraint silently never lands in the migration. Same gap for partial unique indexes with `WHERE` predicates — DSL accepts the syntax but the emitted SQL drops the predicate. Workflow:

   1. Run `drizzle-kit generate` to produce the numbered migration.
   2. Open the migration file.
   3. Manually append `ALTER TABLE "<t>" ADD CONSTRAINT "<name>" CHECK (...)` (or inline `CHECK` in the `CREATE TABLE` if the table is new in this migration).
   4. For partial unique indexes: append `CREATE UNIQUE INDEX "<name>" ON "<t>" (<col>) WHERE <predicate>` after the table-creation block.

   Test the constraint shipped by asserting its presence in the migration text from a unit test (`expect(migrationSql).toContain('CHECK (kind IN ...)')`). Re-run `drizzle-kit generate` after a schema change → re-add the constraint manually each time, or maintain a separate `manual/` SQL directory referenced from the numbered migration.

## Supabase + Drizzle: RLS belongs in migrations

Drizzle never emits `ENABLE ROW LEVEL SECURITY`. Supabase exposes every table in `public` to the anon role through PostgREST, so a fresh table is world-readable until RLS is on. Don't keep an out-of-band `rls-policies.sql` "to run manually in the SQL Editor" — it WILL drift. Land RLS as a numbered migration so `db:migrate` applies it everywhere it goes.

Per new table, in the same migration that creates it:

```sql
ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "<table>_select" ON "<table>";
CREATE POLICY "<table>_select" ON "<table>"
  FOR SELECT USING (
    organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  );
-- + insert/update/delete as needed, or omit = deny-all through PostgREST.
```

Server-only tables (config, cache, log tables that no client should hit) get `ENABLE RLS` with no policy. Drizzle connects as table owner and bypasses RLS, so server code is unaffected.

Make policy creation idempotent (`DROP POLICY IF EXISTS` before each `CREATE POLICY`) so the migration is safe to re-run after a partial apply.

## Auto-apply migrations on Vercel build

Default `build` does not migrate. Add a `vercel-build` script Vercel auto-detects:

```json
"db:check-safe": "tsx --env-file-if-exists=.env scripts/check-safe-migration.ts",
"vercel-build": "pnpm run db:check-safe && pnpm run db:migrate && pnpm run build"
```

Match the package manager the project uses (`pnpm`/`npm`/`yarn`). Mixing `npm run` inside a pnpm project breaks the `node_modules/.bin` path so `tsx` is not found.

`check-safe-migration.ts` (template at `riff/templates/scripts/check-safe-migration.ts`) reads `drizzle/meta/_journal.json`, queries `drizzle.__drizzle_migrations`, and scans pending migrations for destructive patterns (`DROP TABLE/COLUMN`, `TRUNCATE`, `DELETE FROM`, `RENAME`, `ALTER COLUMN ... TYPE`). Match → exit 1 → build fails → migration must be applied manually. Override per-migration with `-- @riff:reviewed` after a careful read.

The framework hook `hooks/migration-gate.sh` enforces the RLS pairing on commit: any `CREATE TABLE` in a staged migration without a matching `ENABLE ROW LEVEL SECURITY` blocks the commit (Supabase projects only, detected via `@supabase/*` in `package.json`). Bypass: `RIFF_SKIP_RLS_CHECK=1`.

## Daily RLS audit (catches what slipped past the hook)

The pre-commit hook only sees migrations that go through the local commit pipeline. Tables added directly via the Supabase SQL editor, a different machine without the hook, or a `--no-verify` bypass land in prod unchecked. To catch those, drop in the linter:

- `templates/scripts/check-rls.ts` — runs the two Supabase rules that matter for multi-tenancy (`rls_disabled_in_public` + `policy_exists_rls_disabled`) directly against `pg_class` / `pg_policy`. Exits 1 if any public table is unprotected.
- `templates/github-workflows/db-lint.yml` — runs the script daily (cron) and on push to `main`/PRs, with `DATABASE_URL` from repo secrets.

Wire-up:
```json
"db:check-rls": "tsx --env-file-if-exists=.env scripts/check-rls.ts"
```

The daily cron is the safety net: even a table created from a coffee-shop laptop with no RIFF hooks installed shows up as a red CI run within 24h.

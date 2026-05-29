---
last_audited: 2026-05-28
description: Node ESM / tsx script conventions (dry-run policy, sanitization tables, Postgres bind-param limits)
paths:
  - "**/scripts/**/*.ts"
  - "**/seeds/**/*.ts"
  - "**/bin/**/*.ts"
  - "**/tools/**/*.ts"
---

# Taste Reference - Node ESM / tsx Scripts

> Apply when writing standalone scripts (seeds, imports, migrations, backfills) running via `tsx` / `node` in ESM mode.

## Core Rules

1. **`--dry-run` flag mandatory for destructive scripts.** Any import/migrate/seed/backfill MUST accept `--dry-run`:
   - Zero DB writes (no inserts, updates, deletes, creates)
   - Print expected counts (records fetched, unique keys, contacts)
   - Validation logic still runs (UUID, env var checks)
   - Exit 0 on dry-run success

   ```ts
   const dryRun = process.argv.includes("--dry-run");
   // ...
   if (dryRun) {
     console.log(`[DRY RUN] Would insert ${rows.length} rows`);
     continue;
   }
   await db.insert(table).values(rows).onConflictDoNothing();
   ```

2. **Paginated external APIs: retry at page-fetch level.** Preserves pagination state — transient fail on page N retries page N, not whole import:

   ```ts
   const MAX_RETRIES = 3;
   const fetchPage = async (offset: number) => {
     for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
       try {
         const res = await fetch(`${url}?offset=${offset}&limit=1000`, { headers });
         if (!res.ok) throw new Error(`HTTP ${res.status}`);
         return await res.json();
       } catch (err) {
         if (attempt === MAX_RETRIES) throw err;
         await sleep(2 ** attempt * 500); // 1s, 2s, 4s
       }
     }
   };
   ```

   `offset` and `pagesFetched` counters OUTSIDE retry loop.

3. **Idempotent seed pattern.** Re-running seed produces 0 new inserts, 0 side effects:
   - Check-before-create for lookup/parent entities
   - `onConflictDoNothing()` for bulk inserts (see drizzle.md for functional-index workaround)
   - Log counts per sanitization action (skipped empty, truncated, null-ed placeholder), not just errors
   - Parameterize via Drizzle `sql` template — never raw string interpolation

4. **Input sanitization for untrusted legacy data.** Importing from legacy DB with no enforced schema:

   | Field                             | Sanitization                                                     |
   | --------------------------------- | ---------------------------------------------------------------- |
   | Required string                   | Skip if empty/null; truncate at column limit                     |
   | URL                               | Null-out placeholders: `"N/A"`, `"n/a"`, `"-"`, `"None"`         |
   | Email                             | Null-out if no `@` or no `.` after `@`                           |
   | Name fallback                     | First+last empty + email present → `email.split("@")[0]`         |
   | String exceeding column limit     | `value.slice(0, limit)`                                          |

   Log counts per action in final summary.

5. **Sub-batch large inserts to respect Postgres 65,535 bind param limit.** Divide each page (e.g. 1000 records) into sub-batches of 500:

   ```ts
   const SUBBATCH = 500;
   for (let i = 0; i < rows.length; i += SUBBATCH) {
     await processChunk(rows.slice(i, i + SUBBATCH));
   }
   ```

   Also keeps transaction sizes predictable + progress logging granular.

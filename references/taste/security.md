# Taste Reference - Security

> Rules for security and code discipline.

## Rules

1. **Zero broken windows** - No `any`. No `console.log` in committed code. No TODO without a GitHub issue. No commented-out code. Each one left behind signals "this codebase tolerates mess."

2. **Validate environment at startup** - All env vars validated with Zod on server start. Crash early with a clear message, not in production when a user hits a page.

3. **Multi-tenant: org-scope EVERY lookup — no implicit trust.** When a service resolves entities by a user-supplied or URL-derived ID (e.g. `investorId`, `campaignId`), every DB query must include an `organizationId` predicate. Defense-in-depth: even if upstream callers are "trusted", a future mistake leaks cross-tenant data.

   ```ts
   // BAD — no org filter
   const [row] = await db
     .select()
     .from(campaignInvestors)
     .where(eq(campaignInvestors.investorId, investorId));

   // GOOD — join or filter by org on every step
   const [row] = await db
     .select({ campaignId: campaignInvestors.campaignId })
     .from(campaignInvestors)
     .innerJoin(campaigns, eq(campaigns.id, campaignInvestors.campaignId))
     .where(
       and(
         eq(campaignInvestors.investorId, investorId),
         eq(campaigns.organizationId, orgId),
       ),
     );
   ```

4. **Atomic cooldown / rate-limit markers before irreversible side effects.** Any cooldown, lock, or rate-limit guarding an expensive or non-idempotent operation must write its marker **synchronously and atomically BEFORE** the side effect — not after, and not inside the async job. Check-then-trigger is a TOCTOU race:

   ```ts
   // BAD — two concurrent requests can both pass the check
   if (!await isEligible(id)) return error;
   await triggerExpensiveJob(id);

   // GOOD — use an atomic insert with unique constraint or onConflictDoNothing
   const [lock] = await db.insert(cooldowns)
     .values({ id, expiresAt: ... })
     .onConflictDoNothing()
     .returning({ id: cooldowns.id });
   if (!lock) return { error: "already running or cooling down" };
   await triggerExpensiveJob(id);
   ```

   Alternative mechanisms: Postgres advisory locks, unique constraints with a deterministic key, Redis `SET NX` with TTL.

5. **Webhook auth: verify HMAC on the raw body, never via parsed JSON.** Read with `request.text()`, compute/verify the HMAC, then `JSON.parse()` manually. Calling `request.json()` first re-serializes and can drift from the signed bytes. Always verify external webhook signatures — do not skip in dev for external-facing endpoints (internal M2M callbacks may skip in dev, external must not).

6. **All input validated at boundaries with Zod.** HTTP boundary (routes), job payloads (Trigger.dev schemas), external webhook bodies, provider adapter responses. Never trust JSON from an external source without a schema.

7. **Double-HMAC for single-use token storage.** Raw token shape: `{uuid}.{hmac(uuid, secret)}`. DB stores only `hmac(rawToken, secret)` (second HMAC layer). Validation parses and verifies the first HMAC before computing the DB hash. This prevents replay even if an attacker reads the DB row, because the stored hash cannot be reversed into a valid token without the secret. Return the raw token once on creation; all other operations work with the hash only.

8. **Timing-safe hex comparison for cryptographic signatures.** `timingSafeEqual` throws on mismatched buffer lengths. Wrap it: convert hex strings to buffers, pre-check length (returns false on mismatch), then call `timingSafeEqual`. Use this instead of `===` on hex strings in any signature validation (tokens, webhooks, callbacks).

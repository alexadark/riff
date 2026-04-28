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

9. **Three-key assertion for nested resource mutations.** Tenant isolation alone is not enough — within a single org, a user on `/parents/A` can POST a `childId` belonging to parent B. Before any mutation, assert the child belongs to BOTH the URL-derived parent AND the org in one indexed query (`childId + parentId + orgId`). Throw `data({ message: "Forbidden" }, { status: 403 })` on miss.

10. **Cross-tenant pre-insert SQL guard for relation tables.** When a service inserts into a join table using two ids from input (`{campaignId, investorId}`), org-scope checks at the route level only verify the SESSION, not the IDs. Run a single join that returns the org for each side BEFORE the insert, and throw on mismatch. Make `orgId` a required parameter so every call site is type-forced to thread `auth.activeOrgId`.

    ```ts
    const [check] = await db
      .select({ campaignOrg: campaigns.organizationId, investorOrg: investors.organizationId })
      .from(campaigns)
      .innerJoin(investors, eq(investors.id, data.investorId))
      .where(eq(campaigns.id, data.campaignId));
    if (!check || check.campaignOrg !== data.orgId || check.investorOrg !== data.orgId) {
      throw new Error("Cross-tenant link rejected");
    }
    ```

    Composite FK `(organization_id, id)` on each side moves this into the schema once the migration ships.

11. **A signed cookie is not an authorization credential — re-check DB state at action time.** An HMAC-signed envelope (`${id}.${exp}.${HMAC}`) proves the cookie was issued by us and untampered. It says nothing about whether the underlying invite / token / link is still in the expected state. Multi-step flows MUST re-load the row by id and assert `status === "pending"` (or whatever the strict whitelist is) at the moment the action fires. Defends against pre-consume cookie replay where an attacker captures the cookie before the legit user finishes the flow.

    Companion cookie attributes: `Secure` mandatory, `Path` scoped to the actual subtree (NOT `/`), `HttpOnly`, `SameSite=Lax`, `Max-Age` aligned with envelope expiry.

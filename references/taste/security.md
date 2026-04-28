# Taste Reference - Security

> Security + code discipline rules.

## Rules

1. **Zero broken windows.** No `any`. No `console.log` in commits. No TODO without GH issue. No commented-out code. Each one signals "codebase tolerates mess."

2. **Validate env at startup.** All env vars Zod-validated on server start. Crash early with clear message, not in prod when user hits page.

3. **Multi-tenant: org-scope EVERY lookup. No implicit trust.** Service resolving entities by user/URL ID (`investorId`, `campaignId`): every DB query needs `organizationId` predicate. Defense-in-depth — even "trusted" callers, future mistakes leak cross-tenant data.

   ```ts
   // BAD — no org filter
   const [row] = await db.select().from(campaignInvestors)
     .where(eq(campaignInvestors.investorId, investorId));

   // GOOD — join + filter by org
   const [row] = await db.select({ campaignId: campaignInvestors.campaignId })
     .from(campaignInvestors)
     .innerJoin(campaigns, eq(campaigns.id, campaignInvestors.campaignId))
     .where(and(
       eq(campaignInvestors.investorId, investorId),
       eq(campaigns.organizationId, orgId),
     ));
   ```

4. **Atomic cooldown/rate-limit marker BEFORE irreversible side effect.** Cooldown/lock/rate-limit guarding expensive or non-idempotent op: write marker synchronously + atomically BEFORE side effect, not after, not inside async job. Check-then-trigger = TOCTOU race.

   ```ts
   // BAD — 2 concurrent requests both pass check
   if (!await isEligible(id)) return error;
   await triggerExpensiveJob(id);

   // GOOD — atomic insert with unique constraint
   const [lock] = await db.insert(cooldowns)
     .values({ id, expiresAt: ... })
     .onConflictDoNothing()
     .returning({ id: cooldowns.id });
   if (!lock) return { error: "already running or cooling down" };
   await triggerExpensiveJob(id);
   ```

   Alternatives: PG advisory locks, unique constraint with deterministic key, Redis `SET NX` with TTL.

5. **Webhook auth: HMAC on raw body, never parsed JSON.** Read with `request.text()`, verify HMAC, then `JSON.parse()` manually. `request.json()` first re-serializes, drifts from signed bytes. External webhooks: never skip verify, even in dev. Internal M2M: dev-skip OK.

6. **All input Zod-validated at boundaries.** HTTP boundary (routes), job payloads (Trigger.dev schemas), webhook bodies, provider adapter responses. Never trust external JSON without schema.

7. **Double-HMAC for single-use token storage.** Raw token: `{uuid}.{hmac(uuid, secret)}`. DB stores only `hmac(rawToken, secret)` (2nd HMAC layer). Validation parses + verifies 1st HMAC, then computes DB hash. Prevents replay even if attacker reads DB row — stored hash can't reverse to valid token without secret. Return raw token once on creation, all other ops work with hash.

8. **Timing-safe hex compare for crypto sigs.** `timingSafeEqual` throws on mismatched buffer lengths. Wrap: hex → buffers, length pre-check (false on mismatch), then `timingSafeEqual`. Use instead of `===` on hex strings for any signature validation (tokens, webhooks, callbacks).

9. **3-key assertion for nested resource mutations.** Tenant isolation alone insufficient — same-org user on `/parents/A` can POST `childId` of parent B. Pre-mutation: assert child belongs to URL parent AND org in one indexed query (`childId + parentId + orgId`). Miss → `throw data({ message: "Forbidden" }, { status: 403 })`.

10. **Cross-tenant pre-insert SQL guard, relation tables.** Service insert into join table from input ids (`{campaignId, investorId}`): route-level org check verifies SESSION only, not IDs. Pre-insert: single join returning org per side, throw on mismatch. `orgId` required param → every call site type-forced to thread `auth.activeOrgId`.

    ```ts
    const [check] = await db
      .select({ campaignOrg: campaigns.organizationId, investorOrg: investors.organizationId })
      .from(campaigns)
      .innerJoin(investors, eq(investors.id, data.investorId))
      .where(eq(campaigns.id, data.campaignId));
    if (!check || check.campaignOrg !== data.orgId || check.investorOrg !== data.orgId)
      throw new Error("Cross-tenant link rejected");
    ```

    Composite FK `(organization_id, id)` per side → check moves into schema. Phase 97.

11. **Signed cookie ≠ authz credential. Re-check DB state at action time.** HMAC envelope (`${id}.${exp}.${HMAC}`) proves issuance + untampered, NOT current state. Multi-step flows: reload row by id, assert `status === "pending"` (strict whitelist) at action time. Defends pre-consume cookie replay.

    Cookie attrs: `Secure` mandatory, `Path` scoped to subtree (NOT `/`), `HttpOnly`, `SameSite=Lax`, `Max-Age` = envelope expiry.

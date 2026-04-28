# Taste Reference - Backend

> Rules for backend/server-side code.

## Rules

1. **The "require" escalation pattern** - For auth and access control, always provide a soft check and a hard check: `getUserId(request)` -> `string | null`, `requireUserId(request)` -> `string` (throws redirect).

2. **Throw Response, don't return errors** - Use `throw new Response()` or `throw redirect()` for flow control in loaders/actions. Let ErrorBoundary handle it. No `{ error: string }` return types cluttering every loader.

3. **Fire-and-forget audit with `.catch()` handler.** When an action needs to log an operation but must not block the response: call `db.insert(...)` without `await`, chain `.catch(err => logger.warn(...))`. The response is already committed before the catch fires. Never silently drop the promise (unhandled rejection), always attach `.catch()` for observability.

4. **Awaited audit log with `{ ok, error }` contract for compliance-grade trails.** Counterpart to rule #3. When the audit covers an irreversible external mutation (cap-table push, fund issuance, KYC change), fire-and-forget is unsafe — silent insert failure leaves no evidence. Make the helper `async`, never `throw` (catch internally and return `{ ok: false, error }`), and require callers to surface `auditFailed: true` upstream into the response shape.

   ```ts
   const logPushOperation = async (...): Promise<{ ok: true } | { ok: false; error: string }> => {
     try { await db.insert(auditTable).values(...); return { ok: true }; }
     catch (err) { logger.warn("audit insert failed", { err }); return { ok: false, error: String(err) }; }
   };
   // caller: const audit = await logPushOperation(...); result.auditFailed = !audit.ok || undefined;
   ```

5. **N-tier match: return ALL rows per tier, surface multi-distinct-id as conflict.** When matching an external entity against local rows across N priority-ordered keys, NEVER `LIMIT 1` per tier. Same-tier duplicates (two local rows tied to the same external id) and cross-tier disagreements (id-tier points to investor X, email-tier points to Y) are real signals. Run all tiers in parallel, dedupe matches by local entity id (keep highest-priority tier label), and return `{ status: "conflict", conflicts: [...] }` when more than one distinct local id is reachable. Caller MUST stop downstream writes and append to a review queue. Never silently pick rows[0] or "highest tier wins".

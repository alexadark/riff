# Taste Reference - Backend

> Rules for backend/server-side code.

## Rules

1. **The "require" escalation pattern** - For auth and access control, always provide a soft check and a hard check: `getUserId(request)` -> `string | null`, `requireUserId(request)` -> `string` (throws redirect).

2. **Throw Response, don't return errors** - Use `throw new Response()` or `throw redirect()` for flow control in loaders/actions. Let ErrorBoundary handle it. No `{ error: string }` return types cluttering every loader.

3. **Fire-and-forget audit with `.catch()` handler.** When an action needs to log an operation but must not block the response: call `db.insert(...)` without `await`, chain `.catch(err => logger.warn(...))`. The response is already committed before the catch fires. Never silently drop the promise (unhandled rejection), always attach `.catch()` for observability.

4. **Awaited audit log, `{ ok, error }` return for compliance audits.** Counterpart to #3. Irreversible external mutation (cap-table push, fund issuance, KYC) → fire-and-forget unsafe, silent fail = no evidence. Helper `async`, never throws (catch → return `{ ok: false, error }`). Caller surfaces `auditFailed: true` in response shape.

   ```ts
   const log = async (...): Promise<{ ok: true } | { ok: false; error: string }> => {
     try { await db.insert(t).values(...); return { ok: true }; }
     catch (err) { logger.warn("audit fail", { err }); return { ok: false, error: String(err) }; }
   };
   ```

5. **N-tier match: ALL rows per tier; multi-distinct-id = conflict.** Match external entity vs local rows across N priority keys. Never `LIMIT 1` per tier — same-tier dupes + cross-tier disagreement are real signals. Tiers parallel, dedupe by local id (keep highest-priority tier label). 1 distinct id → match. 2+ → `{ status: "conflict", conflicts: [...] }`. Caller stops writes, appends review queue. Never silent rows[0] or "highest tier wins".

# Taste Reference - Backend

> Backend/server-side rules.

## Rules

1. **Require-escalation pattern.** Auth/access control: pair soft + hard check. `getUserId(request) → string | null` vs `requireUserId(request) → string` (throws redirect).

2. **Throw Response, don't return errors.** `throw new Response()` / `throw redirect()` for flow control in loaders/actions. ErrorBoundary handles it. No `{ error: string }` return types cluttering loaders.

3. **Fire-and-forget audit with `.catch()`.** Action logs op without blocking response: `db.insert(...)` no `await`, `.catch(err => logger.warn(...))`. Response committed before catch fires. Never bare unhandled rejection — always `.catch()` for observability.

4. **Awaited audit log, `{ ok, error }` return for compliance audits.** Counterpart to #3. Irreversible external mutation (cap-table push, fund issuance, KYC) → fire-and-forget unsafe, silent fail = no evidence. Helper `async`, never throws (catch → return `{ ok: false, error }`). Caller surfaces `auditFailed: true` in response shape.

   ```ts
   const log = async (...): Promise<{ ok: true } | { ok: false; error: string }> => {
     try { await db.insert(t).values(...); return { ok: true }; }
     catch (err) { logger.warn("audit fail", { err }); return { ok: false, error: String(err) }; }
   };
   ```

5. **N-tier match: ALL rows per tier; multi-distinct-id = conflict.** Match external entity vs local rows across N priority keys. Never `LIMIT 1` per tier — same-tier dupes + cross-tier disagreement are real signals. Tiers parallel, dedupe by local id (keep highest-priority tier label). 1 distinct id → match. 2+ → `{ status: "conflict", conflicts: [...] }`. Caller stops writes, appends review queue. Never silent rows[0] or "highest tier wins".

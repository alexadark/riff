# Taste Reference - Backend

> Rules for backend/server-side code.

## Rules

1. **The "require" escalation pattern** - For auth and access control, always provide a soft check and a hard check: `getUserId(request)` -> `string | null`, `requireUserId(request)` -> `string` (throws redirect).

2. **Throw Response, don't return errors** - Use `throw new Response()` or `throw redirect()` for flow control in loaders/actions. Let ErrorBoundary handle it. No `{ error: string }` return types cluttering every loader.

3. **Fire-and-forget audit with `.catch()` handler.** When an action needs to log an operation but must not block the response: call `db.insert(...)` without `await`, chain `.catch(err => logger.warn(...))`. The response is already committed before the catch fires. Never silently drop the promise (unhandled rejection), always attach `.catch()` for observability.

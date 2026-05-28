last_audited: 2026-05-28
---
description: API reference for server utilities shipped by saas-starter and web-starter (logger, events, config, rate-limit, form, feature flags)
paths:
  - "**/app/lib/server/**/*.ts"
  - "**/app/lib/server/**/*.tsx"
---

# Taste Reference - Server Utilities (starter-shipped)

> Apply when project descends from `saas-starter` or `web-starter` and edits anything under `app/lib/server/`. Each utility is project-specific code, not a default Claude knows.

## Barrel import (single entry point)

```ts
import { logger, emit, on, createRateLimiter, parseFormData, isEnabled, getConfig } from "~/lib/server";
```

Do NOT import from individual files (`~/lib/server/logger`) unless avoiding a circular dependency. The barrel is the public API.

## Logger (`app/lib/server/logger.ts`)

- `logger.info(msg, ctx?)`, `.debug()`, `.warn()`, `.error(msg, err?, ctx?)`
- `logger.error()` returns a UUID `errorId` — surface it to the user for support correlation.
- Output: structured JSON in production, pretty-print in development.
- Level controlled by `LOG_LEVEL` env var (default `info`).

## Event bus (`app/lib/server/events.ts`)

- `emit("event.name", payload)` — fire-and-forget.
- `on("event.name", handler)` — typed handler, returns unsubscribe fn.
- Augment the `AppEvents` interface to declare your event types.
- Handlers run via `queueMicrotask` — never block the response. If you need ordering or persistence, add a queue, don't await emits.

## JSONB Config (`app/lib/server/config.ts`)

**saas-starter** (scoped):

- `getConfig(db, scope, key, zodSchema)` → typed value
- `getConfigCascade(db, key, zodSchema, scopes)` → cascading resolution (user → org → global)
- `setConfig(db, scope, key, value)` / `deleteConfig(db, scope, key)`
- Scope convention: `"global"`, `"org:{id}"`, `"user:{id}"`

**web-starter** (flat):

- `getConfig(db, key, zodSchema)`, `setConfig(db, key, value)`, `deleteConfig(db, key)`

Every value validated with Zod at runtime — never let raw JSON escape the boundary.

## Feature flags (`app/lib/server/features.ts`, saas-starter only)

- `isEnabled(db, "flag-key")` → global check
- `isEnabled(db, "flag-key", { orgId })` → with org-level override
- `getEnabledFlags(db)` → `Set` of all enabled keys
- Storage: `feature_flags` table, JSONB metadata column for per-org overrides.

## Form validation (`app/lib/server/form.ts`)

- `parseFormData(request, zodSchema)` → `{ success, data }` or `{ success, errors }` (field-level).
- Error shape works directly as a React Router action return — no manual reshaping.

## Rate limiter (`app/lib/server/rate-limit.ts`)

- `createRateLimiter({ windowMs, max })` → returns a limiter function.
- `limiter(request)` → `{ allowed, remaining, resetAt }`.
- `getRateLimitHeaders(result)` → standard `X-RateLimit-*` headers.
- Implementation: in-memory sliding window. Resets on deploy. Fine at starter scale, swap for Redis when traffic justifies it.

## Env validation (`app/lib/env.server.ts`)

- Server env vars validated at startup via Zod. Missing required var → app crashes immediately with a clear message.
- Add new var to BOTH `env.server.ts` schema AND `.env.example`. Forgetting `.env.example` breaks onboarding.
- Import: `import { env } from "~/lib/env.server";` then `env.DATABASE_URL` (typed, no `!`).

## DB connection (`app/lib/db/index.ts`)

- Lazy connection via Proxy — no DB connect at import time. Safe for typecheck and tests that don't need a DB.
- pgBouncer-compatible: `{ max: 1, prepare: false }`. Required for Supabase pooler.

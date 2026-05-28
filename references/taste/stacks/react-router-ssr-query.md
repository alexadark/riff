last_audited: 2026-05-28
---
description: @tanstack/react-router-ssr-query version pinning protocol (peer dep awareness)
paths:
  - "**/app/router.tsx"
  - "**/src/router.tsx"
  - "**/package.json"
---

# Taste Reference - @tanstack/react-router-ssr-query

> Apply when adding `@tanstack/react-router-ssr-query` to a project. Required when integrating `@tanstack/react-query` with TanStack Router under SSR (e.g., when adopting a lib like `@better-auth-ui/react` whose hooks use react-query and you need SSR-safe hydration).

## Core Rules

1. **Pin the exact version (no `^`).** This package is tightly coupled to TanStack Router internals via `peerDependencies`. A future minor of ssr-query may bump its router peer requirement, breaking your `pnpm install` resolution silently. Pin like `"@tanstack/react-router-ssr-query": "1.166.12"`, not `"^1.166.12"`.

2. **Read `peerDependencies` BEFORE you add.** Protocol:
   ```bash
   pnpm view @tanstack/react-router-ssr-query@latest peerDependencies
   ```
   If the result names a `@tanstack/react-router` range you cannot satisfy with your current router, walk back versions:
   ```bash
   pnpm view @tanstack/react-router-ssr-query versions --json
   pnpm view @tanstack/react-router-ssr-query@<version> peerDependencies
   ```
   Pick the highest version whose peer satisfies your router. Do NOT bump `@tanstack/react-router` itself just to satisfy ssr-query — that risks regressions across all routes.

3. **Standard wiring pattern.** Lifted from the start-shadcn-example:
   ```tsx
   // app/router.tsx
   import { QueryClient } from '@tanstack/react-query';
   import { createRouter } from '@tanstack/react-router';
   import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
   import { routeTree } from './routeTree.gen';

   export const getRouter = () => {
     const queryClient = new QueryClient({
       defaultOptions: { queries: { staleTime: 5000 } },
     });

     const router = createRouter({
       routeTree,
       scrollRestoration: true,
       defaultPreloadStaleTime: 0,
       context: { queryClient },
     });

     setupRouterSsrQueryIntegration({ router, queryClient });

     return router;
   };
   ```
   Use `createRootRouteWithContext<{ queryClient: QueryClient }>()` in `__root.tsx` so loaders get the typed context.

4. **`new QueryClient()` inside `getRouter()`, not at module scope.** Each request needs its own QueryClient to avoid cross-user cache leaks under SSR.

## Anti-Pattern Checklist

| Found                                                       | Replace with                                              |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `"@tanstack/react-router-ssr-query": "^1.x"` in package.json | Exact pin: `"1.166.12"` (or whatever matches peers)       |
| `pnpm add @tanstack/react-router-ssr-query` (no version) without peer check | Check `peerDependencies` first, pin exact   |
| Bumping `@tanstack/react-router` to satisfy ssr-query peer  | Walk back ssr-query versions instead — router bump is wide-blast-radius |
| `new QueryClient()` at module top-level                     | Inside `getRouter()` so it's per-request                  |
| `createRootRoute<...>()` then `useRouteContext()` for `queryClient` | `createRootRouteWithContext<{ queryClient: QueryClient }>()` |

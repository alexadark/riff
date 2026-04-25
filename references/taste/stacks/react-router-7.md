---
description: React Router 7 framework-mode conventions and anti-Next.js-drift rules
paths:
  - "**/app/routes/**/*.{ts,tsx}"
  - "**/app/routes.ts"
  - "**/app/components/**/*.{ts,tsx}"
  - "**/app/root.{ts,tsx}"
  - "**/app/entry.*.{ts,tsx}"
  - "**/react-router.config.{ts,js}"
---

# Taste Reference - React Router 7 (framework mode)

> Source: merged from SignalFinder taste.md, SignalFinder `.claude/docs/taste.md`, and SignalFinder `.claude/agents/react-router.md`.
> Apply when stack includes React Router 7. Read this file on every frontend or route task.
> When you need API details or version-specific behavior beyond these rules, use Context7 MCP: `resolve-library-id("react-router")` then `query-docs`. Do not rely on stale local docs.

## Core Rules (always)

1. **Data loading** — always use `loader` + `loaderData`, never `useEffect` + `fetch`.
2. **Mutations** — always use `<Form>` + `action`, never manual `fetch` in event handlers.
3. **In-place mutations** — use `useFetcher()` (toggles, likes, inline edits).
4. **Pending UI** — use `useNavigation().state` — never manage loading state manually.
5. **Redirects** — only from `loader` / `action` via `redirect()`, never `useNavigate()` in effects.
6. **Error handling** — export `ErrorBoundary` per route, `throw data(msg, { status })` from loaders.
7. **Auth protection** — check session in `loader`, redirect to `/auth/login` if not authed.
8. **Server-only code** — `.server.ts` files or inside `loader` / `action` only.
9. **Streaming** — `defer()` + `<Await>` + `<Suspense>` for non-critical data.
10. **Resource routes** — no `default` export = API endpoint, return `Response.json()`.

## Component conventions

- **Components are `const` arrow functions** with typed props. No `function` declarations. Exception: existing projects already using `function` stay consistent.
- **Thin routes** — `app/routes/**` are HTTP boundary only: auth, Zod parse, call a service, return response. Business logic in `app/server/services/*`. UI panels extracted to `app/components/<feature>/`.
- **Primitives in `app/components/ui/`**, feature components in `app/components/<feature>/`. shadcn/ui + Tailwind.

## Navigation & Prefetching

- **Always-visible nav** — `prefetch="viewport"` on sidebar / nav links (all data loaded before click).
- **Contextual links** — `prefetch="intent"` on inline links (prefetches on hover / focus).
- **Active state** — `<NavLink>` with `className` / `children` render props. Never `<Link>` + `useLocation()` (full parent re-render on every navigation).
- **Sidebar pattern** — `<SidebarMenuButton asChild>` + `<NavLink prefetch="viewport" className={({ isActive }) => ...}>`.

## Client-side caching (every data route)

Every data-fetching route gets a `clientLoader` that caches server loader data in a module-level variable. After SSR, subsequent client navigations serve from cache (instant).

```tsx
let cache: Awaited<ReturnType<typeof loader>> | null = null;

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  if (cache) return cache;
  const data = await serverLoader();
  cache = data;
  return data;
}
clientLoader.hydrate = true as const;

export function shouldRevalidate({
  formAction,
}: {
  formAction?: string | null;
}) {
  if (formAction) {
    cache = null;
    return true;
  }
  return false;
}
```

- **Auth-only routes** — `clientLoader` returns `null` directly, zero server round-trip.
- **URL-dependent routes** — use `Map<string, data>` keyed by search params for per-URL caching.
- **Layout `shouldRevalidate`** — only revalidate on form submissions (`!!formAction`), never on navigation.
- **Default behavior** — RR7 revalidates ALL active route loaders on every navigation. Always override `shouldRevalidate` for perf.

## Auth performance

- **`getSession()` not `getUser()` in loaders** — `getSession()` reads JWT from cookie (~1ms) vs `getUser()` network call (~200-400ms).
- **Cache `requireAuth` per-request** — `WeakMap<Request, Promise<AuthContext>>` so parallel loaders (layout + route) share one auth call.
- **Combine DB queries** — join profile + org in a single query instead of 2 sequential queries.

## Pending UI

- **Global progress bar** — `useNavigation()` in layout, show indicator when `state === "loading"`.
- **Optimistic UI** — use `fetcher.formData` to reflect changes before server response.

## SSR hydration safety

- No `Date.now()`, `new Date()`, `Math.random()` during render.
- De-dupe arrays before using as React keys.

## Type safety

Always use generated route types:

```tsx
import type { Route } from "./+types/my-route";

export async function loader({ request, params }: Route.LoaderArgs) {}
export async function action({ request }: Route.ActionArgs) {}
export default function MyRoute({
  loaderData,
  actionData,
}: Route.ComponentProps) {}
```

## Gotchas (stack-wide)

- **Explicit route registry.** React Router 7 uses `app/routes.ts` as an explicit registry. Every new route file MUST be registered there BEFORE `react-router typegen` will produce the corresponding `+types/` file. Missing registration causes TS2307 ("Cannot find module './+types/...'"). Fix: add the `route()` entry, then run `./node_modules/.bin/react-router typegen`. The generated `.react-router/` directory is gitignored — do not stage it.

- **Server-only files.** `.server.ts` files OR code inside `loader` / `action` only. Never import server-only modules from a client component — the build will still succeed but the bundle will leak server code.

- **All response paths from an action must carry the intent discriminator** when UI toast logic keys on `actionData.jobType` (or equivalent). Failure paths that omit the discriminator silently swallow errors:

  ```ts
  // BAD
  if (!eligible) return { success: false, error: "..." }; // toast never fires
  return { success: true, jobType: "re-enrich", runId };

  // GOOD
  if (!eligible) return { success: false, jobType: "re-enrich", error: "..." };
  return { success: true, jobType: "re-enrich", runId };
  ```

  Alternative: key toast logic on the SUBMITTED intent (`formData.get("intent")`) rather than `actionData.jobType`, avoiding the need to thread a discriminator through every return.

- **Multi-context actions need explicit context in the form.** When an action is triggered from a page already scoped to an entity (e.g., a campaign page submitting an investor action), the form MUST include that context as a hidden field. Do not rely on service-layer heuristics ("pick most recent X") when the user's intent is unambiguous:

  ```tsx
  <input type="hidden" name="campaignId" value={campaignId ?? ""} />
  // In action: const campaignId = formData.get("campaignId"); validate ownership before use.
  ```

- **`useFetcher` + `useEffect` toast pattern** for non-blocking actions:

  ```tsx
  const f = useFetcher();
  const isPending = f.state !== "idle";
  useEffect(() => {
    if (f.state === "idle" && f.data) toast({ title: f.data.message });
  }, [f.state, f.data]);
  ```

- **Testing actions/loaders** — see `stacks/vitest.md` for `CreateServerActionArgs` casts and `data()` / `redirect()` return shapes.

## UX & Accessibility

- **Clickable elements must show pointer cursor.** Every `<button>`, `<a>`, `role="button"`, or Tailwind-styled clickable `<div>` needs `cursor-pointer`. shadcn primitives (Button, DropdownMenuItem, SelectTrigger, etc.) must be verified — default shadcn Button does NOT include `cursor-pointer`. Add it in the primitive or via a wrapper. If the element looks clickable, the cursor must confirm it.
- **Keyboard accessible** — anything clickable is focusable and activates on Enter/Space.
- **Axe-core checks** — wire into Playwright E2E.

## Anti-Pattern Checklist (flag and replace)

| Found                                      | Replace with                                      |
| ------------------------------------------ | ------------------------------------------------- |
| `useEffect(() => fetch(...))`              | `loader` function                                 |
| `useState` + manual fetch                  | `loader` + `loaderData`                           |
| `onClick={() => fetch('/api/...')}`        | `<fetcher.Form>` or `<Form>`                      |
| `useNavigate()` for redirects              | `redirect()` from action / loader                 |
| `navigation.state` not used                | Add pending UI with `useNavigation()`             |
| Client-side data fetching                  | Move to server loader                             |
| `<Link>` without `prefetch`                | `prefetch="viewport"` or `prefetch="intent"`      |
| `useLocation()` for active styling         | `<NavLink>` with render prop                      |
| No `clientLoader` on data route            | Add clientLoader cache pattern                    |
| No `shouldRevalidate`                      | Add shouldRevalidate to prevent unnecessary runs  |
| `supabase.auth.getUser()` in loader        | `supabase.auth.getSession()` (cookie, no network) |
| Sequential auth DB queries                 | Single joined query (profile + org)               |
| Clickable element without `cursor-pointer` | Add `cursor-pointer` to the class list            |
| `function MyComponent()` in new code       | `const MyComponent = (props: Props) => ...`       |

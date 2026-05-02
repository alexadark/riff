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

> Apply when stack includes RR7. Read on every frontend or route task.
> API details / version-specific behavior beyond these rules: Context7 MCP `resolve-library-id("react-router")` then `query-docs`. Don't rely on stale local docs.

## Core Rules (always)

1. **Data loading** — `loader` + `loaderData`, never `useEffect` + `fetch`.
2. **Mutations** — `<Form>` + `action`, never manual `fetch` in handlers.
3. **In-place mutations** — `useFetcher()` (toggles, likes, inline edits).
4. **Pending UI** — `useNavigation().state`, never manual loading state.
5. **Redirects** — only from `loader` / `action` via `redirect()`, never `useNavigate()` in effects.
6. **Error handling** — export `ErrorBoundary` per route, `throw data(msg, { status })` from loaders.
7. **Auth protection** — check session in `loader`, redirect `/auth/login` if not authed.
8. **Server-only code** — `.server.ts` files OR inside `loader` / `action` only.
9. **Streaming** — `defer()` + `<Await>` + `<Suspense>` for non-critical data.
10. **Resource routes** — no `default` export = API endpoint, return `Response.json()`.

## Component conventions

- **Components are `const` arrow functions** with typed props. No `function` declarations. Exception: existing projects already using `function` stay consistent.
- **Thin routes** — `app/routes/**` = HTTP boundary only: auth, Zod parse, call service, return response. Business logic in `app/server/services/*`. UI panels in `app/components/<feature>/`.
- **Primitives in `app/components/ui/`**, feature components in `app/components/<feature>/`. shadcn/ui + Tailwind.

## Navigation & Prefetching

- **Always-visible nav** — `prefetch="viewport"` on sidebar / nav links (all data loaded before click).
- **Contextual links** — `prefetch="intent"` on inline links (prefetch on hover / focus).
- **Active state** — `<NavLink>` with `className` / `children` render props. Never `<Link>` + `useLocation()` (full parent re-render every nav).
- **Sidebar pattern** — `<SidebarMenuButton asChild>` + `<NavLink prefetch="viewport" className={({ isActive }) => ...}>`.

## Client-side caching (every data route)

Every data-fetching route gets `clientLoader` caching server loader data in module-level var. Post-SSR, subsequent client navs serve from cache (instant).

```tsx
let cache: Awaited<ReturnType<typeof loader>> | null = null;

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  if (cache) return cache;
  const data = await serverLoader();
  cache = data;
  return data;
}
clientLoader.hydrate = true as const;

export function shouldRevalidate({ formAction }: { formAction?: string | null }) {
  if (formAction) { cache = null; return true; }
  return false;
}
```

- **Auth-only routes** — `clientLoader` returns `null` directly, zero server round-trip.
- **URL-dependent routes** — `Map<string, data>` keyed by search params for per-URL caching.
- **Layout `shouldRevalidate`** — only on form submissions (`!!formAction`), never on nav.
- **Default behavior** — RR7 revalidates ALL active route loaders on every nav. Always override `shouldRevalidate` for perf.

## Auth performance

- **`getSession()` not `getUser()` in loaders** — `getSession()` reads JWT from cookie (~1ms) vs `getUser()` network call (~200-400ms).
- **Cache `requireAuth` per-request** — `WeakMap<Request, Promise<AuthContext>>` so parallel loaders (layout + route) share one auth call.
- **Combine DB queries** — join profile + org in single query, not 2 sequential.

## Pending UI

- **Global progress bar** — `useNavigation()` in layout, indicator when `state === "loading"`.
- **Optimistic UI** — `fetcher.formData` reflects changes before server response.

## Type safety

Always use generated route types:

```tsx
import type { Route } from "./+types/my-route";

export async function loader({ request, params }: Route.LoaderArgs) {}
export async function action({ request }: Route.ActionArgs) {}
export default function MyRoute({ loaderData, actionData }: Route.ComponentProps) {}
```

## Gotchas (stack-wide)

- **Explicit route registry.** RR7 uses `app/routes.ts` as explicit registry. Every new route file MUST be registered BEFORE `react-router typegen` produces `+types/`. Missing registration → TS2307 ("Cannot find module './+types/...'"). Fix: add `route()` entry, then `./node_modules/.bin/react-router typegen`. Generated `.react-router/` is gitignored — don't stage it.

- **Server-only files.** `.server.ts` files OR code inside `loader` / `action` only. Importing server-only modules from client component → build succeeds but bundle leaks server code.

- **All response paths from action must carry intent discriminator** when UI toast logic keys on `actionData.jobType`. Failure paths omitting discriminator silently swallow errors:

  ```ts
  // BAD
  if (!eligible) return { success: false, error: "..." }; // toast never fires
  return { success: true, jobType: "re-enrich", runId };

  // GOOD
  if (!eligible) return { success: false, jobType: "re-enrich", error: "..." };
  return { success: true, jobType: "re-enrich", runId };
  ```

  Alternative: key toast logic on SUBMITTED intent (`formData.get("intent")`), avoiding threading discriminator through every return.

- **Multi-context actions need explicit context in form.** Action triggered from page already scoped to entity (campaign page submitting investor action) → form MUST include context as hidden field. Don't rely on service-layer heuristics ("pick most recent X") when intent is unambiguous:

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

- **Action `try/catch` MUST re-throw `Response` and `data()` shapes.** Helper does `throw data({ ... }, { status: 403 })` or `throw redirect(...)` → action `try/catch` handling only `Error` swallows it, 403/404 → `200 { success: false }`. Browser sees success, security helper no-ops. Re-throw both:

  ```ts
  } catch (err) {
    if (err instanceof Response) throw err;
    if (typeof err === "object" && err !== null && "data" in err && "init" in err) throw err;
    return { success: false, error: err instanceof Error ? err.message : "Unknown error" };
  }
  ```

- **Testing actions/loaders** — see `stacks/vitest.md` for `CreateServerActionArgs` casts and `data()` / `redirect()` return shapes.

## UX & Accessibility

- **Clickable elements need pointer cursor.** Every `<button>`, `<a>`, `role="button"`, or Tailwind-styled clickable `<div>` needs `cursor-pointer`. shadcn primitives (Button, DropdownMenuItem, SelectTrigger, etc.) verify — default shadcn Button does NOT include `cursor-pointer`. Add in primitive or via wrapper. Looks clickable → cursor confirms it.

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
| Clickable element without `cursor-pointer` | Add `cursor-pointer` to class list                |
| `function MyComponent()` in new code       | `const MyComponent = (props: Props) => ...`       |
| Action `try/catch` without Response/data re-throw | Re-throw `Response` and `{ data, init }` shapes before `Error` branch |

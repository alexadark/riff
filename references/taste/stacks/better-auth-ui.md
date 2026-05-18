---
description: Better Auth UI gotchas (basePaths override, requireEmailVerification wiring, lib internal nav)
paths:
  - "**/app/components/auth/**/*.{ts,tsx}"
  - "**/app/components/providers.tsx"
  - "**/app/routes/sign-in.tsx"
  - "**/app/routes/sign-up.tsx"
  - "**/app/routes/forgot-password.tsx"
  - "**/app/routes/reset-password.tsx"
  - "**/app/routes/verify-email.tsx"
  - "**/app/routes/auth/**/*.{ts,tsx}"
---

# Taste Reference - @better-auth-ui/react

> Apply when stack includes `@better-auth-ui/react`. Read on any auth UI change.
> API details beyond these rules: Context7 MCP `resolve-library-id("@better-auth-ui/react")` then `query-docs`, or `references/better-auth-ui/examples/start-shadcn-example/` if cloned locally.

## Core Rules

1. **`basePaths.auth = ""` for top-level routes.** The lib's components emit internal Links and redirects as `${basePaths.auth}/${viewPaths.auth.X}` (default `/auth/sign-in`, `/auth/sign-up`, …). If your routes live at `/sign-in`, `/sign-up` instead of under `/auth/*`, override on `AuthProvider`: `basePaths={{ auth: "", settings: "/settings", organization: "/organization" }}`. Empty string deep-merges correctly: `"" + "/" + "sign-in"` = `/sign-in` (no double slash). Route-level overrides don't propagate — the override MUST live on the provider.

2. **`emailAndPassword.requireEmailVerification` MUST mirror server.** The lib's `<SignUp />` reads `emailAndPassword?.requireEmailVerification` from auth context to decide whether to redirect to `/sign-in` (verify-email toast) or to `redirectTo` (direct app access) on signup success. If your Convex/Better Auth server sets `requireEmailVerification: true` but the client provider does not, unverified users land in the app and bypass the verification gate. Pass `emailAndPassword={{ requireEmailVerification: true }}` to mirror. Other email/password options (`minPasswordLength`, `rememberMe`, `forgotPassword`) keep library defaults via `DeepPartial<AuthConfig>` merge.

3. **The mismatch in rule 2 is invisible to static analysis and unit tests.** Logic lives inside the lib's `onSuccess` callback, fires only against a real Better Auth endpoint. Catch it in Playwright with `pnpm dev` running, or it ships to prod.

4. **Provider order: Convex outside, UI provider inside.** If you use Convex via `@convex-dev/better-auth`, `<ConvexBetterAuthProvider>` wraps `<AuthProvider>` (UI). The lib's hooks call into `authClient`, which talks to Convex — Convex client must be mounted first.

5. **Lib has no `VerifyEmail` view.** `AUTH_VIEWS` in `@better-auth-ui/react/components/auth.tsx` covers `signIn / signOut / signUp / forgotPassword / resetPassword`. Email verification is your custom route. Call `authClient.verifyEmail({ query: { token } })` (Better Auth's typed-GET signature — `query: { token }`, NOT bare `{ token }`). Use `validateSearch` on the route with `z.object({ token: z.string().min(1) })`. Use the lib's `Card`/`CardHeader`/`CardContent` primitives for visual consistency.

6. **`<ResetPassword />` reads `window.location.search` directly.** Even when the route has `validateSearch`, the lib re-reads the token client-side. Real protection lives at the server (Better Auth validates on submit). Either accept this redundancy or refactor to thread the validated token in as a prop.

## Provider wiring pattern

```tsx
// app/components/providers.tsx
import { Link, useNavigate } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { AuthProvider } from '@/components/auth/auth-provider';
import { authClient } from '@/lib/auth-client';

export const Providers = ({ children }: { children: ReactNode }) => {
  const navigate = useNavigate();
  return (
    <AuthProvider
      authClient={authClient}
      basePaths={{ auth: '', settings: '/settings', organization: '/organization' }}
      emailAndPassword={{ requireEmailVerification: true }}
      redirectTo="/"
      navigate={navigate}
      Link={Link}
    >
      {children}
      <Toaster />
    </AuthProvider>
  );
};
```

## Anti-Pattern Checklist (flag and replace)

| Found                                                   | Replace with                                          |
| ------------------------------------------------------- | ----------------------------------------------------- |
| Default `basePaths` with non-`/auth` routes             | `basePaths={{ auth: '' }}` (or whatever prefix you use) |
| Missing `emailAndPassword.requireEmailVerification`     | Pass it explicitly to mirror server config            |
| `authClient.verifyEmail({ token })`                     | `authClient.verifyEmail({ query: { token } })`        |
| No `validateSearch` on `/verify-email` or `/reset-password` | Add `validateSearch: z.object({ token: z.string().min(1) })` |
| `ConvexBetterAuthProvider` inside `<AuthProvider>`      | Swap: Convex outside, AuthProvider inside             |
| Building custom auth forms when the lib ships them      | Use `<SignIn />` / `<SignUp />` / `<ForgotPassword />` / `<ResetPassword />` thin wrappers |

last_audited: 2026-05-28
---
description: Vitest gotchas (mock hoisting, module reset, RR7 action/loader testing, Trigger.dev mocks, env stubbing)
paths:
  - "**/*.test.{ts,tsx}"
  - "**/*.spec.{ts,tsx}"
  - "**/vitest.config.{ts,js}"
  - "**/__tests__/**/*.{ts,tsx}"
  - "**/test/**/*.{ts,tsx}"
---

# Taste Reference - Vitest

> Apply when stack includes Vitest. Read on any test authoring task.
> API details beyond these rules: Context7 MCP `resolve-library-id("vitest")` then `query-docs`.

## Core Rules

1. **`vi.mock()` factories hoist above imports.** NEVER reference top-level `const` inside `vi.mock()` factory — not initialized when hoisted factory runs. Define entire mock chain inside factory. Per-test configurable mock → attach as named property on returned object:

   ```ts
   vi.mock("~/lib/db", () => {
     const terminalMock = vi.fn();
     return {
       db: { select: () => ({ from: () => ({ where: terminalMock }) }),
             __terminal: terminalMock },
     };
   });

   // In test:
   const db = (await import("~/lib/db")) as unknown as { __terminal: ReturnType<typeof vi.fn> };
   db.__terminal.mockResolvedValue([...]);
   ```

2. **`vi.resetModules()` + dynamic import in `beforeEach` for adapter tests.** Each test gets fresh module with isolated mocked deps:

   ```ts
   beforeEach(async () => {
     vi.resetModules();
     const mod = await import("../adapter");
     // mod reflects per-test mock setup
   });
   ```

3. **Vitest 4.x silently produces no coverage output when any test fails.** Set `reportOnFailure: true` in coverage config when CI needs artifacts regardless of green status.

4. **Proxy-based DB mock for orchestrators with many sequential calls.** Code with 10+ chained DB queries → Proxy popping results from indexed array beats per-query `setResult`:

   ```ts
   const results: unknown[] = [...];
   let idx = 0;
   const dbProxy: any = new Proxy(() => dbProxy, {
     get: (_, prop) => prop === "then" ? undefined : dbProxy,
     apply: () => ({ then: (cb: any) => cb(results[idx++]) }),
   });
   ```

5. **Trigger.dev task capture pattern.** Mock `@trigger.dev/sdk/v3` so `task(config)` stores `config.run` in module-level var, then `await import()` source module in `beforeAll`. Tests call orchestrator's run function directly, no Trigger.dev runtime.

6. **Basic `vi.mock("@trigger.dev/sdk/v3")` does NOT include `schedules`.** Imported job uses `schedules.task(...)` → add `schedules: { task: vi.fn(...) }` to mock or barrel imports fail. Avoid importing `~/jobs/index` in tests; mock individual jobs.

7. **`vi.stubEnv` fragile across test reloads.** Mock the config module reading the env var (`vi.mock("~/lib/server/config")`) over stubbing `process.env` directly.

8. **RR7 test integration.** `CreateServerActionArgs` requires `params`, `unstable_pattern`, `context`. Testing imported `action`/`loader` with simplified signature → cast: `action as unknown as (args: { request: Request }) => Promise<unknown>`.

9. **RR7 `data()` vs `redirect()` return shapes.** `data()` → `DataWithResponseInit`, extract `.data` and `.init?.status` for assertions. `redirect()` → native `Response` with status 302. Test `return redirect()` vs `throw redirect()` accordingly.

10. **http-client retry testing — avoid 429/500 for non-retry assertions.** Use 401 (FatalError, no retry) to validate error propagation without 60s retry delays. Test actual retry behavior in http-client unit tests, not adapter tests.

11. **`include` glob is explicit, not "wildcard all".** Default `vitest.config.ts` typically scopes to one root (e.g. `app/**/*.test.{ts,tsx}`). Test files outside that root — `scripts/`, `packages/*/`, `lib/`, `tools/` — are silently ignored. The suite passes green while those tests never run. When adding tests outside the configured root, extend `include` explicitly:

    ```ts
    test: {
      include: ["app/**/*.test.{ts,tsx}", "scripts/**/*.test.{ts,tsx}"],
    }
    ```

    Audit by running `vitest list` after config changes — it prints the discovered set so orphans are visible. Especially important for seed scripts, migration helpers, and one-off CLI utilities that ship with their own tests.

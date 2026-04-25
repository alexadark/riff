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

> Apply when stack includes Vitest. Read this file on any test authoring task.
> When you need API details beyond these rules, use Context7 MCP: `resolve-library-id("vitest")` then `query-docs`.

## Core Rules

1. **`vi.mock()` factories are hoisted above imports.** NEVER reference top-level `const` variables inside a `vi.mock()` factory — they are not initialized when the hoisted factory runs. Define the entire mock chain inside the factory. To expose a per-test configurable mock, attach it as a named property on the returned object:

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

2. **`vi.resetModules()` + dynamic import in `beforeEach` for adapter tests.** Gives each test a fresh module with isolated mocked dependencies:

   ```ts
   beforeEach(async () => {
     vi.resetModules();
     const mod = await import("../adapter");
     // mod now reflects per-test mock setup
   });
   ```

3. **Vitest 4.x silently produces no coverage output when any test fails.** Set `reportOnFailure: true` in the coverage config when CI needs artifacts regardless of green status.

4. **Proxy-based DB mock for orchestrators with many sequential calls.** For code with 10+ chained DB queries, a Proxy that pops results from an indexed array is more flexible than per-query `setResult`:

   ```ts
   const results: unknown[] = [...];
   let idx = 0;
   const dbProxy: any = new Proxy(() => dbProxy, {
     get: (_, prop) => prop === "then" ? undefined : dbProxy,
     apply: () => ({ then: (cb: any) => cb(results[idx++]) }),
   });
   ```

5. **Trigger.dev task capture pattern.** Mock `@trigger.dev/sdk/v3` so `task(config)` stores `config.run` in a module-level variable, then `await import()` the source module in `beforeAll`. Tests call the orchestrator's run function directly without the Trigger.dev runtime.

6. **Basic `vi.mock("@trigger.dev/sdk/v3")` does NOT include `schedules`.** If any imported job uses `schedules.task(...)`, add `schedules: { task: vi.fn(...) }` to the mock or barrel imports will fail. Avoid importing `~/jobs/index` in tests; mock individual jobs instead.

7. **`vi.stubEnv` is fragile across test reloads.** Prefer mocking the config module that reads the env var (e.g. `vi.mock("~/lib/server/config")`) over stubbing `process.env` directly.

8. **Test framework integration with React Router 7.** `CreateServerActionArgs` requires `params`, `unstable_pattern`, `context`. When testing imported `action` / `loader` with a simplified signature, cast: `action as unknown as (args: { request: Request }) => Promise<unknown>`.

9. **React Router `data()` vs `redirect()` return shapes.** `data()` returns `DataWithResponseInit` — extract `.data` and `.init?.status` for assertions. `redirect()` returns a native `Response` with status 302 — test `return redirect()` vs `throw redirect()` accordingly.

10. **http-client retry testing — avoid 429/500 for non-retry assertions.** Use 401 (FatalError, no retry) to validate error propagation without triggering 60s retry delays. Test actual retry behavior in http-client unit tests, not adapter tests.

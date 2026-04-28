# Taste Reference - Architecture

> These rules apply to ALL tasks regardless of layer.

## Rules

1. **Tracer bullets first** - New features and new integrations start with a minimal end-to-end flow touching 2+ layers (adapter + service, API + UI, schema + route). Bug fixes and small changes don't need a tracer bullet.

2. **Deep modules** - A module's interface must be simpler than its implementation. If the function signature is nearly as complex as the body, the abstraction is wrong. A service with 3 public methods hiding 500 lines of logic is better than 20 tiny exported helpers.

3. **Source of truth** - Types in `app/lib/db/schema.ts` (Drizzle = single schema source). Provider interfaces in `app/server/providers/types.ts`. No ad-hoc inline types for things that already have a definition.

4. **YAGNI** - Specify what you DON'T want. No generic "extensibility" unless the PRD asks for it. No abstraction for a single use case. Three similar lines are better than a premature helper.

5. **Strategic over tactical** - Every 5th phase, run `/audit-codebase` or `/simplify` to fight entropy. The agent is tactical by default - you are the strategic thinker.

6. **Define errors out of existence** - Redesign interfaces so error cases are impossible. Branded types (`UserId`, `CampaignId`, `ProviderId`) give type-level guarantees over runtime validation. If you're writing lots of defensive checks, the interface is wrong.

7. **Orthogonality as metric** - If a change touches loader + component + util simultaneously, the modules are not orthogonal enough. Each change should affect one layer. Orthogonal modules let agents work on one file without breaking others.

8. **Four rules of simple design** - Code must: (1) pass all tests, (2) reveal intention, (3) have zero duplication, (4) have minimum elements. Use as acceptance criteria for agent-generated code.

9. **Design It Twice for critical interfaces** - Before implementing a new port, adapter interface, or public API, produce 2-3 competing designs with different trade-offs. Never go with the first design for interfaces that will be hard to change.

10. **Per-tenant allowlist table for shared external resources** - When multiple tenants share a pool of external resources (third-party connectors, integration accounts, OAuth apps), gate access via a join table `(organization_id, resource_id)` with a UNIQUE constraint on the pair, not via env vars or hardcoded constants. Read paths filter via `getAuthorized*Ids(orgId)`, write paths gate via `is*Authorized(orgId, id)`, listings filter the upstream response with a system-admin bypass for support. Carries `created_at` for audit, revokable with a DELETE, and seeds backfill cleanly from existing state.

11. **Business-rule gate at the service layer, not the route.** When a constraint must hold for ALL entry points (route action, background job, future webhook), put the assertion in the service that triggers the irreversible side effect, not in the route. Route gates remain useful for UX (disable the button, friendly toast) but cannot be the authoritative enforcement — the next caller will forget. Pattern: a small dedicated file with a typed predicate (`isXxx(entity): boolean` for read/UI paths) plus a throwing assertion (`assertXxx(entity): void` for write paths) plus a named error class with a `code` field.

12. **Post-action upstream verification for irreversible external operations.** A 200 OK from a third-party API does not prove the desired state exists upstream (eventual consistency, silent partial failure, vendor edge cases). After irreversible mutations, re-read the upstream resource and confirm the expected state. On verification failure, record the row as `skipped[]` with a clear reason — never as `created[]`. Local state must mirror "what we can prove exists upstream right now", never "what the upstream API claimed".

## Architecture Red Flags

Watch for these in agent-generated code:

1. **Shallow module** - A wrapper that just passes through to another function with the same signature
2. **Pass-through method** - A function that delegates to another with no added logic
3. **Conjoined methods** - Two methods that always get called together (should be one)
4. **Overexposure** - Service exports 15 functions when consumers only use 3
5. **Temporal coupling** - Code that only works if called in a specific order without enforcing it
6. **Temporal decomposition** - Code organized by execution order instead of responsibility (e.g., "step1-validate.ts", "step2-transform.ts"). Organize by domain concept instead.
7. **Missing barrel** - A directory with 5+ files but no `index.ts` curating the public API
8. **Friction blindness** - When reading agent-generated code, friction IS the signal. Don't dismiss it as unfamiliarity - investigate it.

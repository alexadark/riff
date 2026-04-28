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

10. **Per-tenant allowlist table for shared external resources.** Multiple tenants share resource pool (3rd-party connectors, OAuth apps, integration accounts) → gate via join table `(org_id, resource_id)` UNIQUE, not env vars / constants. Read paths: filter via `getAuthorized*Ids(orgId)`. Write paths: gate via `is*Authorized(orgId, id)`. Listings: filter upstream + system-admin bypass for support. `created_at` for audit, revoke = DELETE, backfill seeds from existing state.

11. **Business-rule gate at service layer, not route.** Constraint must hold for ALL entry points (action, job, webhook) → assertion in service triggering side effect, not route. Route gates = UX (disable button, toast), not authoritative — next caller forgets. Pattern: small file with typed predicate `isXxx(entity): boolean` (read/UI) + throwing `assertXxx(entity): void` (write) + named error class with `code` field.

12. **Post-action upstream verification for irreversible external ops.** 3rd-party 200 OK does NOT prove desired upstream state (eventual consistency, silent partial fail, vendor edge cases). Post-mutation: re-read upstream, confirm expected state. Verify fail → `skipped[]` with reason, NEVER `created[]`. Local state mirrors "provable upstream now", not "API claimed".

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

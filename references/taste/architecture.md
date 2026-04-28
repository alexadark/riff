# Taste Reference - Architecture

> Apply to ALL tasks regardless of layer.

## Rules

1. **Tracer bullets first.** New features + integrations start with minimal end-to-end flow touching 2+ layers (adapter + service, API + UI, schema + route). Bug fixes + small changes skip tracer.

2. **Deep modules.** Module interface simpler than implementation. Function signature ≈ body complexity → abstraction wrong. Service with 3 public methods hiding 500 lines beats 20 tiny exported helpers.

3. **Source of truth.** Types in `app/lib/db/schema.ts` (Drizzle = single schema source). Provider interfaces in `app/server/providers/types.ts`. No ad-hoc inline types for things already defined.

4. **YAGNI.** Specify what you DON'T want. No generic "extensibility" unless PRD asks. No abstraction for single use case. 3 similar lines beat premature helper.

5. **Strategic over tactical.** Every 5th phase: run `/audit-codebase` or `/simplify` to fight entropy. Agent is tactical by default — you are strategic.

6. **Define errors out of existence.** Redesign interfaces so error cases impossible. Branded types (`UserId`, `CampaignId`, `ProviderId`) give type-level guarantees over runtime validation. Lots of defensive checks → interface wrong.

7. **Orthogonality as metric.** Change touches loader + component + util simultaneously → modules not orthogonal enough. Each change affects one layer. Orthogonal modules = agents work on one file without breaking others.

8. **4 rules of simple design.** Code must: (1) pass all tests, (2) reveal intention, (3) zero duplication, (4) minimum elements. Use as acceptance criteria for agent-generated code.

9. **Design It Twice for critical interfaces.** New port, adapter interface, public API → 2-3 competing designs with different trade-offs before implementing. Never first design for hard-to-change interfaces.

10. **Per-tenant allowlist table for shared external resources.** Multiple tenants share resource pool (3rd-party connectors, OAuth apps, integration accounts) → gate via join table `(org_id, resource_id)` UNIQUE, not env vars / constants. Read paths: filter via `getAuthorized*Ids(orgId)`. Write paths: gate via `is*Authorized(orgId, id)`. Listings: filter upstream + system-admin bypass for support. `created_at` for audit, revoke = DELETE, backfill seeds from existing state.

11. **Business-rule gate at service layer, not route.** Constraint must hold for ALL entry points (action, job, webhook) → assertion in service triggering side effect, not route. Route gates = UX (disable button, toast), not authoritative — next caller forgets. Pattern: small file with typed predicate `isXxx(entity): boolean` (read/UI) + throwing `assertXxx(entity): void` (write) + named error class with `code` field.

12. **Post-action upstream verification for irreversible external ops.** 3rd-party 200 OK does NOT prove desired upstream state (eventual consistency, silent partial fail, vendor edge cases). Post-mutation: re-read upstream, confirm expected state. Verify fail → `skipped[]` with reason, NEVER `created[]`. Local state mirrors "provable upstream now", not "API claimed".

## Architecture Red Flags

Watch in agent-generated code:

1. **Shallow module** — wrapper passing through to function with same signature.
2. **Pass-through method** — delegates to another with no added logic.
3. **Conjoined methods** — 2 methods always called together (should be 1).
4. **Overexposure** — service exports 15 functions, consumers use 3.
5. **Temporal coupling** — code only works if called in specific order without enforcing it.
6. **Temporal decomposition** — code organized by execution order (`step1-validate.ts`, `step2-transform.ts`) instead of responsibility. Organize by domain concept.
7. **Missing barrel** — directory with 5+ files, no `index.ts` curating public API.
8. **Friction blindness** — friction reading agent code IS the signal. Don't dismiss as unfamiliarity, investigate.

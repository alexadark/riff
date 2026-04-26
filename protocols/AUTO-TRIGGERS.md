# Auto-Trigger Heuristics

Path patterns, tag matches, and string searches that drive `auto` gate decisions in `commands/next.md`. Each gate's behavior is defined here; `next.md` references this file by anchor.

Design rationale → [`DECISIONS.md`](../DECISIONS.md) (D25, D26, D27).

---

## Simplifier auto <a id="simplifier-auto"></a>

**Used by:** Step 5b of `/riff:next` when `simplify: auto` (default).

**Run condition:** the phase name or any tag in ROADMAP.yaml contains one of:

- `refactor`
- `consolidation`
- `cleanup`
- `simplify`
- `sweep`
- `thinning`
- `dedup`

**Skip otherwise.** New-feature phases skip even when ≥3 files changed. To force the simplifier on a non-refactor phase, set `simplify: true` explicitly in ROADMAP.yaml.

---

## Plan adversarial auto <a id="plan-adversarial-auto"></a>

**Used by:** Step 4b of `/riff:next` when `plan_adversarial: auto` (default).

Triggers read from PLAN.md and the phase's ROADMAP.yaml entry (no diff exists yet).

**Run condition (any is sufficient):**

- `priority: P0` AND any tag in `architecture` / `novel` / `security_critical`
- Phase touches any of — auth, SSO/OAuth, payments, crypto/HMAC/tokens, RLS/multi-tenancy, irreversible migration, public API breaking change, threat model
- Phase tags include `adversarial-plan`
- PLAN.md introduces a new architectural pattern (first use of: queue, multi-step transaction, webhook handler, background job, cross-service contract)
- PLAN.md has 4+ tasks across 3+ waves (high-coordination plan, more room for ordering errors)

**Skip otherwise.** Pure UI, refactor, docs, P2 phases skip.

---

## Adversarial auto <a id="adversarial-auto"></a>

**Used by:** Step 6 of `/riff:next` when `adversarial: auto` (default).

**Run condition (domain):** the phase touches any of — auth, secrets, HMAC/crypto/tokens, RLS/multi-tenancy, payments, webhooks/callbacks, public routes, DB migrations — OR `priority: critical`.

**Run condition (path heuristics):** grep the diff file list for any match:

- `app/lib/server/auth*`
- `app/lib/server/env.ts`
- `app/server/services/*-push.ts`
- `app/routes/api.webhooks.*`
- `app/routes/api.*-callback.*`
- any public route (no `requireAuth`)
- any `drizzle/*.sql`
- any schema file introducing new PII fields

**Skip otherwise.** Pure UI, docs, refactor, low-priority feature phases skip.

---

## Improver heuristic <a id="improver-heuristic"></a>

**Used by:** Step 7b of `/riff:next`.

**Run condition (either is sufficient):**

- ROADMAP.yaml entry has `improver: true` (explicit opt-in)
- SUMMARY.md contains any of the strings: `"new pattern"`, `"first use of"`, `"novel"` (executor flagged something worth extracting)

**Skip otherwise.** Default mode: skip per-phase, batch via `/riff:improver` every ~3 phases.

# Auto-Trigger Heuristics

Path patterns, tag matches, and string searches that drive `auto` gate decisions in `commands/next.md`. Each gate's behavior is defined here; `next.md` references this file by anchor.

Design rationale → [`DECISIONS.md`](../DECISIONS.md) (D25, D26, D27).

**Priority vocabulary.** Accepted values for `priority:` in ROADMAP.yaml entries are `P0` | `P1` | `P2` | `P3` | `critical` | `high` | `medium` | `low`. Numeric aliases: P0↔critical, P1↔high, P2↔medium, P3↔low. High-stakes = {P0, P1, critical, high} — these trigger heavier auto-gates (plan adversarial, Step 6 Codex). Routine = {P2, P3, medium, low}.

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

- ROADMAP entry has `priority` in {`P0`, `P1`, `critical`, `high`} AND any tag in `architecture` / `novel` / `security_critical`
- Phase touches any of — auth, SSO/OAuth, payments, crypto/HMAC/tokens, RLS/multi-tenancy, irreversible migration, public API breaking change, threat model
- Phase tags include `adversarial-plan`
- PLAN.md introduces a new architectural pattern. Markers: `first use of`, `introduces a new`, `first time`, `novel pattern`, `new architecture`, `new integration with`, `new external service`. Typical triggers: queue, multi-step transaction, webhook handler, background job, cross-service contract.
- PLAN.md has 4+ tasks across 3+ waves (high-coordination plan, more room for ordering errors)

**Skip otherwise.** Pure UI, refactor, docs, P2 phases skip.

**Skip overrides (apply even if a run condition fires).** Skip Codex when ANY of:

- PLAN.md task list has fewer than 3 tasks
- Phase `tags` list contains `trivial` or `bug_fix` in ROADMAP.yaml (boolean fields `trivial: true` / `bug_fix: true` are accepted as legacy aliases)
- PLAN.md is shorter than 50 lines

Skip decision is logged to `.planning/phases/N-slug/GATES.md` (one line: `Step 4b: skipped — <reason>`).

---

## Architecture adversarial auto <a id="architecture-adversarial-auto"></a>

**Used by:** Stage 2.5 of `/riff:start` when `arch_adversarial: auto` (default).

Triggers read from PROJECT.md (project type) and `.planning/design/architecture.md` (only run if it exists — CLI/skill/content/automation projects don't produce one).

**Run condition (any is sufficient):**

- Project type is `saas`, `web-app`, or `api`
- Architecture diagram has 4+ components OR 2+ external services
- Architecture mentions any of — auth, SSO/OAuth, payments, multi-tenancy, webhooks, background jobs, queues, public API
- PROJECT.md constraints include `security_critical`, `multi-tenant`, or `public`

**Skip otherwise.** Pure CLI, skill, single-script automation, or content-only projects skip (typically no architecture.md to review anyway).

---

## Roadmap adversarial auto <a id="roadmap-adversarial-auto"></a>

**Used by:** Stage 4.5 of `/riff:start` when `roadmap_adversarial: auto` (default).

Triggers read from `ROADMAP.yaml` and PROJECT.md.

**Run condition (any is sufficient):**

- ROADMAP.yaml has 3+ phases (under 3, the roadmap is too small to mis-order)
- Any phase tag includes `architecture` / `security_critical` / `migration` / `payment` / `auth`
- Any phase mode is `HITL`
- ROADMAP.yaml top-level `budget_quality: max`

**Skip otherwise.** 1- or 2-phase roadmaps skip — the cost-benefit doesn't favor a Codex round trip on a tracer-bullet-plus-one shape.

---

## Adversarial auto <a id="adversarial-auto"></a>

**Used by:** Step 6 of `/riff:next` when `adversarial: auto` (default).

**Run condition (domain):** the phase touches any of — auth, secrets, HMAC/crypto/tokens, RLS/multi-tenancy, payments, webhooks/callbacks, public routes, DB migrations — OR `priority` in {`P0`, `P1`, `critical`, `high`}.

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

**Skip overrides (apply even if a run condition fires).** Skip Codex when EITHER:

- ALL of: diff is fewer than 100 lines AND no diff path matches `*auth*|*api*|*payment*|*security*` AND phase `tags` does not contain `security_critical` AND `security_critical: true` boolean field is not set
- OR: phase `tags` contains `bug_fix` (or legacy `bug_fix: true`) AND tests pass AND diff is fewer than 50 lines

Skip decision is logged to `.planning/phases/N-slug/GATES.md` (one line: `Step 6: skipped — <reason>`).

---

## Improver heuristic <a id="improver-heuristic"></a>

**Used by:** Step 7b of `/riff:next`.

**Run condition (any is sufficient):**

- ROADMAP.yaml entry has `improver: true` (explicit opt-in by planner or user — see `agents/planner.md` § Improver opt-in)
- A debug session fired during this phase: either `.planning/phases/N-slug/DEBUG.md` exists, or any `.planning/debug/*.md` was created/modified after the phase's PLAN.md timestamp
- The adversarial review went through at least one revision cycle: `.planning/phases/N-slug/REVIEW.md` contains either a `## Cycle 2` section or a heading matching `Cycle 1 — FAIL` (executor + reviewer round-tripped)
- Every 3rd completed phase, counted ordinally from the phase history (`ls .planning/phases | wc -l` modulo 3 == 0) — gentle baseline cadence
- SUMMARY.md contains any of: `"new pattern"`, `"first use of"`, `"novel"`, `"surprised"`, `"unexpected"`, `"discovered"`, `"learned that"`, `"had to retry"`, `"deviated"` (executor or reviewer flagged something worth extracting)
- `budget_quality: max` (resolved) → bias toward running: when no other condition fires, still run on every 2nd completed phase (`ls .planning/phases | wc -l` modulo 2 == 0)

**Skip otherwise.** Even with the broader heuristic, you can always batch on demand with `/riff:improver [N]`.

Skip decision is logged to `.planning/phases/N-slug/GATES.md` (one line: `Step 7b: skipped — <reason>`). If multiple run conditions fire, log the first one matched.

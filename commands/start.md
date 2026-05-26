---
description: Discovery pipeline - define the product before building it
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, Agent
model: opus
---

# /riff:start

5-stage discovery pipeline. Complete each stage before the next. All choice points use AskUserQuestion.

**Think harder** throughout. Discovery decisions lock in the entire project trajectory.

**Interactive question phrasing:** every `AskUserQuestion` in this command (brownfield audit prompt, scope gate, PROJECT.md confirm loop, design module picker, feature-scoping v1/Later/OOS loop, starter-clone confirm, etc.) follows the resolved `explanation_level`. See [`references/EXPLANATION-LEVEL.md`](../references/EXPLANATION-LEVEL.md) § Interactive questions.

## Prerequisites

- RIFF installed (`/riff:init`), git repo exists
- Optional: `.research/*.md` files enrich PROJECT.md if present

---

## Stage 0: Brownfield / Starter / Greenfield Detection

Distinguish three states based on existing code + git history:

- **Greenfield**: no substantial code. Skip to Stage 1.
- **Starter**: existing code present but fresh git history (≤2 commits). A template or scaffold was dropped here. Ask the user before assuming.
- **Brownfield**: existing code with meaningful git history (≥3 commits). True adoption. Offer the audit-codebase baseline.

**Detection:** run a quick heuristic via Bash:

```bash
COMMITS=$(git log --oneline 2>/dev/null | wc -l | tr -d ' ')
SRC_FILES=$(find src app lib 2>/dev/null -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) 2>/dev/null | wc -l | tr -d ' ')
if [ "$SRC_FILES" -gt 5 ]; then
  if [ "$COMMITS" -ge 3 ]; then echo "brownfield"; else echo "starter"; fi
else
  echo "greenfield"
fi
```

**Greenfield (no substantial code):** skip Stage 0, jump to Stage 1.

**Starter (code present, fresh git history):** AskUserQuestion:

> "I see existing code here (~N source files) but git history is fresh. Is this a starter template you want to use as the project base?"
>
> - **Yes, use as starter (recommended)** — record `stack_source: starter-local` in `.planning/config.json`. Stage 1 will infer the stack from `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` and confirm with you instead of asking from scratch.
> - **No, start fresh** — flag that pre-existing files may need cleanup. Continue to Stage 1 as greenfield, ignore the existing code for discovery purposes.

**Skip if scope is clearly `scratch`** (e.g., pre-existing `.planning/config.json` with `scope: scratch`, or user explicitly declares this is a personal/local script). Brownfield audit on scratch rarely repays the time.

**Brownfield (existing code, production-bound):** AskUserQuestion:

> "Existing codebase detected (~N source files, M commits). Run `audit-codebase` for a baseline (AI-readiness + bug score) before discovery? Free, ~5-15 min, gives a measurable starting point to track improvement as RIFF phases ship."
>
> - **Run now (recommended)** — invoke skill `audit-codebase` mode `full`, surface results
> - **Defer** — note in PROJECT.md that baseline audit is pending, continue to Stage 1
> - **Skip** — continue to Stage 1 without baseline

If **Run now**: invoke skill `audit-codebase` mode `full`. After completion, surface AI-readiness score + Assay TLDR. Findings feed Stage 1 questioning: known critical bugs become constraints to address, weak module boundaries inform architecture design, low-coverage domains highlight what `taste.md` should harden.

Then continue to Stage 1.

---

## Stage 1: Deep Questioning

Open with: **"What do you want to build?"** Then follow the thread.

**Style:** Follow energy, challenge vagueness, make abstract concrete, surface assumptions, find edges, reveal motivation. Do NOT walk through axes as a checklist.

**9 Extraction Axes** (weave naturally): End Goal, Core Problem, User Types, Business Model, MVP Functionalities, Key User Stories, Competitive Context, Success Metrics, Constraints. Skip axes consciously when irrelevant (CLI doesn't need business model).

### Stack source gate (early in the conversation)

Stack is one of the 9 axes but it has a unique property: the user may already know it, may have a starter to clone, or genuinely want to decide it from requirements. After the user's initial answer to "what do you want to build?" and before going deep on features, ask explicitly via AskUserQuestion:

> **"Do you already know what stack you'll use?"**
>
> - **I have a starter** — local files already present, or a repo URL to clone. We infer stack from the starter, no debate.
> - **I know my stack** — you state it (TS + Vite + Drizzle, Python + FastAPI + SQLite, bash + sqlite3, etc.), we use it.
> - **Let's discuss together** — stack emerges from requirements (default for greenfield with no preference).

**Skip this gate** if Stage 0 set `stack_source: starter-local` (the starter answered it). In that case, surface the inferred stack in the next message ("Stack from your starter: <X>. Sound right?") and let the user correct conversationally.

Record the choice in `.planning/config.json` under `stack_source` (`starter-local | starter-clone | known | discussed`). Stage 4 starter clone (via `templates/registry.yaml`) only runs if `stack_source: starter-clone` — the user explicitly opted into cloning a starter. All other modes (`starter-local`, `known`, `discussed`) skip Stage 4's auto-suggest entirely. No surprise clones based on stack-name matching.

### Scope gate (mandatory)

If `.planning/config.json` already has `scope` set (e.g. `/riff:init` Step 3b populated it), skip this gate and use the existing value. Surface it in the next message ("Scope: <value> from .planning/config.json") so the user can correct it conversationally.

Otherwise, before the PROJECT.md decision gate, AskUserQuestion to set the project scope:

> **"Is this app personal/local, or production-bound?"**
>
> - **scratch** — personal use, runs locally, no other users, no auth, no public exposure (scripts, data tools, daemons, side projects). Discovery is light: skip design modules, skip adversarial reviews, skip taste rules, skip security-reviewer auto-runs. Speed > rigor.
> - **production** — others will use it, deployed, has auth/payments/PII, or is destined to. Full RIFF discipline: design modules, adversarial reviews, taste rules, security-reviewer on every phase. (Recommended)

Write the answer to `.planning/config.json` (create the file or merge into existing JSON):

```json
{ "scope": "scratch" }
```

Default when the field or file is missing later: `production`. Existing projects without this field keep their current behavior.

**Promotion path:** if user later decides a `scratch` app should go public, ask Claude to "promote to production" — it reads `protocols/PROMOTE.md`, flips scope to `production`, and runs the skipped stages retroactively. No slash command, conversational only.

### Decision gate

AskUserQuestion — "Ready to create PROJECT.md?" Loop until confirmed.

**Write PROJECT.md** from conversation:

- **production scope:** name, goal, pain, users, model, features, stories, stack, constraints, out-of-scope.
- **scratch scope:** name, goal, pain, features (rough list), stack (whatever fits — TS, Python, bash, etc.), constraints (local-only, single user). Skip business model, competitive context, success metrics — irrelevant for personal tools.

---

## Stage 2: Product Design Modules

**Skip if `scope: scratch`** in `.planning/config.json`. Personal/local apps don't need page maps, data models, or system architecture diagrams. Jump to Stage 3.

**Project type** from conversation, `.planning/config.json`, or inference from PROJECT.md.

| Module                | saas/web-app | api | cli/skill/content/automation |
| --------------------- | ------------ | --- | ---------------------------- |
| Pages & Functionality | yes          | no  | skip Stage 2                 |
| Data Model Strategy   | yes          | yes | skip Stage 2                 |
| System Architecture   | yes          | yes | skip Stage 2                 |

Present applicable modules via AskUserQuestion (multiSelect). `mkdir -p .planning/design`.

- **Pages & Functionality:** PROJECT.md → page map grouped by user flow → ASCII wireframes for 3–8 key screens → `.planning/design/pages.md` → surface top routing decisions.
- **Data Model:** entities → fields, relationships, ownership → feature-to-table matrix → `.planning/design/data-model.md` → surface schema decisions.
- **System Architecture:** components + connections → Mermaid diagram → external services table (purpose, provider, risk, failure mode) → `.planning/design/architecture.md` → surface arch decisions.

### Cross-module validation (if 2+ modules ran)

Check: Story→Page, Page→Entity, Entity→Component, Service→Page, feature coverage. Fix gaps before Stage 3.

---

## Stage 2.5: Architecture adversarial review (gated)

Follow [`protocols/ADVERSARIAL-REVIEW.md`](../protocols/ADVERSARIAL-REVIEW.md) with Stage 2.5 parameters (reviewer `agents/architecture-adversarial-reviewer.md`, target `.planning/design/architecture.md`, output `.planning/design/ARCHITECTURE-REVIEW.md`, default `gpt-5.5 high`). Gate flag: `arch_adversarial:` in `.planning/config.json` (`true | false | auto`, default `auto`; `auto` per `AUTO-TRIGGERS.md#architecture-adversarial-auto`).

Architecture-stage fixes cost ~10x more once the roadmap chases the wrong shape, so this is the cheapest checkpoint. On PROCEED, continue to Stage 3.

---

## Stage 3: Feature Scoping

**production scope:** Gather features from PROJECT.md + design modules + research. Propose v1 / Later / Out of Scope split. Adjust via AskUserQuestion loop until "Done — scope is set."

**scratch scope:** Lighter version. Read PROJECT.md features list, then surface 5-10 additional features the user may not have thought of (the value of running RIFF on a perso app: idea expansion). Present as a flat list via AskUserQuestion (multiSelect): "Which of these should I include in the roadmap?" No v1/Later/OOS split — keep it simple. Update PROJECT.md features section with the kept additions.

---

## Stage 4: Roadmap Generation

**production scope:** Decompose v1 into phases. Each phase = **vertical slice** (not horizontal layer). Phase 1 = tracer bullet.

**Mode:** default `mode: AFK`. Mark `mode: HITL` only when manual human verification is unavoidable against a **production** surface: real OAuth/SSO against a prod IdP, real payment checkout, MFA, DNS/prod cutover, irreversible migrations. Code-only auth/payment/security work stays AFK — security-reviewer + adversarial Codex cover it.

**Provider mode:** optional per-phase field `provider_mode: sandbox | production` (default `production`). Set `provider_mode: sandbox` on phases that exercise an external provider via sandbox/test credentials only (test Stripe card, Auth0 dev tenant, Clerk test mode, Supabase test project, Mailtrap, etc.). When combined with `mode: HITL`, `/riff:next` does NOT pause — the verification is routed through the framework-native browser verification protocol (`references/BROWSER-VERIFICATION.md` — Lightpanda headless). Production provider work stays HITL. See `agents/planner.md` § `provider_mode`.

Write `ROADMAP.yaml`. Required fields per phase: `id`, `slug` (kebab-case), `title` (human-readable), `status: todo`, `priority`, `mode`, `depends_on`. Never use a phase-level `name:` field. After writing, run `bash .riff/lib/validate-roadmap.sh ROADMAP.yaml` and fix any reported error before continuing. Self-critique: ordering, dependencies, gaps, sizing, vertical slices, first phase.

**scratch scope:** Decompose features into simple sequential phases (no waves, no `depends_on` graph, no `parallel:` markers). Each phase still ships a usable slice. All phases default `mode: AFK`. No tracer-bullet requirement — first phase can be whatever lands fastest. Write `ROADMAP.yaml` with minimal fields per phase: `id`, `slug` (kebab-case), `title`, `priority`, `status: todo`, `mode: AFK`. Skip `complex_execution`, `adversarial`, `plan_adversarial`, `simplify` flags (the gates are off for scratch anyway). After writing, run `bash .riff/lib/validate-roadmap.sh ROADMAP.yaml` and fix any reported error before continuing.

**Planner-model annotation:** After each phase entry is drafted, append a `planner_model:` field:

- Simple phases (CRUD, copy fix, refactor under 5 files, UI tweak) → `planner_model: codex`
- Risky phases (auth, payments, architecture, migration, public API, novel module) → `planner_model: opus`
- Unsure → `planner_model: opus`

If `executors.available` does not include `codex`, omit the field entirely (runtime defaults to `opus`). Canonical heuristic: `agents/planner.md` § Planner-model recommendation.

---

## Stage 4.5: Roadmap adversarial review (gated)

Follow [`protocols/ADVERSARIAL-REVIEW.md`](../protocols/ADVERSARIAL-REVIEW.md) with Stage 4.5 parameters (reviewer `agents/roadmap-adversarial-reviewer.md`, target `ROADMAP.yaml`, output `.planning/ROADMAP-REVIEW.md`, default `gpt-5.4 medium`). Gate flag: `roadmap_adversarial:` in `.planning/config.json` (`true | false | auto`, default `auto`; `auto` per `AUTO-TRIGGERS.md#roadmap-adversarial-auto`).

Runs before bootstrap. Roadmap fixes are nearly free now; once Stage 5 lands and `/riff:next` starts shipping, re-sequencing costs compound. On PROCEED, continue to Stage 5. Bootstrap does NOT run until verdict is PROCEED.

---

## Stage 5: Bootstrap Files

1. **(production only) Starter clone.** If `stack_source: starter-clone` in `.planning/config.json`, follow [`protocols/STARTER-CLONE.md`](../protocols/STARTER-CLONE.md). Skip on `starter-local`, `known`, `discussed`, brownfield, and scratch scope. Continue to bootstrap whether or not a clone happened.

2. **Bootstrap files.** Follow [`protocols/BOOTSTRAP-FILES.md`](../protocols/BOOTSTRAP-FILES.md). Two paths gated on `scope`: scratch creates a minimal set (STATE, stub README, `.planning/{phases,sessions}`), production creates the full set (CONTEXT, taste index + topic files, STATE, INCIDENTS, project README, `.planning/{phases,sessions,design}`). The protocol also covers stack detection and the slug mapping for new stack files.

3. **(TS/JS production only) Mechanical-quality tooling.** Install `fallow` as a devDep via the detected package manager (pnpm/bun/yarn/npm). Powers `/riff:next` Step 5d. See [`references/FALLOW.md`](../references/FALLOW.md) for behavior, gate logic, and skip rules. Skip silently if `package.json` is absent or in scratch scope. Install failure → warn + continue.

4. **Register with the running dashboard (best-effort).** Follow [`protocols/DASHBOARD-REGISTER.md`](../protocols/DASHBOARD-REGISTER.md). No-op if the dashboard is not running.

## Output

**production scope:** PROJECT.md, ROADMAP.yaml, CONTEXT.md, taste.md, STATE.md, INCIDENTS.md, `.planning/` dirs.

```
Discovery complete. {{N}} features across {{M}} phases.
Phase 1 (tracer bullet): {{TITLE}}
Run /riff:next to start building.
```

**scratch scope:** PROJECT.md, ROADMAP.yaml, STATE.md, `.planning/{phases,sessions}` dirs.

```
Discovery complete (scratch scope). {{N}} features across {{M}} phases.
Phase 1: {{TITLE}}
Run /riff:next to start building. Ask Claude to "promote to production" later if this app goes public.
```

## Session handoff (between Stages)

Stage 2.5 + 4.5 = adversarial + revision cycles → parent bloats past 200k fast.

Close of each Stage (S1, S2, S2.5, S3, S4, S4.5) → check heuristic in [`protocols/HANDOFF.md`](../protocols/HANDOFF.md) § Trigger. 2+ fire → update STATE.md per contract, surface suggestion before next Stage. User override OK.

Mid-Stage handoff = no. Finish artifact (PROJECT.md, design files, ARCHITECTURE-REVIEW.md, ROADMAP.yaml, ROADMAP-REVIEW.md) first.

## Anti-Patterns

- Don't skip wireframes for web projects
- Don't create more than 10 phases (v1 too big)
- Don't plan horizontal phases
- Don't generate code during discovery
- Don't skip cross-module validation

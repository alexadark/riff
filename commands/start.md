---
description: Discovery pipeline - define the product before building it
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, WebSearch, WebFetch, AskUserQuestion, Agent
---

# /riff:start

5-stage discovery pipeline. Complete each stage before the next. All choice points use AskUserQuestion.

**Think harder** throughout. Discovery decisions lock in the entire project trajectory.

## Prerequisites

- RIFF installed (`/riff:init`), git repo exists
- Optional: `.research/*.md` files enrich PROJECT.md if present

---

## Stage 1: Deep Questioning

Open with: **"What do you want to build?"** Then follow the thread.

**Style:** Follow energy, challenge vagueness, make abstract concrete, surface assumptions, find edges, reveal motivation. Do NOT walk through axes as a checklist.

**9 Extraction Axes** (weave naturally): End Goal, Core Problem, User Types, Business Model, MVP Functionalities, Key User Stories, Competitive Context, Success Metrics, Constraints. Skip axes consciously when irrelevant (CLI doesn't need business model).

### Scope gate (mandatory)

Before the PROJECT.md decision gate, AskUserQuestion to set the project scope:

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

**Skip if `scope: scratch`** (Stage 2 was skipped, so no architecture.md exists anyway). Runs only if the System Architecture module ran in Stage 2 (otherwise no `.planning/design/architecture.md` exists to review). Architecture-stage fixes cost ~10x more once the roadmap chases the wrong shape, so this is the cheapest checkpoint.

**Gate:** `arch_adversarial:` from `.planning/config.json` (`true` | `false` | `auto`; default `auto`).

- `false` → skip
- `true` → always run (assuming architecture.md exists)
- `auto` → see [`AUTO-TRIGGERS.md#architecture-adversarial-auto`](../protocols/AUTO-TRIGGERS.md#architecture-adversarial-auto)

**If running:** Agent tool → skill `codex:codex-rescue`.

**Resolve model + effort** per [`protocols/MODEL.md`](../protocols/MODEL.md) § Codex model + effort. Default for Stage 2.5: `gpt-5.5 high`.

Prompt: project name (one line), instruction _"Run with `--model {{MODEL}} --effort {{EFFORT}}`. Read `agents/architecture-adversarial-reviewer.md`. Read `.planning/design/architecture.md`, PROJECT.md, and any sibling design files (`.planning/design/data-model.md`, `.planning/design/pages.md`) that exist. Apply the protocol. Write `.planning/design/ARCHITECTURE-REVIEW.md` with PROCEED or REVISE verdict."_

**On REVISE:**

1. Surface ARCHITECTURE-REVIEW.md to user (paste the Findings section).
2. Re-run the System Architecture module of Stage 2 with ARCHITECTURE-REVIEW.md as additional input. Address every `BLOCKER`, optionally address `WARNING`/`NOTE`, rewrite `.planning/design/architecture.md` in place.
3. Re-run Stage 2.5. Loop until PROCEED.
4. Max 2 revision cycles, then STOP and escalate to user with both files.

**On PROCEED:** continue to Stage 3.

**Skip safely:** if the Codex skill is not configured, log a warning and continue — do not block the discovery pipeline.

---

## Stage 3: Feature Scoping

**production scope:** Gather features from PROJECT.md + design modules + research. Propose v1 / Later / Out of Scope split. Adjust via AskUserQuestion loop until "Done — scope is set."

**scratch scope:** Lighter version. Read PROJECT.md features list, then surface 5-10 additional features the user may not have thought of (the value of running RIFF on a perso app: idea expansion). Present as a flat list via AskUserQuestion (multiSelect): "Which of these should I include in the roadmap?" No v1/Later/OOS split — keep it simple. Update PROJECT.md features section with the kept additions.

---

## Stage 4: Roadmap Generation

**production scope:** Decompose v1 into phases. Each phase = **vertical slice** (not horizontal layer). Phase 1 = tracer bullet.

**Mode:** default `mode: AFK`. Mark `mode: HITL` only when manual human verification is unavoidable: OAuth/SSO browser flow, real payment checkout, DNS/prod cutover, irreversible migrations. Code-only auth/payment/security work stays AFK — security-reviewer + adversarial Codex cover it.

Write `ROADMAP.yaml`. Self-critique: ordering, dependencies, gaps, sizing, vertical slices, first phase.

**scratch scope:** Decompose features into simple sequential phases (no waves, no `depends_on` graph, no `parallel:` markers). Each phase still ships a usable slice. All phases default `mode: AFK`. No tracer-bullet requirement — first phase can be whatever lands fastest. Write `ROADMAP.yaml` with minimal fields per phase: `id`, `title`, `priority`, `status: todo`, `mode: AFK`. Skip `complex_execution`, `adversarial`, `plan_adversarial`, `simplify` flags (the gates are off for scratch anyway).

---

## Stage 4.5: Roadmap adversarial review (gated)

**Skip if `scope: scratch`.** Adversarial Codex review is overkill for personal/local roadmaps where re-sequencing is trivially cheap.

Runs before bootstrap. Roadmap fixes are nearly free now; once Stage 5 lands and `/riff:next` starts shipping, re-sequencing costs compound.

**Gate:** `roadmap_adversarial:` from `.planning/config.json` (`true` | `false` | `auto`; default `auto`).

- `false` → skip
- `true` → always run
- `auto` → see [`AUTO-TRIGGERS.md#roadmap-adversarial-auto`](../protocols/AUTO-TRIGGERS.md#roadmap-adversarial-auto)

**If running:** Agent tool → skill `codex:codex-rescue`.

**Resolve model + effort** per [`protocols/MODEL.md`](../protocols/MODEL.md) § Codex model + effort. Default for Stage 4.5: `gpt-5.4 medium`.

Prompt: project name (one line), instruction _"Run with `--model {{MODEL}} --effort {{EFFORT}}`. Read `agents/roadmap-adversarial-reviewer.md`. Read `ROADMAP.yaml`, PROJECT.md, and any sibling design files (`.planning/design/architecture.md`, `.planning/design/pages.md`) that exist. Apply the protocol. Write `.planning/ROADMAP-REVIEW.md` with PROCEED or REVISE verdict."_

**On REVISE:**

1. Surface ROADMAP-REVIEW.md to user (paste the Findings section).
2. Re-run Stage 4 with ROADMAP-REVIEW.md as additional input. Address every `BLOCKER`, optionally address `WARNING`/`NOTE`, rewrite `ROADMAP.yaml` in place.
3. Re-run Stage 4.5. Loop until PROCEED.
4. Max 2 revision cycles, then STOP and escalate to user with both files.

**On PROCEED:** continue to Stage 5. Bootstrap does NOT run until verdict is PROCEED.

**Skip safely:** if the Codex skill is not configured, log a warning and continue — do not block the discovery pipeline.

---

## Stage 5: Bootstrap Files

### scratch scope (light)

Only create what's needed to start building:

- `STATE.md` — phase 1, status: Initialized
- `mkdir -p .planning/{phases,sessions}` (no `design/` — no design modules ran)

**No** `CONTEXT.md`, **no** `taste.md`, **no** `taste/` files, **no** `INCIDENTS.md`, **no** stack-specific configs. The executor runs language-agnostic in scratch mode and only enforces R1-R4 + "no hardcoded secrets" (see `agents/executor.md` § Scratch scope).

Skip the "Stack detection" subsection below entirely.

Jump to Output.

### production scope (full)

- `CONTEXT.md` — locked decisions from discovery
- `taste.md` (index + always-apply) and `taste/` topic files — start from `templates/taste.md`. The template is an index with an "always-apply architecture" section inline and a "Load on-demand" table pointing to `taste/*.md`. Create the topic files:
  - `taste/frontend.md` — seeded from `references/taste/stacks/{slug}.md` (framework conventions) + project-specific UI patterns surfaced in discovery.
  - `taste/backend.md` — seeded from `references/taste/backend.md` + project-specific service/provider patterns.
  - `taste/security.md` — seeded from `references/taste/security.md` + project-specific auth/tenant rules.
  - `taste/testing.md` — seeded from `references/taste/testing.md`.
  - Populate the main `taste.md` "always-apply architecture" section from `references/taste/architecture.md` + project-specific architectural decisions (hexagonal, JSONB-first, etc.).
  - If no reference exists for the stack, seed `taste/frontend.md` as an empty stub marked "to fill after tracer bullet."
  - Keep each topic file under ~50 lines. Split further if it grows (e.g. `taste/database.md` spun out of backend).
  - Verify version-specific rules via `ref_search_documentation` or Context7 MCP before writing.
- `STATE.md` — phase 1, status: Initialized
- `INCIDENTS.md` — copy from `templates/INCIDENTS.md` (regression ledger, append-only)
- `mkdir -p .planning/{phases,sessions,design}`

### Stack detection

Stack is captured in Stage 1 (Constraints axis). Map to slug:

| Stack mention in PROJECT.md         | Slug                                 |
| ----------------------------------- | ------------------------------------ |
| React Router 7, RR7, framework mode | `react-router-7`                     |
| Next.js (app router, pages router)  | `nextjs` (add when first used)       |
| Astro                               | `astro` (add when first used)        |
| Python / FastAPI / Django           | `python-{framework}` (add when used) |
| Go                                  | `go` (add when used)                 |

When a new stack is used for the first time, create `references/taste/stacks/{slug}.md` in RIFF itself (not just the project). Pattern after `react-router-7.md`: Core Rules → Component conventions → Framework-specific topics → UX & Accessibility → Anti-Pattern Checklist.

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

## Anti-Patterns

- Don't skip wireframes for web projects
- Don't create more than 10 phases (v1 too big)
- Don't plan horizontal phases
- Don't generate code during discovery
- Don't skip cross-module validation

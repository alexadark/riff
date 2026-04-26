# PROMOTE

How RIFF promotes a `scratch` (personal/local) project to `production` scope when it's about to gain users, get deployed, or handle PII. Read by Claude when the user says "promote", "passe en production", "this is going public", or equivalent. There is no `/riff:promote` slash command, the flow is conversational.

---

## When to read this protocol

User says any of:

- "promote to production", "passe en production", "this app is going public"
- "make this production-grade", "lock this down properly"
- Or after a `scratch` project gains: a public deploy, an auth flow, payment handling, third-party users

**Always confirm before running.** Promotion is a one-way door (well, two-way technically, but you'd lose the rationale). Surface what will change and ask for confirmation before touching anything.

---

## Prerequisites

- Project has run `/riff:start` previously
- `.planning/config.json` has `scope: scratch`
- PROJECT.md and ROADMAP.yaml exist

**No-op if scope is already `production`** — print "Already production scope. Nothing to do." and exit.

---

## Steps

### Step 1: Confirm with the user

Surface what promotion will change:

```
Promoting from scratch → production. This will:
- Run Stage 2 (design modules: pages, data, architecture)
- Run Stage 2.5 (architecture adversarial review via Codex)
- Run Stage 4.5 (roadmap adversarial review via Codex)
- Create taste.md + taste/ topic files (frontend, backend, security, testing)
- Create INCIDENTS.md
- Create CONTEXT.md
- Re-evaluate features (v1 / Later / Out of Scope split)
- Future /riff:next phases will run security-reviewer + adversarial Codex + simplifier
```

AskUserQuestion: `proceed` / `cancel`. Cancel → exit without changes.

### Step 2: Flip the scope flag

Update `.planning/config.json`:

```json
{ "scope": "production" }
```

Preserve any other keys already in the file.

### Step 3: Re-run Stage 3 (feature scoping, full)

Read PROJECT.md features. Apply the full v1 / Later / Out of Scope split via AskUserQuestion loop until "Done — scope is set." See `/riff:start` Stage 3, production branch.

Update PROJECT.md features section with the v1/Later/OOS structure.

### Step 4: Run Stage 2 retroactively

Per `/riff:start` Stage 2 (production scope): pages + data model + system architecture modules. AskUserQuestion to pick which apply (skip pages for CLI/script projects, skip data model if no persistence, etc.).

Output to `.planning/design/`. Run cross-module validation if 2+ modules ran.

### Step 5: Run Stage 2.5 retroactively (gated)

Architecture adversarial review via Codex. Same protocol as `/riff:start` Stage 2.5. On REVISE, loop until PROCEED (max 2 cycles).

Skip safely if Codex skill is not configured.

### Step 6: Re-run Stage 4 (roadmap)

The existing scratch ROADMAP.yaml was sequential and minimal. Re-decompose with vertical slices, waves, dependencies, gates per phase. Phase 1 = tracer bullet (the existing Phase 1 may already qualify; reuse if it does).

**Preserve done phases.** Do NOT rewrite phases with `status: done`. Only re-shape `todo` phases. Add adversarial/simplify gates to remaining phases as appropriate.

### Step 7: Run Stage 4.5 retroactively (gated)

Roadmap adversarial review via Codex. Same protocol as `/riff:start` Stage 4.5. On REVISE, loop until PROCEED (max 2 cycles).

Skip safely if Codex skill is not configured.

### Step 8: Bootstrap missing files

Create what scratch skipped:

- `CONTEXT.md` — locked decisions surfaced during Stages 2-4 above
- `taste.md` + `taste/` topic files (frontend, backend, security, testing) — seed from `references/taste/` per `/riff:start` Stage 5 production branch
- `INCIDENTS.md` — copy from `templates/INCIDENTS.md`

If the project's stack maps to a `references/taste/stacks/{slug}.md`, seed `taste/frontend.md` from it. Otherwise stub with "to fill after next phase."

### Step 9: Surface what changed

Print a summary so the user knows what's now in play:

```
Promoted to production scope.
- scope: production (was: scratch)
- Created: taste.md, taste/{frontend,backend,security,testing}.md, INCIDENTS.md, CONTEXT.md
- Updated: ROADMAP.yaml ({{N}} todo phases re-shaped)
- Next /riff:next will run: planner adversarial, simplifier, security-reviewer, adversarial Codex.
```

---

## Anti-patterns

- Don't rewrite phases with `status: done` — they shipped already, leave them alone.
- Don't drop the existing PROJECT.md content — append/refine, don't replace.
- Don't run Stage 1 (deep questioning) again — the project already exists and has identity. Only run the missing/light stages.
- Don't promote silently. Always confirm via AskUserQuestion at Step 1.

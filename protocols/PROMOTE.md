# PROMOTE

How RIFF promotes a `scratch` (personal/local) project to `production` scope when it's about to gain users, get deployed, or handle PII. Read by Claude when the user says "promote", "passe en production", "this is going public", or equivalent. There is no `/riff:promote` slash command, the flow is conversational.

---

## When to read this protocol

User says any of:

- "promote to production", "passe en production", "this app is going public"
- "make this production-grade", "lock this down properly"
- Or after a `scratch` project gains: a public deploy, an auth flow, payment handling, third-party users

**Always confirm before running.** Promotion is a one-way door (well, two-way technically, but you'd lose the rationale). Surface what will change and ask for confirmation before touching anything.

**Question phrasing:** every `AskUserQuestion` in this protocol (Step 1 proceed/cancel, Step 1.5 high-bug triage + audit opt-out, Step 3 v1/Later/OOS loop, Step 4 module picker) follows the resolved `explanation_level`. See `references/EXPLANATION-LEVEL.md` § Interactive questions.

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
- Run a pre-flight audit (audit-codebase, Critical bugs block promotion)
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

### Step 1.4: Scratch-reconcile gate

Before the audit gate, refuse to promote if any wave shipped under
`scratch_mode` and its security reconcile is still pending.

Check:

```bash
find .planning/followups -type f -name 'SECURITY-W*-RECONCILE.md' 2>/dev/null
```

For every file returned, count the bullet entries under its `## Findings`
section. A file is **clean** when that count is zero (or the file is
deleted). A file is **pending** otherwise.

**If any pending file exists** → STOP. Print:

```
Promotion blocked: {{N}} wave(s) shipped under scratch_mode have unresolved
security findings.

Pending reconcile files:
{{list each path with its finding count}}

Resolve each finding in the code, then either delete the reconcile file or
empty its Findings section. Re-trigger promote when clean.
```

The user fixes and re-triggers promotion. Do not proceed to Step 1.5.

Skip this step silently when no `SECURITY-W*-RECONCILE.md` files exist.

### Step 1.45: Wave reconcile gate

Before the audit gate, refuse to promote if any wave that shipped is
missing its reconcile file or has a reconcile verdict of `FAIL`.

Check:

```bash
for w in .planning/waves/W*.RESULT.md; do
  n="${w##*/W}"; n="${n%.RESULT.md}"
  rec=".planning/waves/W${n}.RECONCILE.md"
  if [ ! -f "$rec" ]; then
    echo "MISSING|W${n}"
  else
    v=$(awk -F': ' '/^verdict:/{print $2; exit}' "$rec")
    echo "${v:-UNKNOWN}|W${n}"
  fi
done
```

Block when any line is `MISSING|*` or `FAIL|*`.

**If MISSING** → print:

```
Promotion blocked: wave(s) {{list}} have no RECONCILE.md.
Run `/riff:wave --resume W{N}` for each before promoting.
```

**If FAIL** → print:

```
Promotion blocked: wave(s) {{list}} have FAIL reconcile verdicts.
Open .planning/waves/W{N}.RECONCILE.md to see the blocking findings.
Fix, then re-run `/riff:wave --resume W{N}` to refresh the verdict.
```

`PASS-WITH-WARNINGS` does NOT block. Warnings surface in Step 1.5 below
as part of the audit summary so the user sees them once before flipping
scope.

Skip this step silently when no `.planning/waves/W*.RESULT.md` files
exist (no waves shipped yet).

### Step 1.5: Pre-promote audit gate

Before flipping the scope flag (point of no return for the rest of the flow), run a baseline audit so promotion doesn't paper over known issues that the stricter production gates will then keep flagging.

Invoke skill `audit-codebase` mode `full`. Read the resulting bug TLDR + AI-readiness score.

**If `Critical` bugs exist** → STOP. Print:

```
Promotion blocked: {{N}} critical bugs in current codebase. Production scope locks in stricter gates (security-reviewer + adversarial Codex on every phase) that will keep flagging these. Fix them first, then re-trigger promote. See .assay-assessment/bug-report.md.
```

User fixes and re-triggers promotion. Do not proceed to Step 2.

**If `High` bugs exist (no Critical)** → AskUserQuestion:

> "{{X}} high-severity bugs found by audit. Promote anyway (they will surface as explicit phases in upcoming `/riff:next` runs) OR pause to address them first?"
>
> - **Promote anyway** — continue to Step 2
> - **Pause** — exit, user fixes then re-triggers promote

**If only Medium/Low bugs (or none)** → continue to Step 2. Medium findings batch into normal sprint work post-promote.

**Skip Step 1.5 entirely** if the `audit-codebase` skill is not available (graceful fallback, do not block) or the user explicitly opts out via AskUserQuestion.

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
- Don't bypass Step 1.4 by deleting `SECURITY-W*-RECONCILE.md` without
  actually fixing the findings. The reconcile gate is meant to be a
  forcing function, not paperwork.

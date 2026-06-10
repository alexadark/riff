# Wave bundle construction

How `/riff:wave` Step 3 assembles `.planning/waves/W{N}.bundle.md`.

The bundle is the **single contract** the Codex wave executor reads. Everything Codex needs to one-shot the wave must be in it, Codex does not navigate the wider RIFF docs.

## File location

`.planning/waves/W{N}.bundle.md` where `N` is the next available integer. First wave = `W1`.

`mkdir -p .planning/waves` if missing.

## Structure

```markdown
# Wave W{N} — {{wave_title}}

## Bundle header

scratch_mode: false  # set to `true` when /riff:wave --scratch was invoked

## Goal

{{One paragraph stating the user-facing outcome of the whole wave. Not "ship phases 5-7" — but "users can create V2 workflows with conditional branching, A/B tests, and inline editing".}}

## Acceptance contract (wave-level)

A green wave means:
- Each phase below ships its commit with all acceptance criteria GREEN
- Smoke/browser-check passes on every phase that has `smoke_test: true`
- No phase deviates from the planned file list without an explicit `## Deviation` note in RESULT.md
- Final RESULT.md exists at `.planning/waves/W{N}.RESULT.md`

## Execution rules

- One atomic commit per phase. Conventional commit (`feat:`, `fix:`, `refactor:`, `content:`...). Never `git add .`.
- **Execution order** is specified per wave:
  - **Parallel waves** (phases have no `depends_on` between them): "Execute in any order" + use `-m` flag.
  - **Sequential waves** (phases form a `depends_on` chain): "SEQUENTIAL execution: PA → PB → PC" + do NOT use `-m`. Complete each phase fully (commit + browser-check) before starting the next.
  - The bundle's Execution rules section is the source of truth for which shape applies.
- If a phase blocks (test failure, ambiguous spec), do NOT skip silently. Write a `## Blocker` block in RESULT.md and continue the next phase if possible.
- Browser-check is non-negotiable on UI phases. Read `.riff/protocols/BROWSER-CHECK.md` for the contract.
- Stop only when ALL phases reach a terminal state (commit + criteria green, OR blocker logged).

## Skill digestion

When assembling the bundle, the orchestrator checks which skills (from `.claude/skills/` and project-level skills) are relevant to the wave's phases. Instead of inlining full skill files (which would blow the 50KB bundle cap), digest each relevant skill into 3-5 actionable rules.

### How to digest

1. Read the skill's SKILL.md trigger description and core rules
2. Extract only the rules that apply to THIS wave's file boundaries
3. Write them as short, imperative bullets (not explanations)

### Where to put it

Add a `## Digested Rules` section in each per-phase block, after the acceptance criteria:

```
## Digested Rules (from project skills)

- Use server loaders for initial data, clientLoader for refresh only
- No `use client` unless the component uses browser APIs
- Form submissions go through action functions, not event handlers
- Test files next to source files, not in a separate __tests__ directory
```

If no skills are relevant to a phase, omit the section entirely. Do not add empty sections.

### Why not inline the full skill?

A typical SKILL.md is 100-300 lines. 3 phases × 200 lines = 600 lines of skills alone, eating 30%+ of the 50KB bundle cap. Digestion compresses this to ~20 lines total while preserving the rules Codex actually needs.

## Effort

Default: `--model gpt-5.5 --effort high`.
Per-phase override below if set.

## Stack rules to honor

{{Auto-detected from package.json. List the .riff/references/taste/stacks/*.md files
that match the project's stack. Codex MUST read each one before writing code.
Examples:}}

- `.riff/references/taste/stacks/react-router-7.md` (if `react-router` in deps)
- `.riff/references/taste/stacks/drizzle.md` (if `drizzle-orm` in deps)
- `.riff/references/taste/stacks/zod.md` (if `zod` in deps)
- `.riff/references/taste/stacks/vitest.md` (if `vitest` in devDeps)
- `.riff/references/taste/stacks/tanstack-start-v1.md` (if `@tanstack/react-start` in deps)

This list is part of the Quality contract enforced by Template A in CODEX-DELEGATION.md.

---

## Phase P{X} — {{phase_slug}}

**Goal:** {{one line from ROADMAP entry}}

**Files (planned):**
- `path/to/file1.ts` (modify)
- `path/to/file2.tsx` (create)

**Effort:** `codex_effort: high` (default) | `xhigh` | `medium`

**Acceptance criteria:**
- [ ] {{criterion 1, testable}}
- [ ] {{criterion 2, testable}}
- [ ] {{criterion N}}

**Browser-check:** enabled | disabled

If enabled, the user journey to verify (Codex runs this in the browser):
1. Navigate to `/{{route}}`
2. {{action 1}}
3. {{action 2}}
4. Verify {{observable outcome}}

**Risks:**
- {{risk 1, what could go wrong}}
- {{risk 2}}

**Full plan:**

{{Inline the entire .planning/phases/X-slug/PLAN.md here. Do not link — Codex must not navigate.}}

---

## Phase P{Y} — {{phase_slug}}

{{... same structure ...}}

---

## RESULT.md contract

At the end, write `.planning/waves/W{N}.RESULT.md` with this structure:

\`\`\`markdown
# Wave W{N} — RESULT

## Status: complete | partial | blocked

## Per-phase

### Phase P{X} — {{slug}}
- Commit: {{hash}} {{message}}
- Criteria: [{{n}}/{{total}} green]
- Browser-check: PASS | FAIL | skipped (reason)
- Deviation: none | {{description}}
- Files touched: {{actual list, may differ from planned}}
- Time: {{minutes}}

### Phase P{Y} — {{slug}}
{{... same ...}}

## Wave-level notes

- {{anything cross-cutting Codex learned}}
- {{patterns to add to taste.md}}
- {{follow-up phases to seed in ROADMAP}}
\`\`\`
```

## Bundle header fields

| Field | Type | Default | Meaning |
|---|---|---|---|
| `scratch_mode` | bool | `false` | When `true`, security findings are downgraded to warnings, Codex is instructed to insert `// TODO(security)` markers, and the wave auto-generates `.planning/followups/SECURITY-W{N}-RECONCILE.md`. Set by `/riff:wave --scratch`. The reconcile file blocks promotion until cleared. See `commands/wave.md` § Scratch mode and `protocols/PROMOTE.md`. |

## Building the bundle (Claude side)

For each wave-eligible phase identified in `/riff:wave` Step 1:

1. **Verify PLAN.md exists** at `.planning/phases/{id}-{slug}/PLAN.md`. If missing, run `agents/planner.md` inline (use Opus). Do NOT delegate planning to Codex — Opus plans, Codex executes.

   **Scope-check parseability:** each per-phase PLAN.md must expose its tasks in a shape `.riff/scripts/scope-check.mjs` can read during reconcile. Ideally a `## Tasks` section whose tasks are `### Task N:` headings; wave-style PLANs may instead place `### Task N` / `### NN-NN` task headings directly under `## Wave N` group headers. Any `## Wave N` / `### Wave N` group header must carry its task IDs in square brackets (e.g. `### Wave 1 — parallel [NN-01, NN-02]`) so they survive even when the underlying tasks are bold lines rather than headings — the parser treats wave headers as transparent containers, never as tasks.
2. **Extract goal** from ROADMAP.yaml `title:` + first paragraph of PLAN.md.
3. **Extract acceptance criteria** from ROADMAP.yaml `acceptance:` field. If absent, infer from PLAN.md `## Acceptance criteria` section. If still absent, prompt the planner to add them — never ship a wave without criteria.
4. **Compute browser-check enable** — see [`BROWSER-CHECK.md`](./BROWSER-CHECK.md) § Auto-enable.
5. **Inline the full PLAN.md** under `**Full plan:**`. No links.
6. **Sum estimated durations** for the wave header.

## Bundle hygiene

- Bundle file size cap: 50 KB. If larger, the wave is too big — propose splitting.
- Total phases per wave cap: 5. More than 5 = Codex context overflow risk.
- Each phase's PLAN.md cap: 200 lines. Larger plans must be compressed by the planner before bundling.

## Prompt preservation

After rendering the Codex prompt (Template A/B/C from `CODEX-DELEGATION.md`), write it
to `.planning/waves/W{N}.prompt.md` containing:

- The exact launch command (`cd`, `git switch`, `codex ...`)
- The full `/goal` prompt block (verbatim)
- Metadata: orchestrator model, executor model + effort, routing (in/out-of-process),
  base SHA, branch, phases list, scratch_mode

This file is the audit trail for what instructions the executor received. Saved
alongside the bundle (spec) and the RESULT (outcome). Required on every wave.

## Cross-references

- `/riff:wave` Step 3 calls this protocol
- `protocols/CODEX-DELEGATION.md` reads the bundle and dispatches
- `protocols/BROWSER-CHECK.md` defines the per-phase browser-check block

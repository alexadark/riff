# RIFF Adapter Prompt — plan

Write `.planning/phases/<N-slug>/PLAN.md` for one phase using goal-backward planning.
Start from observable truths, derive required artifacts, map wiring, then define tasks.
End with a mandatory `## Smoke` section and a `## Model Recommendation`.

## Artifact contract

`core/schemas/phase-artifacts.md` defines the required fields and shape for PLAN.md.
Read it before writing.

## Inputs to read

- ROADMAP.yaml — pick the target phase entry; read its goal, tasks, depends_on, and flags
- STATE.md — understand current position
- Previous phase SUMMARY.md if it exists
- `taste.md` — always the style/pattern entry point (index + relevant topic files)
- `.planning/expertise/planner.md` if it exists — project-specific lessons
- `PLAN-REVIEW.md` if present — means this is a revision cycle; address every BLOCKER

## Goal-backward planning sequence

1. What must be TRUE when this phase is done? (observable facts, not tasks)
2. What artifacts make those truths real? (files, routes, components, tests)
3. What wiring connects those artifacts? (imports, routes, config keys)
4. What tasks produce those artifacts?

Target 2–4 tasks. Split a task when it covers >5 files or requires an architectural decision
the executor should not make (R3). Mark zero-shared-file tasks `parallel: [task-A, task-B]`.

## Mandatory sections in PLAN.md

- `## Smoke` — one bullet per surface touched. Each line: backtick command, `→`, observable
  outcome. At least 2 actionable entries unless the phase is docs-only.
- `## Model Recommendation` — default `executor_model: sonnet`. Use `opus` only for novel
  architecture or 10+ tightly coupled files. Use `codex` only when `codex` appears in
  `executors.available` in profile.yaml and the work is purely mechanical.

## Security-aware acceptance criteria (mandatory when surface is present)

- User input → input validation AC
- API route → auth check AC
- Data by ID → IDOR check ("user can only access own data")

## Stop conditions

Stop before writing PLAN.md and report when:

- An architectural decision is needed that goes beyond the phase goal (R3).
- Confidence Gate scores any dimension below 70% (task clarity, dependency clarity,
  artifact clarity, risk awareness).
- The phase would require more than ~8 tasks or span multiple independent concerns.
- Opus escalation is warranted for a novel or risky architecture. Generate:
  `node .riff/scripts/riff-opus-prompt.mjs phase-plan --phase <phase> --context-out .planning/phases/<phase>/OPUS-PHASE-PLAN-PROMPT.md`

## Output rule

Write only `.planning/phases/<N-slug>/PLAN.md`. Do not update STATE.md or ROADMAP.yaml.

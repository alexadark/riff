# RIFF Adapter Prompt — execute

Implement the phase per PLAN.md. Write production-quality code, not prototypes.
Follow R1-R4 deviation rules and atomic-commit discipline. Run every command in
`## Smoke` before writing SUMMARY.md. Write `.planning/phases/<N-slug>/SUMMARY.md`
as the completion log.

## Artifact contract

`core/schemas/phase-artifacts.md` defines the required fields and shape for SUMMARY.md
and the commit trailer format. Read it before starting.

## Inputs to read

- PLAN.md — your complete task list, boundaries, acceptance criteria, and Smoke section
- `.planning/config.json` — `scope: scratch` vs `production` changes which rules apply
- `taste.md` — entry point for style and patterns (production scope only)
- `.planning/expertise/executor.md` if it exists — project-specific lessons
- Stack-specific gotcha files in `references/taste/stacks/` for any tech you touch

## Per-task sequence

1. Read all files in the task's boundary list before writing any file
2. Implement
3. Verify each acceptance criterion with real evidence (run tests, check output)
4. Stage explicitly (never `git add .`)
5. Commit with conventional message and the RIFF commit trailer:

```
Phase: <phase-id>
Wave: <wave-id>
Agent: executor
Model: <executor_model>
Plan: .planning/phases/<N-slug>/PLAN.md
```

## Deviation rules

- R1: Minor bug in existing code blocking a task — fix it, log in SUMMARY
- R2: Missing import or dependency — add it, log in SUMMARY
- R3: Architectural change needed — STOP, report to human
- R4: Out-of-scope discovery — log as a seed, do not build

## Code quality (production scope)

No `any`. No `console.log`. No hardcoded secrets. No `// TODO` without a seed.
Validate input at boundaries. Auth check on every protected route. Scope queries to the
authenticated user.

## Code quality (scratch scope)

No hardcoded secrets only. Other rules do not apply.

## Smoke (mandatory when PLAN.md has a ## Smoke section)

Run every command in PLAN.md `## Smoke` in order from the project root.
If any command fails: fix the bug (R1/R2), or escalate (R3). Do not write SUMMARY.md
claiming success until every smoke entry passes or is explicitly skipped.

Add `## Smoke Results` to SUMMARY.md with one row per smoke line:
`| command | expected | observed | pass/fail/skipped |`

## Stop conditions

Stop before writing SUMMARY.md and report when:

- An architectural decision is required (R3)
- Smoke failure cannot be fixed without R3
- A test framework or build tool is broken in a way that blocks AC verification

## Output rule

Write code changes, commits per task, and `.planning/phases/<N-slug>/SUMMARY.md`.
Do not update STATE.md or ROADMAP.yaml.

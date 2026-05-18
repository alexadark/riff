Show RIFF project status for $ARGUMENTS.

Use minimal context. Do not edit files unless the user explicitly asks for a repair.

Read, if present:

- `.planning/config.json`
- `.planning/active-phase.txt`
- `STATE.md`
- `ROADMAP.yaml`
- active phase `PLAN.md`
- active phase `SUMMARY.md`
- active phase `GATES.md`
- active phase `SCOPE-CHECK.json`
- active phase `REVIEW.md`
- active phase `SECURITY.md`

Report:

1. scope: `production`, `scratch`, or unknown
2. active phase and next eligible roadmap phase
3. gate status: pending, running, pass, warn, fail, skipped
4. blockers and missing artifacts
5. safest next command: `riff/quick`, `riff/next step=<name>`, or manual review

Rules:

- RIFF artifacts are the source of truth.
- If artifacts disagree, say exactly which files conflict.
- Do not infer a gate passed without artifact evidence.
- For production, any failed or pending required gate blocks finalization.


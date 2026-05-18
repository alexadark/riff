# Gates Log - Phase {{PHASE_ID}}: {{PHASE_TITLE}}

Scope: `{{SCOPE}}`

Statuses: `pending`, `running`, `pass`, `warn`, `fail`, `skipped`.

Production finalization is blocked by required gates that are `pending`, `running`, `fail`, or `skipped`, except `state` while the finalizer is running.
Scratch finalization is blocked by unresolved R1-R4, no-secrets, smoke, summary, or state gates.

| Gate | Status | Required | Command | Exit Code | Artifact | Updated At | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- |
| plan-review | pending | yes |  |  | PLAN-REVIEW.md |  |  |
| execute | pending | yes |  |  | SUMMARY.md |  |  |
| scope-check | pending | yes |  |  | SCOPE-CHECK.json |  |  |
| code-review | pending | yes |  |  | REVIEW.md |  |  |
| security-review | pending | yes |  |  | SECURITY.md |  |  |
| docs-check | pending | yes |  |  | DOCS-CHECK.md |  |  |
| hooks | pending | yes |  |  | GATES.md |  |  |
| dashboard | pending | yes |  |  | dashboard-metadata.json |  |  |
| dashboard-explain | skipped | no |  |  | dashboard-explanation.json |  | optional |
| summary | pending | yes |  |  | SUMMARY.md |  |  |
| state | pending | yes |  |  | STATE.md |  |  |
| r1-r4 | pending | yes |  |  | SUMMARY.md |  |  |
| no-secrets | pending | yes |  |  | GATES.md |  |  |
| smoke | pending | yes |  |  | SUMMARY.md |  |  |

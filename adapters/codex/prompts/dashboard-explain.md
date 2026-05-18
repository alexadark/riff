# Codex Capability: Dashboard Explain

Generate dashboard explanation metadata from RIFF artifacts.

Read:

- `core/protocols/dashboard.md`
- `.planning/phases/<phase>/dashboard-metadata.json`
- `.planning/phases/<phase>/PLAN.md` when present
- `.planning/phases/<phase>/SUMMARY.md` when present
- `.planning/phases/<phase>/GATES.md` when present
- review and security artifacts when present
- `STATE.md` when present

Write:

- `.planning/phases/<phase>/dashboard-explanation.json`

Required fields:

- `phaseId`
- `generatedAt`
- `sourceArtifacts`
- `generator`
- `summary`
- `blockingStatus`
- `freshness`

Keep the explanation short. Do not treat generated explanation text as the source of truth for phase state.

If deterministic dashboard metadata is missing, stop and ask the user to run the `dashboard-metadata` command before generating explanation text.

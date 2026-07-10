# Autonomous Run Report — {{RUN_ID}}

> Project: {{PROJECT}}
> Launched: {{LAUNCHED_AT}} · Finished: {{FINISHED_AT}}
> Verdict: {{PASS | PASS-WITH-WARNINGS | ATTENTION}} — {{N_MERGED}} merged, {{N_PARKED}} parked, {{N_FINISHERS}} finishers pending

## Phases

| Phase | Class | Outcome | Gates | Where to look |
| --- | --- | --- | --- | --- |
| {{N-slug}} | safe \| hold | merged \| parked \| done | {{security}}/{{review}}/{{scope}}/{{smoke}} | `.planning/phases/{{N-slug}}/` |

## Findings (deduped, all surfaces)

Merged from SECURITY.md, REVIEW.md, stress static pass, uxtest run, browser verification. Dedup by file + finding, same shape as the deep-audit synthesis.

### BLOCKER

- {{finding — file — source surface — linked finisher id}}

### HIGH

- {{finding}}

### NOTE

- {{finding}}

## Finishers awaiting you

One line per pending entry in `finishers.yaml`, sorted security > payment > branch > ux > review > decision:

- **{{F1}}** [{{type}}] {{waiting_on}} → `{{artifact}}` (branch `{{branch}}`)

Resolve conversationally: "finisher F1 ok, merge it" / "reject F1". Cross-project view anytime: `node .riff/scripts/riff-pending.mjs`.

## Decisions taken instead of asking

Inlined from `DECISIONS.md` (this run). Check the box after reviewing; unchecked entries appear in the pending inbox.

- [ ] {{AD1 — phase — decision — evidence}}

## Deferred

- Expertise patches pending: {{count}} (review at next `/riff:next` end-of-phase)
- Milestone deep-audits deferred: {{list or none}}

## Verification coverage

- Stress static pass: {{verdict + report path or "skipped — reason"}}
- uxtest: {{run path + per-flow verdicts or "skipped — no flows.yaml / skill unavailable"}}
- Sandbox provider evidence: {{screenshots/console paths per phase or none}}

## Next commands

- Review a parked branch: `git diff main...{{branch}}` + the finisher artifact
- Sweep all projects: `node .riff/scripts/riff-pending.mjs`
- Resume/continue building: `/riff:next` or `/riff:wave`

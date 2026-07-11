# Conductor Report — {{RUN_ID}}

> {{DATE}} · {{scheduled | interactive}} · {{N_ADVANCED}} advanced, {{N_SKIPPED}} skipped

## Portfolio

| Project | Outcome | Merged | Parked | Finishers pending | Detail |
| --- | --- | --- | --- | --- | --- |
| {{PROJECT_NAME}} | advanced \| skipped | {{N_MERGED}} | {{N_PARKED}} | {{N_FINISHERS}} | `skipped: {{reason}}` or link to per-project section |

## Per project

One `### {{PROJECT_NAME}}` subsection per ADVANCED project.

### {{PROJECT_NAME}}

- Merged: {{N-slug}}, {{N-slug}}, …
- Parked: {{N-slug}} → finisher {{F1}} — {{plain-language recommended action, same convention as AUTONOMY-REPORT § Finishers}}
- Decisions taken instead of asking: {{count}} unchecked
- Run report: `.planning/conductor/{{RUN_ID}}/{{PROJECT_NAME}}/REPORT.md`

## Pending inbox (all projects)

Inlined from `node .riff/scripts/riff-pending.mjs`, run at the end of this conductor pass.

- {{finisher / unreviewed decision / INCONSISTENT integrity item — project — one line}}

## Skipped

| Project | Reason | What would unblock it |
| --- | --- | --- |
| {{PROJECT_NAME}} | {{scratch \| dirty-tree \| diverged \| in-flight-session \| ambiguous-state \| merges-blocked \| no-eligible-work \| not-opted-in \| invalid-roadmap \| missing \| not-a-git-repo}} | {{clean the tree, resolve the finisher, opt in via dashboard.projects, …}} |

## Next commands

- Resolve a finisher: "finisher F1 ok, merge it" (or `reject finisher F1`)
- Review a parked branch: `git diff main...{{branch}}` + the finisher artifact
- Re-run the conductor: `/riff:conductor`
- Re-run for one project only: `/riff:conductor --projects {{PROJECT_NAME}}`
- Preview without advancing anything: `/riff:conductor --dry-run`

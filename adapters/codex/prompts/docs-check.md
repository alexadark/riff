# RIFF Adapter Prompt — docs-check

Verify documentation alignment with code changes made in this phase. Update stale docs
and write `.planning/phases/<N-slug>/DOCS-CHECK.md` with a verdict.

## Artifact contract

`core/schemas/phase-artifacts.md` defines the structure for DOCS-CHECK.md.
Read it before writing.

## Inputs to read

- Run `git diff main...HEAD` to get the full phase diff
- `.planning/phases/<N-slug>/SUMMARY.md` — what was built
- `.claude/references/project-details.md` (file tree reference) — if it exists
- `docs/architecture.md` — if it exists
- `taste.md` — check if new patterns were introduced
- `README.md` — check if public API or dev commands changed

## What to check

1. **File tree reference** (`.claude/references/project-details.md`): if any file was
   created, renamed, or deleted in the diff, is the reference updated? If stale, update it.

2. **Architecture docs** (`docs/architecture.md`): if the diff adds a new service, route,
   data flow, or external integration, is the architecture doc updated? If stale, update it.

3. **taste.md**: if the diff introduces a new reusable pattern (a new component shape,
   a new DB query pattern, a new error handling idiom), does taste.md reflect it?
   If not, add a `<!-- PENDING -->` annotation for human review — do not auto-merge.

4. **README.md**: if the diff changes a public API endpoint, adds a CLI command, or changes
   the dev setup, is README.md updated? If stale, update it.

## Output format for DOCS-CHECK.md

```
# Docs Check — Phase N

## Status

| Document | Status | Action taken |
|----------|--------|--------------|
| project-details.md | up-to-date / updated / not applicable | ... |
| architecture.md | up-to-date / updated / not applicable | ... |
| taste.md | up-to-date / pending annotation / not applicable | ... |
| README.md | up-to-date / updated / not applicable | ... |

## Verdict: PASS / UPDATED / PENDING

PASS = everything was already accurate.
UPDATED = one or more docs were updated in this run.
PENDING = a taste.md annotation needs human review before promoting.
```

## Stop conditions

Stop before writing DOCS-CHECK.md and report when:

- The SUMMARY.md is missing (cannot determine what was built)

## Output rule

Write `.planning/phases/<N-slug>/DOCS-CHECK.md`. When updating a doc file, commit the
change with `docs(phase-N): update <file> for phase changes`.

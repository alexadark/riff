# Summary - Phase {{PHASE_ID}}: {{PHASE_TITLE}}

> Completed: {{DATE}}
> Duration: {{DURATION}}
> Merge commit: {{MERGE_COMMIT}}

<!-- Merge commit: full 40-char SHA of the merge commit on main. Written by
     /riff:next Step 8c after `git merge --no-ff` (local_no_ff strategy) or
     by Step 0 of the next /riff:next run via `gh pr view --json mergeCommit`
     (github_button strategy). Stays as `{{MERGE_COMMIT}}` until merged.
     /riff:next Step 0 reads this SHA and runs `git merge-base --is-ancestor
     <sha> main` to detect "phase merged on main" without depending on the
     PR title or commit-subject grep. -->


## What Was Built

| Artifact | Status | Notes |
| -------- | ------ | ----- |
|          |        |       |

## Status

<!-- One of: completed | partial | blocked. Do NOT write "completed" if any smoke failed or any AC is unmet. -->

**completed**

## Risks

<!-- Risks discovered during execution that the next phase or reviewer should know about.
     Empty list is fine if nothing surfaced. Format: one bullet per risk. -->

- (none)

## Recommendations

<!-- What the executor recommends as the next action, based on what was learned during execution.
     This helps the orchestrator decide the next step without re-reading the full SUMMARY. -->

- Proceed to next phase

## Deviations

<!-- R1-R4 tracking -->

| #   | Type               | Description | Action taken         |
| --- | ------------------ | ----------- | -------------------- |
|     | R1 (minor bug)     |             | Fixed automatically  |
|     | R2 (missing piece) |             | Added                |
|     | R3 (arch change)   |             | STOPPED, asked human |
|     | R4 (out of scope)  |             | Logged in seeds/     |

## Decisions Made

<!-- Non-obvious choices during execution. Format: "Chose X over Y because Z" -->

## Smoke Results

<!-- MANDATORY. One row per PLAN.md `## Smoke` line, in the same order.
     Status values: pass | fail | skipped.
     The executor MUST NOT write this section claiming `pass` if a smoke
     actually failed. Fail-on-fail is enforced by scripts/scope-check.mjs. -->

| Command | Expected | Observed | Status |
| ------- | -------- | -------- | ------ |
|         |          |          |        |

## Tests

<!-- Actual test output, not assertions -->

```
{{TEST_OUTPUT}}
```

## Agent Context

<!-- What a future agent in a fresh context needs to know about this phase's outputs.
     Write this as if briefing a new developer who has never seen the project. -->

### New public APIs

<!-- Functions, components, or routes now available for other modules to use.
     Format: `functionName(params)` from `import/path` -->

### Changed interfaces

<!-- Types, props, or schemas that changed shape. Breaking changes get !! prefix.
     Format: `TypeName` - what changed -->

### New env vars

<!-- Any new environment variables this phase requires.
     Format: `VAR_NAME` - what it's for, where to get it -->

### Wiring notes

<!-- How this phase's outputs connect to the rest of the app.
     Barrel exports added, routes registered, events emitted, etc. -->

## Next

<!-- What should happen after this phase? -->

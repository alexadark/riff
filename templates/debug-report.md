# Debug Report

## Failure type

[executor_fail / test_fail / adversarial_fail / security_fail / user_reported]

## Dispatch tier

[normal / high / max] — [resolved via: --tier flag / auto-mapping / profile default]

## Triage tier

[Escalate / Standard / Routine / Trivial] — [justification]

## Root cause

[The actual underlying problem, with evidence from the code]

## Evidence

[Exact errors, stack traces, relevant code snippets]

## Hypotheses tested

1. [Hypothesis] — [Confirmed / Ruled out / Inconclusive]
2. [Hypothesis] — [Result]

## Fix

[What changed and why it addresses the root cause]

Files changed:

- [file:lines]

Delegated fixes:

<!-- One row per fix-plan entry (agents/debugger.md § Step 4, stage 4.2). Worker = resolved
`debugger.delegation.mechanical_worker` (default sonnet), or `debugger (direct)`
when the fallback path applied the fix without a worker. -->

| Fix | Worker | Commit | Checks |
| --- | ------ | ------ | ------ |
| [one-line fix description] | [sonnet / opus / fable / debugger (direct)] | [hash] | [tsc / biome / tests — pass or fail each] |

## Verification

[Test output / evidence the original issue is resolved]

## Status

[RESOLVED / UNRESOLVED]

<!-- If UNRESOLVED: explain exactly what is known, what was ruled out, and what the next investigator needs to know. -->

## Visual evidence

<!--
Frontend failures only (see agents/debugger.md § Step 4b). Three forms:

1. Captured — include all three subsections below.
2. Skipped — replace this whole section with a single line: `Visual evidence: skipped — <reason>`.
3. Not applicable (backend-only failure) — omit this section entirely.
-->

Screenshot: `.planning/phases/N-slug/debug-screenshots/<ISO-timestamp>.png`

Console transcript:

```
[full console output, all levels, no truncation]
```

Network errors:

- `<METHOD> <url> → <status>`

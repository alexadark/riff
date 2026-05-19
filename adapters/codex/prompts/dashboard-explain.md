# RIFF Adapter Prompt — dashboard-explain

Produce a human-readable explanation of the current project or phase state suitable for
the RIFF dashboard. Write a plain-language description at the audience level set in
`profile.yaml` and save it to `.planning/phases/<N-slug>/dashboard-explanation.json`
(or `.planning/dashboard-explanation.json` for a project-level overview).

## Artifact contract

`core/schemas/phase-artifacts.md` and `core/protocols/dashboard.md` define the
`dashboard-explanation.json` schema. Read both before writing.

## Inputs to read

- `profile.yaml` — read `style.explanation_level` (technical / simple / eli5)
  and `user.narrative_language` or `user.conversational_language` for the output language
- ROADMAP.yaml — current phase status and overall progress
- STATE.md — active phase and recent decisions
- `.planning/phases/<N-slug>/SUMMARY.md` if explaining a specific phase
- `.planning/phases/<N-slug>/PLAN.md` if the phase has not yet executed (pre-execution explain)

## What to produce

A JSON object per `core/protocols/dashboard.md`. At minimum:

```json
{
  "phase": "<N-slug or project>",
  "level": "<technical|simple|eli5>",
  "language": "<en|fr>",
  "generated_at": "<ISO-8601>",
  "summary": "<plain-language explanation>",
  "status": "<pending|in-progress|done>",
  "next_action": "<one-line description of what runs next>"
}
```

Audience level vocabulary:
- **technical** — name functions, types, files, paths, libs when they matter. ~5-10 lines.
- **simple** — plain words, replace tech terms with what they mean. Concrete examples. ~3-7 lines.
- **eli5** — one analogy if it helps, zero tech vocabulary, user-visible outcome only. 2-4 sentences.

Style for all levels: no filler, no marketing words, no transitions. One idea per sentence.

## Stop conditions

Stop before writing the JSON and report when:

- `profile.yaml` is missing and no fallback level can be inferred from context
- Neither SUMMARY.md nor PLAN.md exists for the requested phase

## Output rule

Write only the `dashboard-explanation.json` file at the path appropriate for the context
(phase-level or project-level per the context pack). Do not write any other file.

# Opus Capability: Critical Phase Planning

You are acting as a manual RIFF escalation planner for one critical phase.

Goal:

- Produce content that can become `.planning/phases/<phase>/PLAN.md`.
- Make the plan executable by a fresh senior executor without requiring architectural invention during execution.
- Keep context use minimal and explicit.

Output:

- Return a complete `PLAN.md` draft for exactly one phase.
- Start directly with the `# Phase <id> - <title>` heading.
- Do not include a conversational preamble, assumptions outside the plan, code fences around the whole answer, or a follow-up question asking whether to write files.
- Use these sections:
  - `# Phase <id> - <title>`
  - `## Goal`
  - `## Scope`
  - `## Observable Truths`
  - `## Required Artifacts and Wiring`
  - `## Waves`
  - `## Tasks`
  - `## Acceptance Criteria`
  - `## Dependencies`
  - `## Risks`
  - `## Security and Documentation`
  - `## Gate Expectations`
  - `## Smoke`
  - `## Next Manual Step`

Planning rules:

- Plan only the selected phase.
- Name exact file boundaries for each task.
- Include acceptance criteria that can be verified with commands, artifact checks, or direct inspection.
- Include smoke commands with observable expected results.
- Preserve production gates unless the prompt context says the project is scratch scope.
- Stop and ask for a human decision if the work requires an unapproved architecture change.
- Use Opus only as optional escalation; do not require hidden automation or provider-specific core behavior.
- Do not add provider-specific requirements to core artifacts.

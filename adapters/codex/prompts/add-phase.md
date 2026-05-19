# RIFF Adapter Prompt — add-phase

Append one or more new phase entries to ROADMAP.yaml based on the provided input.
Never plan or execute the new phase in the same invocation. Validate the roadmap after
writing. Create the phase directory. Update STATE.md if it has a roadmap section.

## Artifact contract

`core/schemas/phase-artifacts.md` defines the required ROADMAP.yaml phase fields.
Read it before writing.

## Inputs to read

- ROADMAP.yaml — find the highest existing phase ID; understand current structure and deps
- STATE.md — update the roadmap section if one exists
- Input provided in the context pack: phase name, goal, tasks, priority, mode, depends_on

## Required fields per phase entry

```yaml
- id: <N>
  slug: <kebab-case>
  title: <human-readable title>
  status: todo
  priority: <P0|P1|P2|P3>
  mode: <HITL|AFK|tdd>
  depends_on: [<dep IDs>]
  goal: |
    <multi-line goal>
  tasks:
    - <task 1>
    - <task 2>
```

Optional fields: `description`, `references`, `notes`, `constraints`, `provider_mode`.

## Rules

- Never renumber existing phases. Use `depends_on` for ordering.
- `slug` must be kebab-case (lowercase letters, digits, hyphens only).
- `title` is human-readable. Never use a phase-level `name:` field (validator rejects it).
- Default `mode: AFK`. Mark `mode: HITL` only for unavoidable manual human verification:
  real OAuth/SSO against a production IdP, real payment checkout, MFA, DNS cutover,
  irreversible migrations.
- Set `provider_mode: sandbox` when the phase touches an external provider via
  sandbox/test credentials only. Omit otherwise (defaults to `production`).
- Default `priority: P1`.
- YAML safety: task strings must not contain unescaped `"`, `'`, `:` followed by space,
  `#`, or backticks. Wrap special-char strings in single quotes.

## Steps

1. Determine the new phase ID (next integer after highest existing; user override wins).
2. Validate `depends_on` references exist in ROADMAP.yaml.
3. Append the phase entry to ROADMAP.yaml.
4. Run `bash .riff/lib/validate-roadmap.sh ROADMAP.yaml`. Fix any error before proceeding.
   Do not continue with an invalid roadmap.
5. Create directory `.planning/phases/<NN>-<slug>/` (empty, ready for PLAN.md).
6. Update STATE.md roadmap section if one exists.

## Stop conditions

Stop before writing and report when:

- The input does not provide a clear phase goal
- A `depends_on` reference does not exist in ROADMAP.yaml
- The roadmap validator reports an error that cannot be auto-fixed

## Output rule

Write ROADMAP.yaml (append new entry), create the phase directory, and update STATE.md
if applicable. Do not write PLAN.md or execute any work for the new phase.

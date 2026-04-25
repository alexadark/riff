---
description: Add one or more phases to the roadmap
allowed-tools: Read, Write, Edit, Bash, Glob, AskUserQuestion
args: "[name] [goal]"
---

# /riff:add-phase

Append phases to ROADMAP.yaml. No renumbering — use `depends_on` for ordering.

## What you do

1. **Read state:** ROADMAP.yaml — find highest phase ID, understand current structure.
2. **Gather input:** use args if provided, else ask: name, goal, tasks, priority, mode, depends_on. For batch adds (multiple phases), accept a list and process all.
3. **Determine ID:** next integer after highest existing. User-provided ID wins (decimals OK for hotfixes, e.g. `86.5`).
4. **Append to ROADMAP.yaml:**

   ```yaml
   - id: { N }
     name: { slug }
     status: todo
     priority: { high|medium|low }
     mode: { HITL|AFK|tdd }
     depends_on: [{ dep IDs }]
     goal: |
       {multi-line goal}
     tasks:
       - { task 1 }
       - { task 2 }
   ```

   Optional fields: `references`, `notes`, `constraints`.

5. **Create phase directory:** `.planning/phases/{NN}-{slug}/` (empty, ready for PLAN.md).
6. **Update STATE.md:** add phase to the roadmap section if one exists.
7. **Confirm:** show phase ID, name, depends_on chain.

## Rules

- Never renumber existing phases — RIFF uses `depends_on` graphs.
- Don't touch ROADMAP.md (human-facing historical record, updated separately).
- Validate `depends_on` references exist in ROADMAP.yaml.
- Default `mode: AFK`. Mark `mode: HITL` only for unavoidable manual human verification (OAuth/SSO browser flow, real payment checkout, public API breaking change, DNS/prod cutover, irreversible migrations).
- Default `priority: medium`.
- **YAML safety:** task strings must not contain unescaped `"`, `'`, `:` followed by space, `#`, or backticks. Wrap special-char strings in single quotes; use `''` to escape a literal single quote. Prefer plain rewording over quoting (e.g. "do not" instead of "don't").

## Tips

- Insert between phases: set `depends_on` correctly. Phase 86.5 depending on 86 runs before 87.
- Remove a phase: edit ROADMAP.yaml, set `status: skipped`.
- Reorder: change `depends_on` chains.

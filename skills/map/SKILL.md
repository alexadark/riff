---
name: map
description: Map an existing codebase into RIFF planning artifacts. Use only when the user explicitly asks RIFF to map or onboard a brownfield project.
---

# RIFF Map

Map the existing project without changing product behavior.

1. Resolve the Git root and require its `.riff` link. Read existing RIFF
   artifacts before deciding what must be created or refreshed.
2. Inventory the stack, entry points, routes, modules, data boundaries, external
   services, tests, delivery configuration, and repository conventions. Use
   small independent read-only explorations when the repository is large.
3. Produce `.planning/architecture.md` with a one-line product explanation,
   stack summary, architecture map, critical modules, entry points, data flow,
   dependencies, and two or three useful Mermaid diagrams.
4. Produce `.planning/risks.md` with evidence-backed technical debt, security,
   migration, and operational risks. Do not fix findings during mapping.
5. Update `PROJECT.md` with observed product purpose, users, current features,
   stack, constraints, and exclusions. Distinguish observed facts from
   assumptions requiring user confirmation.
6. Extract stable conventions into `taste.md`. Create one focused specification
   under `.planning/specs/` for each major module unless the user requested a
   quick map.
7. When applicable, draft `.uxtest/flows.yaml` from routes and integrations.
   Never overwrite an existing flow manifest without presenting the additions
   and changes for user confirmation.
8. Present the map and unresolved assumptions. Apply corrections, then update
   `STATE.md` to say the codebase is mapped and ready for phase planning.
9. Do not create or rewrite `ROADMAP.yaml` unless the user explicitly asks for a
   roadmap after reviewing the map. Use `$riff:phase` to add approved phases.

Do not edit application code, commit, merge, deploy, or promote.

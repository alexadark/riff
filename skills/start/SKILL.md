---
name: start
description: Start RIFF discovery and create a validated single-project roadmap. Use only when the user explicitly asks to start or initialize RIFF product planning.
---

# RIFF Start

Create the planning foundation for one project. Do not write product code.

1. Resolve the Git root and require the project-local `.riff` link. If RIFF is
   not installed, stop and tell the user to run `riff init` first.
2. Inspect the repository before asking questions. Classify it as greenfield,
   starter, or brownfield. For a substantial brownfield project, offer
   `$riff:map` before generating a new roadmap.
3. Ask what the user wants to build, then resolve only material ambiguity about
   the goal, users, essential workflows, constraints, success, and exclusions.
   Reuse answers already present in repository artifacts or the conversation.
4. Confirm `scratch` or `production` scope. Preserve an existing explicit scope
   unless the user changes it. Write it to `.planning/config.json` without
   discarding unrelated keys.
5. Create `PROJECT.md` in English with the agreed problem, users, scope,
   essential features, stack, constraints, and out-of-scope items.
6. For production web applications, create only the applicable design records
   under `.planning/design/`: pages and flows, data model, and architecture.
   Keep scratch discovery lighter.
7. Create `ROADMAP.yaml` as vertical product slices. Phase 1 must prove an
   end-to-end path. Every phase needs `id`, `slug`, `title`, `status: todo`,
   `priority`, `mode`, `depends_on`, `goal`, and concrete `tasks`.
8. Default phases to `mode: AFK`. Use `mode: HITL` only for unavoidable visual
   or functional verification against a real surface, destructive operations,
   or promotion. Security, authentication, payment, and authorization code work
   remains AFK and is checked by the final security gate.
9. Keep dependencies explicit and limit the initial roadmap to the smallest
   coherent v1. Add consequence notes only where a decision creates a real
   downstream risk.
10. Run `<git-root>/.riff/lib/validate-roadmap.sh <git-root>/ROADMAP.yaml` and
    fix every error. Create `.planning/phases`, `.planning/sessions`, `STATE.md`,
    and the production-only bootstrap artifacts that are missing. Preserve all
    existing user content.
11. Finish with the phase count, first ready phase, configured runtime provider,
    and the exact next command: `riff wave --autonomous` or
    `riff wave --autonomous --loop`.

Do not commit, merge, deploy, promote, or start implementation.

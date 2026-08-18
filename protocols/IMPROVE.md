# IMPROVE

This protocol extracts durable expertise proposals from a completed phase. It writes to `.planning/expertise/.pending/` for human review and never merges a proposal.

The canonical expertise targets are `planner`, `worker`, and `security-reviewer`.

## Inputs

- `.planning/phases/<phase>/SUMMARY.md`
- `.planning/phases/<phase>/REVIEW.md`, when present
- `.planning/expertise/planner.md`, `.planning/expertise/worker.md`, and `.planning/expertise/security-reviewer.md`, when present
- `.planning/expertise/executor.md` as an optional compatibility input only when `.planning/expertise/worker.md` is absent
- Matching RIFF framework references under `references/taste/`

## Steps

1. Read the completed phase summary and review. Read existing expertise and matching framework references before proposing anything.
2. For each canonical agent that ran, `planner`, `worker`, or `security-reviewer`, identify surprising success, recurring failure, or a lesson that a fresh-context agent would need. Ignore one-off friction and routine success. Treat legacy `executor` expertise as the worker input only when `worker.md` is absent.
3. Check whether the phase exposed a missing RIFF command, protocol, or documentation rule. Treat a genuine framework gap as a separate proposal.
4. Write one pending file per canonical agent with a real lesson. Use `planner`, `worker`, or `security-reviewer` in proposal filenames and headings. A legacy executor run still writes the canonical worker proposal filename:

   `.planning/expertise/.pending/worker-<phase>.md`

   For framework gaps, write:

   `.planning/expertise/.pending/framework-<phase>.md`

5. Use one block per proposal:

   ```markdown
   ### [phase-N] Short title

   - **Tier:** STACK:<name> | ARCHITECTURE | PROJECT
   - **What happened:** concrete situation with file or error
   - **Lesson:** what to repeat or change
   - **Impact:** HIGH | MEDIUM | LOW

   **Justification:** why this belongs in expertise
   ```

6. Assign the tier before writing. Use `STACK:<name>` for stack-specific lessons, `ARCHITECTURE` for reusable design or security lessons, and `PROJECT` for project-specific paths or provider behavior. Use `PROJECT` when uncertain.
7. Reject duplicates found in the phase expertise or framework references. Never edit those source files directly.
8. Write the completion sentinel as the final action, even when no proposal exists:

   `.planning/expertise/.pending/.improver-<phase>.done`

   Use this JSON shape:

   ```json
   {
     "schema_version": 1,
     "phase": "<phase>",
     "completed_at": "<ISO-8601 timestamp>",
     "patterns_written": 0,
     "files_written": []
   }
   ```

   Set `patterns_written` to the total proposal count. Set `files_written` to basenames written during this run.

## Boundaries

- Write proposals only under `.planning/expertise/.pending/`.
- Never edit `.planning/expertise/<agent>.md` or any framework reference.
- Never auto-merge, auto-promote, or apply a proposal.
- Never log routine successes or invent a lesson when nothing useful surfaced.
- Keep one file per agent per phase. Multiple proposal blocks may share that file.
- The human reviews every pending proposal after the phase.

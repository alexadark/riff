# INCIDENT LOG

This protocol records one production failure in the project root `INCIDENTS.md`. Logging is append-only and never performs incident review.

## When to read this protocol

Read it when the user says "log incident", "log this as an incident", or "production bug". Do not read it for "incident review" or "quarterly incident review".

## Steps

1. Locate `INCIDENTS.md` at the project root. If it is missing, copy `.riff/templates/INCIDENTS.md` into place.
2. Ask one question at a time for:
   - The shipped phase number and slug, read from `ROADMAP.yaml` when possible.
   - Miss type: `security-reviewer`, `adversarial-reviewer`, `taste rule`, `test gap`, `external API change`, or `other`.
   - Severity: `critical`, `high`, `medium`, or `low`.
   - What happened, in 2 to 3 sentences.
   - Root cause, in 1 to 2 sentences.
   - The prevention rule, taste section, agent prompt, or hook that should have caught it.
   - A short title for the entry.
3. Append this entry at the bottom of `INCIDENTS.md` using today's UTC date:

   ```markdown
   ## YYYY-MM-DD: <short title>

   - **Phase:** <N> (<slug>)
   - **Miss type:** <type>
   - **Severity:** <severity>
   - **What happened:** <text>
   - **Root cause:** <text>
   - **Prevention rule:** <text>
   ```

4. Print the inserted entry to confirm the append.

## Rules

- Log one incident per session.
- Append only. Never delete, rewrite, refine, or deduplicate an earlier entry.
- Neither logging nor incident review edits earlier ledger entries.

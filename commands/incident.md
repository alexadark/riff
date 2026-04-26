---
description: Log a production incident for later framework review
allowed-tools: Read, Write, Edit, AskUserQuestion, Bash
---

# /riff:incident

Append a structured entry to `INCIDENTS.md` so the next quarterly review can translate it into framework rules.

## Steps

1. **Locate ledger.** If `INCIDENTS.md` does not exist at the project root, copy `.riff/templates/INCIDENTS.md` into place.

2. **Gather details via AskUserQuestion** (one question at a time, free-form where useful):
   - Phase number and slug that shipped the bug (read from `ROADMAP.yaml` so it's a known value).
   - Miss type: `security-reviewer` | `adversarial-reviewer` | `taste rule` | `test gap` | `external API change` | `other`.
   - Severity: `critical` | `high` | `medium` | `low`.
   - What happened (2-3 sentences).
   - Root cause (1-2 sentences).
   - Prevention rule: which `taste.md` section, agent prompt, or hook would have caught this.
   - Short title for the entry (one line).

3. **Format and append** at the BOTTOM of `INCIDENTS.md`:

   ```markdown
   ## YYYY-MM-DD — <short title>

   - **Phase:** <N> (<slug>)
   - **Miss type:** <type>
   - **Severity:** <severity>
   - **What happened:** <text>
   - **Root cause:** <text>
   - **Prevention rule:** <text>
   ```

   Use today's date (UTC).

4. **Confirm** by printing the inserted entry back to the user.

## Notes

- One incident per invocation. Multiple incidents = multiple invocations.
- Do NOT delete or rewrite earlier entries here. The ledger is append-only. Quarterly review (`/riff:incident-review`) is where edits happen.

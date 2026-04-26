---
description: Quarterly review of INCIDENTS.md, propose framework changes
allowed-tools: Read, Write, Edit, Glob, Grep, Bash
---

# /riff:incident-review

Read `INCIDENTS.md`, group by miss type, propose concrete additions to `taste.md`, new adversarial-reviewer triggers, and new test patterns. Output is a draft, not an applied change.

## Steps

1. **Read** `INCIDENTS.md` at the project root. If empty or missing, STOP and tell the user the ledger has nothing to review.

2. **Group entries by miss type** (`security-reviewer`, `adversarial-reviewer`, `taste rule`, `test gap`, `external API change`, `other`). Within each group, sub-group by severity.

3. **Propose framework changes**, one section per miss type:
   - **For `security-reviewer` misses:** new `taste/security.md` rules, new auto-trigger heuristics in `commands/next.md` Step 7.
   - **For `adversarial-reviewer` misses:** new auto-trigger paths in `commands/next.md` Step 6 (`auto` heuristics list).
   - **For `taste rule` misses:** new entries in the relevant `taste/<topic>.md` topic file.
   - **For `test gap` misses:** new test patterns to add to `taste/testing.md`, plus stack-specific reference files.
   - **For `external API change` misses:** new entries in `taste.md` calling out the API + version + the lesson.

4. **Write** the draft to `.planning/incident-review-YYYY-MM-DD.md` (UTC date) with this structure:

   ```markdown
   # Incident Review — YYYY-MM-DD

   Reviewed N entries from INCIDENTS.md.

   ## Summary by miss type
   ...

   ## Proposed taste.md additions
   ...

   ## Proposed adversarial-reviewer triggers
   ...

   ## Proposed test patterns
   ...

   ## Apply checklist
   - [ ] Append to taste/security.md
   - [ ] ...
   ```

5. **Print** the path to the draft and remind the user to review and apply manually. Do NOT apply changes automatically.

## Notes

- Run quarterly. Cadence is enforced manually for now.
- Do not modify `INCIDENTS.md`. The ledger is append-only.
- Keep proposals concrete: each must name the file, section, and exact text to add.

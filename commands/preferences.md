---
description: Re-answer one or more onboarding questions to update profile.yaml in place
allowed-tools: Read, Write, AskUserQuestion, Bash
---

# /riff:preferences

Targeted re-answer flow for `profile.yaml`. Pick which questions to change, answer them, write back. Keeps unchanged fields as-is. Use this instead of `/riff:onboard` when you want to change one or a few values without re-walking all 13 questions.

## How it works

- Reads the existing `profile.yaml` at the framework root.
- Shows current values. User picks which ones to re-answer (multiSelect).
- Walks only the picked questions via AskUserQuestion.
- Writes the updated `profile.yaml`. Backs up the previous file to `profile.yaml.bak`.

## Steps

1. **Locate profile.** Run `git rev-parse --show-toplevel` from this command's directory. Profile path = `<root>/profile.yaml`. If missing, print `profile.yaml not found at <root>. Run /riff:onboard first.` and exit.

2. **Read current profile.** Parse the YAML. Keep the full document in memory so unchanged fields survive the rewrite.

3. **Offer the 13 questions with current values.** AskUserQuestion with `multiSelect`. Label each option as `Q<n>: <topic> (current: <value>)`. Array fields (Q3 domains, Q5 side_activities) display comma-joined.

   Questions (in order):

   | ID | Field | Topic |
   | -- | ----- | ----- |
   | Q1 | `user.programming_level` | Programming level |
   | Q2 | `user.ai_agents_experience` | AI agents experience |
   | Q3 | `user.domains` | Primary domain(s) [multiSelect] |
   | Q4 | `user.work_mode` | Work mode |
   | Q5 | `user.side_activities` | Side activities [multiSelect] |
   | Q6 | `user.parallel_projects` | Parallel projects |
   | Q7a | `user.conversational_language` | Conversational language |
   | Q7b | `user.artifact_language` | Artifact language |
   | Q8 | `risk.sensitive_task_preference` | Sensitive tasks |
   | Q9a | `style.length` | Message length |
   | Q9b | `style.allow_jargon` | Jargon policy |
   | Q10 | `style.when_uncertain` | When uncertain |
   | Q11 | `budget.default_quality` | Budget and quality |
   | Q12 | `notifications.channel` | Notifications channel |

4. **Walk picked questions.** For each selected question, ask via AskUserQuestion using the exact options defined in `commands/onboard.md` § Questions. Q3 and Q5 use `multiSelect`. Q7a, Q7b, Q12 accept `other` with a free-form follow-up.

5. **Write profile.yaml.**
   - Copy current `profile.yaml` to `profile.yaml.bak` first.
   - Overwrite only the selected fields. Leave all others untouched.
   - Preserve the schema shape defined in `commands/onboard.md` § Profile schema.

6. **Report changes.**

   ```
   Updated profile.yaml at <root>/profile.yaml.

   Changed:
     - <field>: <old> → <new>
     - ...

   Backup: profile.yaml.bak
   ```

   If no questions were selected, print `No changes made.` and exit without writing.

## Notes

- For a full re-walk of all 13 questions, run `/riff:onboard` instead — it backs up and replaces the full file.
- Per-project budget override lives in the project's `ROADMAP.yaml` (`budget_quality:`). This command does not touch project-level config, only the global profile.
- Agents re-read `profile.yaml` on every run, so changes take effect on the next agent invocation without restart.

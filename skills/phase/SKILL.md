---
name: phase
description: List, add, or update RIFF roadmap phases through the validated project-local CLI. Use only when the user explicitly asks to manage RIFF phases.
---

# RIFF Phase

Use the deterministic project-local phase manager.

1. Resolve the Git root and require `<git-root>/.riff/riff`.
2. Choose the operation explicitly requested:
   - List: `<git-root>/.riff/riff phase list --project-root <git-root>`.
   - Add: `<git-root>/.riff/riff phase add --title <title> --goal <goal>` and
     repeat `--task <task>` as needed. Pass `--depends-on <ids>`, `--priority`,
     `--mode`, or `--id` only when specified or clearly established.
   - Change lifecycle status: `<git-root>/.riff/riff phase set-status --id <id>
     --status <todo|in-progress|done|blocked|skipped>`.
3. Default new phases to `P2` and `AFK`. Use HITL only for real visual or
   functional verification, destructive operations, or promotion. Ordinary
   security-sensitive implementation stays AFK.
4. Return the resulting phase identity and status. Do not edit ROADMAP.yaml
   directly after the CLI succeeds.

The CLI validates the complete roadmap and rolls back an invalid edit. It never
renumbers phases or runs product work.

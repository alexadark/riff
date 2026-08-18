---
name: status
description: Show authoritative RIFF project, roadmap, active wave, and native-stage status. Use only when the user explicitly asks for RIFF status.
---

# RIFF Status

1. Resolve the project Git root and require `<git-root>/.riff/riff`.
2. Run `<git-root>/.riff/riff status --project-root <git-root>`.
3. Return its progress, current and ready phases, human-verification boundary,
   active wave, latest native stage, pending items, and recommended next action.
4. Use `--json` only when structured output is requested.

Do not infer state from conversation history and do not mutate project files.

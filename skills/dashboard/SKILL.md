---
name: dashboard
description: Start, attach to, or stop the local RIFF project dashboard. Use only when the user explicitly invokes the RIFF dashboard.
---

# RIFF Dashboard

1. Resolve the project Git root and require `<git-root>/.riff/riff`.
2. Start or attach with `<git-root>/.riff/riff dashboard` from the Git root.
3. Stop only when explicitly requested, using `<git-root>/.riff/riff dashboard
   --stop`.
4. Return the project dashboard URL or the stop result exactly as reported.

The dashboard is read-only. Never translate a dashboard request into phase
execution, promotion, deployment, or a server restart that the CLI did not
request.

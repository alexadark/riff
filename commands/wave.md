---
description: Run or resume a native autonomous single-project roadmap wave
allowed-tools: Bash, Read
args: "[--autonomous] [--loop] [--phases ids] [--resume] [--approve --run id --phase id --evidence note] [--status]"
---

# /riff:wave

Use the native RIFF wave engine. This Claude command is a thin adapter over the
same project-local CLI used by Codex.

## Procedure

1. Resolve the Git root with `git rev-parse --show-toplevel`.
2. Require `<git-root>/.riff` to be a framework symlink.
3. Translate the explicit command arguments without changing their meaning:
   - `/riff:wave --autonomous` runs one ready dependency frontier.
   - `/riff:wave --autonomous --phases 1,2` runs that requested phase set.
   - `/riff:wave --autonomous --loop` continues through newly unlocked
     frontiers until the roadmap is dry or a real stop condition is reached.
   - `/riff:wave --resume` resumes the active persisted run.
   - `/riff:wave --approve --run W-... --phase ID --evidence "Checked: <scope>; Observed: <result>; Expected: <expected result>"` records a completed human verification and automatically continues that run.
   - `/riff:wave --status` reports the active run and resume command.
4. Run `<git-root>/.riff/riff wave --project-root <git-root> <arguments>`.
5. Return the engine's final state, stop reason, and exact approval or resume command.

Do not substitute the retired external executor, pasted bundle, branch merge,
or reconcile workflow. The native engine invokes `riff next` for every roadmap
phase, resolves the configured provider once per stage, and pauses neither for
ordinary work nor for security-sensitive implementation.

Security hooks run once after product phases. Human confirmation is reserved
for explicitly marked visual or functional verification, destructive
boundaries, and promotion. A pending boundary has an immutable request; provide
`Checked: <scope>; Observed: <result>; Expected: <expected result>` through `--approve` rather than a separate
manual resume. No commit, merge, deployment, or promotion is implicit.

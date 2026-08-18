---
description: Reconcile RIFF-owned skills, adapters, commands, and hooks after framework updates
allowed-tools: Bash
---

# /riff:resync

Delegate to the canonical project-local RIFF CLI. The CLI reconciles RIFF-owned Claude and Codex runtime files and preserves unowned collisions.

## When to run

- A `git pull` brought new agent or command files into the framework (e.g. `agents/deep-auditor.md`)
- The framework removed a command and you have orphan symlinks (e.g. `check.md`, `review-expertise.md`)
- You suspect CLAUDE.md drift between the project copy and the framework

Idempotent. Safe to run anytime.

## What You Do

Run the project-local CLI from the Git root:

```bash
./.riff/riff resync
```

Return the CLI output without retrying or invoking `riff-resync.sh` directly.

## Bootstrap (first time)

If `/riff:resync` is not visible, run the CLI directly from the project root:

```bash
./.riff/riff resync
```

The CLI installs the active resync skill and command links, so subsequent explicit invocations work through the runtime surface.

## Anti-patterns

- Don't invoke `riff-resync.sh` directly.
- Don't edit runtime links or materialized adapters yourself.
- Don't retry after a fail-closed collision or boundary error.

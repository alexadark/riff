---
description: Sync framework symlinks and surface CLAUDE.md drift after framework updates
allowed-tools: Bash
---

# /riff:resync

Re-create per-file symlinks from `.riff/` into `.claude/{commands,agents,hooks}/riff/`. Cleans up dangling links from removed framework files. Surfaces conversational trigger rows in framework `CLAUDE.md` that are missing from the project's own `CLAUDE.md`.

## When to run

- A `git pull` brought new agent or command files into the framework (e.g. `agents/deep-auditor.md`)
- The framework removed a command and you have orphan symlinks (e.g. `check.md`, `review-expertise.md`)
- You suspect CLAUDE.md drift between the project copy and the framework

Idempotent. Safe to run anytime.

## What You Do

Run the bootstrap script:

```bash
bash .riff/riff-resync.sh
```

The script:

1. Re-creates missing/incorrect symlinks for `.riff/agents/*.md`, `.riff/commands/*.md`, `.riff/hooks/*.sh` (excluding `security-scan.sh` and `commit-msg.sh` which live in `.git/hooks/`).
2. Removes dangling symlinks from `.claude/{commands,agents,hooks}/riff/`.
3. Surfaces (does NOT auto-apply) trigger phrases present in `.riff/CLAUDE.md` § Conversational triggers but missing from the project's `CLAUDE.md`. The user copies the relevant rows manually.

After the script completes, paste its output back to the user. If drift is reported, ask whether to patch the project's `CLAUDE.md` with the missing rows from `.riff/CLAUDE.md`.

## Bootstrap (first time)

If `/riff:resync` is not visible (i.e., `.claude/commands/riff/resync.md` doesn't exist yet), run the script directly from the project root:

```bash
bash .riff/riff-resync.sh
```

The script creates the `resync.md` symlink at the same time as everything else, so subsequent runs work via `/riff:resync` or the `"resync riff"` conversational trigger.

## Anti-patterns

- Don't auto-patch the project's `CLAUDE.md` — surface drift, let the user choose. Project CLAUDE.md may have project-specific drift that shouldn't be overwritten.
- Don't symlink `security-scan.sh` or `commit-msg.sh` into `.claude/hooks/riff/` — those go to `.git/hooks/` per `commands/init.md`.
- Don't delete a `.claude/{commands,agents,hooks}/riff/` directory wholesale — only remove dangling individual links.

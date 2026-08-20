# RIFF hooks

Hooks are supplementary local safeguards. The native stage runner does not rely on them for its plan validation, evidence snapshots, scope enforcement, or completion state; those controls are defined in `protocols/RIFF-NEXT.md`.

`riff init` installs deterministic dispatchers in Git's effective hooks directory. Run `riff resync` after framework updates. A foreign hook is preserved as `<event>.user` and runs before RIFF; resync replaces only the managed dispatcher. Project-local `core.hooksPath` and linked-worktree common Git directories are honored. Paths outside the project and Git common directory are rejected.

## Git hooks

`security-scan.sh` is the pre-commit entry point. It invokes the repository checks that match staged files, including secret detection, boundary-oriented warnings, orphan-file checks, registry reminders, and migration checks where configured. `commit-msg.sh` is a no-op compatibility hook.

The effective entries are:

```text
<effective-hooks-directory>/pre-commit
<effective-hooks-directory>/commit-msg
```

Git hooks may block an unsafe commit or emit a warning. Native action and phase evidence commits keep normal Git verification enabled and require nonce-bound receipts from both entries. Manual commits run the same chain without runner receipts.

## Phase PR preparation hooks

Paths in `.planning/config.json` `hooks` run again with `RIFF_EVENT=phase_pr_prepare` after end-only wave security and before pull-request creation. Exit `0` passes, exit `2` warns, and every other exit blocks the PR. RIFF captures stdout and stderr plus their hashes in a wave preparation receipt and includes the result in the detailed PR body.

## Notification helper

`notify-human.sh "<message>"` sends a best-effort notification using the resolved profile. A missing or invalid notification configuration warns and returns successfully, so it cannot create a false stage failure.

## Legacy Claude command workflow

`riff init` materializes Claude runtime links under `.claude/`, including command-era session hooks and settings templates. Those hooks are not native `riff next` controls. In particular, do not assume a session-start, pre-compact, or post-edit hook supplies stage boundaries or authorizes a native transition.

For the native workflow, use `docs/RIFF-MANUAL.md` and `protocols/RIFF-NEXT.md`.

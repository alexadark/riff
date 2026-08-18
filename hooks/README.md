# RIFF hooks

Hooks are supplementary local safeguards. The native stage runner does not rely on them for its plan validation, evidence snapshots, scope enforcement, or completion state; those controls are defined in `protocols/RIFF-NEXT.md`.

`riff init` installs the deterministic Git hooks it owns and preserves collisions. Run `riff resync` after framework updates to reconcile RIFF-owned links without replacing unowned project configuration.

## Git hooks

`security-scan.sh` is the pre-commit entry point. It invokes the repository checks that match staged files, including secret detection, boundary-oriented warnings, orphan-file checks, registry reminders, and migration checks where configured. `commit-msg.sh` is a no-op compatibility hook.

The installed paths are:

```text
.git/hooks/pre-commit
.git/hooks/commit-msg
```

Git hooks may block an unsafe commit or emit a warning. They do not prove a stage passed, and a warning must be evaluated with the stage evidence rather than ignored.

## Notification helper

`notify-human.sh "<message>"` sends a best-effort notification using the resolved profile. A missing or invalid notification configuration warns and returns successfully, so it cannot create a false stage failure.

## Legacy Claude command workflow

`riff init` materializes Claude runtime links under `.claude/`, including command-era session hooks and settings templates. Those hooks are not native `riff next` controls. In particular, do not assume a session-start, pre-compact, or post-edit hook supplies stage boundaries or authorizes a native transition.

For the native workflow, use `docs/RIFF-MANUAL.md` and `protocols/RIFF-NEXT.md`.

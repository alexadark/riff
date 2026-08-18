---
name: resync
description: Safely resynchronize a linked RIFF project only when explicitly invoked as `$resync` or `$riff:resync`.
---

# RIFF Resync

Run only when explicitly invoked as `$resync` in a project installation or `$riff:resync` in a namespaced plugin installation. Do not infer this action from a request to repair, refresh, reinstall, or update RIFF.

1. Resolve the current project Git root with `git rev-parse --show-toplevel`. Stop if it fails.
2. Require `<git-root>/.riff` to be a symbolic link that resolves to an existing framework directory. Stop if either condition is not met.
3. Require `<git-root>/.riff/riff` to be an executable regular file. Stop if it is absent or not executable.
4. From `<git-root>`, invoke the canonical project-local command: `<git-root>/.riff/riff resync`.
5. Return the command result without retrying, adding arguments, or changing project files yourself.

Do not invoke `riff-resync.sh` directly and do not duplicate its resync logic.

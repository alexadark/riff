# Security reconcile, wave W{N}

Findings flagged by RIFF security hooks while `scratch_mode` was active during
wave W{N}. Each entry was downgraded to a warning at write time, so the wave
shipped without blocking. The reconcile pass is owed before this code can be
promoted to production scope.

`/riff:promote` (and the conversational "promote to production" trigger) is
blocked while this file is non-empty. To clear it: fix each finding in the
code, then either delete this file entirely or move its remaining items into
ROADMAP.yaml as explicit phases.

## Findings

<!--
Auto-appended by scratch-mode hooks in the form:
  - [YYYY-MM-DD HH:MM:SS] **hook-name** `path/to/file.ts`: short message

Codex may also add `// TODO(security): <hook>: <message>` markers in the
flagged source files. Use `grep -rn "TODO(security)"` to find them when
working through this reconcile.
-->

## Resolution checklist

- [ ] Every finding above has been addressed in the code (fix, or marked as a
  deliberate exception with rationale)
- [ ] Every `// TODO(security)` marker added during the wave has been removed
  or converted to a tracked follow-up
- [ ] The matching hooks now pass on the same files without scratch mode
  (`unset RIFF_SCRATCH_MODE` and re-run them against the touched files)
- [ ] This file is empty (no remaining bullet under Findings) or deleted

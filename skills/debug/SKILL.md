---
name: debug
description: Diagnose one explicit RIFF project issue only when invoked as `$debug` or `$riff:debug`.
---

# RIFF Debug

Run only when explicitly invoked as `$debug` in a project installation or
`$riff:debug` in a namespaced plugin installation. Do not infer this action
from a request to fix, investigate, repair, or review.

1. Require an exact `--issue <text>` value. Accept optional `--intensity normal|high|max`.
2. Resolve the current Git root with `git rev-parse --show-toplevel`. Stop if it fails.
3. Require `<git-root>/.riff/riff` to be an executable regular file.
4. Invoke `<git-root>/.riff/riff debug --project-root <git-root> --issue <exact issue>`.
   Pass `--intensity` only when supplied. Pass a supported one-run provider
   override only when the user explicitly supplies it.
5. Return the runner result. Do not diagnose or implement the fix yourself.

The runner records read-only diagnostic evidence and, only for a validated
diagnosis, invokes exactly one bounded native stage. It never commits, merges,
deploys, promotes, or changes provider configuration.

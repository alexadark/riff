---
name: finish
description: >-
  Create and confirm a RIFF Git finish plan only when the user explicitly asks
  to finish, commit, open a PR, or merge a completed RIFF wave. Never invoke
  it implicitly or use it for deployment or promotion.
---

# RIFF Finish

Run this procedure only after an explicit user request. Work from the invoking
project's Git root and require its project-local `.riff` installation.

1. Run `<git-root>/.riff/riff finish --check --project-root <git-root>`.
2. Present the returned run, exact paths, evidence hashes, strategy, and token.
   State clearly that the check made no Git change and created no artifact.
3. Ask the user to confirm that exact plan. Do not infer confirmation from a
   request to inspect, review, commit later, or continue another workflow.
4. Only after an unambiguous confirmation, run the exact displayed
   `riff finish --confirm <token>` command. Do not substitute a token, alter
   paths, or add `--force` options.
5. Return the resulting commit/PR/merge outcome. For `github_button`, state
   that the GitHub merge action remains a user-controlled boundary.

The command fails closed for invalid wave evidence, pending finishers, dirty
unrelated files, unsafe paths, stale tokens, missing origin/base resolution,
or unsupported merge configuration. It never deploys or promotes.

---
name: finish
description: >-
  Validate and confirm the next evidence-bound phase PR merge boundary only
  when the user explicitly asks to finish or merge a completed RIFF wave.
  Never invoke it implicitly or use it for deployment or promotion.
---

# RIFF Finish

Run this procedure only after an explicit user request. Work from the invoking
project's Git root and require its project-local `.riff` installation.

1. Run `<git-root>/.riff/riff finish --check --project-root <git-root>`.
2. Present the returned run, phase, PR URL, action commits, evidence hashes,
   required base, strategy, and token.
   State clearly that the check made no Git change and created no artifact.
3. Ask the user to confirm that exact plan. Do not infer confirmation from a
   request to inspect, review, commit later, or continue another workflow.
4. Only after an unambiguous confirmation, run the exact displayed
   `riff finish --confirm <token>` command. Do not substitute a token, alter
   paths, or add `--force` options.
5. Return the exact GitHub boundary. Require GitHub's merge-commit method so action commits remain attributable and revertible. Never squash or rebase. RIFF doesn't retarget or merge the PR.
   When the PR is stacked, instruct the user to retarget it to the promoted
   base and verify the resulting diff before clicking Merge.

The command never creates an aggregate wave commit. Phase branches were already
committed, pushed, and opened as detailed PRs by the native wave. The command
fails closed for invalid action or hook evidence, pending finishers, dirty or
staged paths, stale or tampered remote OIDs or PR identity, stale tokens, and
completed waves that predate per-action delivery. It never force-pushes,
retargets, merges, deploys, or promotes.

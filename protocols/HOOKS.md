# Hooks

RIFF has Git hooks, provider runtime hooks, and phase PR-preparation hooks. Native stage gates remain provider-neutral and do not depend on a Claude or Codex editor event.

## Installation and chaining

`riff init` and project-mode `riff resync` resolve Git's effective hooks directory, including a project-local `core.hooksPath` and linked-worktree Git common directory. An effective hooks path outside both the project and Git common directory is rejected.

For `pre-commit` and `commit-msg`, RIFF installs an atomic managed dispatcher. An existing foreign hook is moved once to `<event>.user` and invoked first. RIFF never overwrites that preserved hook. A nonzero user-hook exit stops the chain. A legacy RIFF symlink is upgraded in place. Resync replaces only the RIFF dispatcher bytes and preserves the chained user hook.

Native delivery never uses `--no-verify` or disables `core.hooksPath`.

## Parity matrix

| Hook or event | Installation and trigger | Failure behavior | Native evidence and mapping |
| --- | --- | --- | --- |
| `security-scan.sh` | RIFF side of effective `pre-commit`; every action and phase evidence commit | Blocks secrets, `.env`, registry failures, unsafe migrations, and failing tests; other checks may warn | Nonce, action, expected tree, RIFF hook SHA-256, chained-user flag, and receipt SHA-256. Action receipts are committed in `DELIVERY.json`. |
| Existing project `pre-commit` | Preserved as `pre-commit.user`; runs before RIFF | Any nonzero exit blocks | Same runner transaction fails before commit; `user_hook_chained: true` in the RIFF receipt after both hooks pass. |
| `orphan-file-check.sh` | Child of `security-scan.sh` for staged source files | Warning | Console and `.planning/warnings.log` where supported; receipt binds the parent pre-commit run. |
| `registry-reminder.sh` | Child of `security-scan.sh` for staged public surfaces | Blocks unless the documented skip is explicit | Parent pre-commit receipt. |
| `migration-gate.sh` | Child of `security-scan.sh` for staged migration or schema paths | Blocks destructive SQL, unsafe schema drift, RLS failures, or migration failure; documented environment skips remain explicit | Parent pre-commit receipt plus its normal warning log. |
| `commit-msg.sh` | RIFF side of effective `commit-msg`; every action and phase evidence commit | Intentional compatibility no-op; a preserved project hook may block | Separate nonce and exact-tree receipt. |
| Existing project `commit-msg` | Preserved as `commit-msg.user`; runs before RIFF | Any nonzero exit blocks | Chained-user flag and commit-msg receipt. |
| Configured RIFF project hooks | `.planning/config.json` `hooks`; `RIFF_EVENT=phase_pr_prepare` before PR create or reuse | `0` pass, `2` warning, every other result fail closed | Per-hook exit, stdout and stderr files and SHA-256 values, plus one preparation-receipt hash in wave state and PR body. |
| Classic final gate and hook reconciliation | Legacy `gates-check --finalize` before PR | Required unresolved gates block | Native equivalent validates action delivery, scope, fresh review, repeated mechanics, end-only security, finisher guard, and the phase preparation hook receipt before PR creation. Legacy `GATES.md` remains legacy-only. |
| `destructive-guard.sh` | Claude `PreToolUse/Bash` from installed settings | Exit `2` blocks the Claude tool call | Claude adapter safeguard. Native worker permissions and explicit confirmation boundaries remain authoritative for both providers. |
| `boundary-check.sh` | Claude `PostToolUse/Edit|Write` | Warning | Native task-owned paths, isolated worker snapshots, promotion checks, scope evidence, and action records are fail-closed provider-neutral equivalents. |
| `typecheck-gate.sh` | Claude `PostToolUse/Edit|Write` | Warning and cooldown, fail open | Native planned smokes run in disposable mechanical sandboxes before and after fresh review. |
| `test-gate.sh` | Claude `PostToolUse/Edit|Write` | Warning and cooldown, fail open | Native planned smokes supply authoritative test evidence. |
| `route-auth-guard.sh` | Balanced and cautious Claude `PostToolUse` | Warning | Native wave end-only security invokes it for either provider. |
| `idor-detector.sh` | Balanced and cautious Claude `PostToolUse` | Warning | Native wave end-only security invokes it for either provider. |
| `input-validation-guard.sh` | Cautious Claude `PostToolUse` | Warning | Native wave end-only security invokes it for either provider. |
| `todo-orphan-guard.sh` | Cautious Claude `PostToolUse` | Warning | Claude-only advisory hook. It does not authorize native completion; native fresh review owns unresolved product findings. |
| `voice-rules-inject.sh` | Claude `SessionStart` | Fail silent | Claude adapter context only. No Codex hook harness is installed. |
| `compaction-checkpoint.sh` | Claude `PreCompact` | Fail open | Claude context aid. Native next and wave use persisted JSON state and Git delivery ledgers. |
| `notify-human.sh` | Explicit conductor or compatibility helper | Best effort, always nonblocking for missing configuration | External notification only. Native wave prints persisted approval, resume, and PR boundaries instead of treating notification as evidence. |

## Runner receipt contract

When the native runner owns a commit, all four variables must be present:

```text
RIFF_GIT_HOOK_RECEIPT_DIR
RIFF_GIT_HOOK_NONCE
RIFF_GIT_ACTION_ID
RIFF_GIT_EXPECTED_TREE_OID
```

The dispatcher rejects incomplete identity, unsafe receipt paths, symlink escape, or a staged tree that differs from the runner's persisted tree. Normal manual commits still run the full user and RIFF hook chain but do not create runner receipts.

## Provider boundary

Claude settings may install session and tool hooks. Codex has no project hook harness. Both providers use the same native action ledger, Git dispatchers, mechanical gates, end-only wave security, phase preparation event, and pull-request state machine. Provider models, effort, tools, and permissions stay in route adapters.

## Verification

Use `hooks/__tests__/run.sh` for direct Claude payload fixtures and `__tests__/riff-git-delivery.test.mjs` for real effective-hook installation, chaining, action commits, failure recovery, resync, and phase PR-preparation invocation.

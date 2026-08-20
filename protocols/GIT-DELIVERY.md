# Native Git delivery

This protocol is the provider-neutral Git contract for native `riff next`, `riff wave`, and `riff finish`.

## Compatibility target

Classic `riff:next` treated one validated PLAN task as one action. The executor verified that task's acceptance criteria, staged only its files, and created one commit with phase, wave, agent, model, and plan attribution. Classic `riff:wave` also documented a weaker phase-level commit path. Native RIFF follows the stronger `next` contract: one successful bounded task is one individually revertible action commit. A phase evidence commit is additional metadata and never replaces action commits.

Classic phase delivery used one `riff/phase-N-slug` branch, pushed it, opened one pull request, and stopped at either the GitHub merge button or an explicit local merge cue. Its concurrent workers did not serialize a shared Git index, and its resume notes admitted duplicate-commit risk. Native delivery preserves the observable contract while closing those trust gaps.

## Action transaction

1. Workers run in isolated stages. Tasks in the same validated PLAN wave must have disjoint owned paths and may run concurrently. Later ordered waves may revisit a path changed by an earlier wave.
2. The runner records each task's before and after Git blobs, exact changed paths, PLAN and routing hashes, worker-output hash, wave number, and deterministic PLAN ordinal in the ignored action ledger.
3. Fresh code review and repeated mechanical checks must pass before the ledger is frozen. No commit is trustworthy before this point.
4. The runner restores the phase base tree, then replays each recorded action in PLAN order. It stages exactly that action's paths and rejects every unrelated staged path.
5. Before `git commit`, the runner persists a random nonce hash, expected parent OID, exact tree OID, and exact path list. The raw nonce exists only in the hook environment and receipts. Normal Git verification remains enabled.
6. The effective `pre-commit` and `commit-msg` dispatchers run a preserved project hook first and the RIFF hook second. Both receipts must match the persisted nonce hash, action identity, and expected tree. A hook that changes the staged tree blocks the commit.
7. The action commit records `Phase`, `Wave`, `Action`, `Agent`, `Model`, `Plan`, `Provider`, `Route`, PLAN hash, action-evidence hash, and routing-receipt hash trailers.
8. After all actions, RIFF commits the validated phase artifacts and `DELIVERY.json` as one phase evidence commit. This commit runs the same Git hooks. It is not an action commit.

The semantic contract is identical for Claude and Codex. Model, effort, tools, permissions, and delegation remain in the runtime route adapters.

## Phase branch and pull request topology

An autonomous run captures its named base branch and OID once. Each attempt uses a new branch:

```text
riff/phase-<phase-key>--<wave-run>-a<attempt>
```

The first phase starts at the captured base OID. Every later phase starts at the preceding phase evidence commit, forming a linear stack. This is the smallest topology that lets an autonomous loop continue without merging an earlier phase or rewriting its commits.

After all requested product phases and end-only mechanical and semantic security pass, the wave publishes one pull request per completed phase. The first targets the captured base branch. Each later pull request targets the preceding phase branch. RIFF uses a normal push only, never force-pushes, and fails closed when a remote base or head differs from its evidence-bound OID. It reuses exactly one open pull request with the expected head and base; closed, duplicate, or mismatched pull requests block publication.

The pull request body must contain:

- every action commit, its paths, action evidence, and Git-hook receipts;
- product outcomes from `SUMMARY.md`;
- exact scope and mechanical scope evidence;
- tests and smoke results;
- the fresh code-review verdict, evidence, and residual risk;
- human-verification status and receipt when applicable;
- dependency and stacked-base information;
- phase PR-preparation hook results;
- end-only mechanical and semantic security evidence;
- rollback and crash-recovery instructions.

RIFF opens pull requests but does not merge or promote them. `riff finish --check` validates the next unmerged phase pull request and produces a token-bound confirmation plan. `--confirm` only returns the exact GitHub merge boundary. For a stacked pull request, the operator first retargets it to the promoted base and verifies the resulting diff. The GitHub merge action remains explicit and human-controlled.

## Resume state machine

| Durable state | Recovery rule |
| --- | --- |
| Before action commit | Rebuild and verify the exact staged tree from recorded blobs. |
| After action commit, before ledger persistence | Accept only `HEAD` with the persisted parent, tree, paths, nonce-hash-bound pre-commit receipt, and nonce-hash-bound commit-msg receipt. Persist it without a second commit. |
| After phase evidence commit | Recover the phase commit with the same transaction marker and hook receipts. |
| Before push | Verify the local branch head and remote base OID, then use a normal push. |
| After push | Reuse the remote head only when its OID exactly matches. |
| After PR creation | Look up the unique pull request by branch, validate its open state and base, then reuse it. |
| Before or after wave-state persistence | Reconcile from the action ledger, local and remote OIDs, PR identity, and persisted preparation receipts. Never reset, amend, rebase, force-push, or delete user history. |

Runner state uses `capturing -> validated -> committing -> committed` for the action ledger and `push_pending -> pushed -> pr_pending -> pr_open` for publication.

## Migration

A completed or interrupted native wave without `git` topology and per-action delivery records predates this contract. RIFF cannot infer trustworthy intermediate task deltas from its aggregate working tree. `riff wave --resume` and `riff finish` fail closed for that state. Preserve it for audit, return to a clean planning baseline, and rerun the affected phases. RIFF does not synthesize an aggregate compatibility commit.

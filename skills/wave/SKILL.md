---
name: wave
description: >-
  Run or resume RIFF autonomous single-project roadmap waves. Use only when the
  user explicitly asks for a RIFF wave, autonomous wave, loop, or wave resume.
---

# RIFF Wave

Run the native single-project wave engine from the invoking project's Git root.

## Invocation

1. Resolve the Git root with `git rev-parse --show-toplevel`.
2. Require the project-local `.riff` symlink and resolve `<git-root>/.riff/riff`.
3. Choose exactly one operation from the user's explicit request:
   - One ready dependency frontier: `riff wave --autonomous`.
   - Explicit phase set: `riff wave --autonomous --phases <comma-separated-ids>`.
   - Continue through newly unlocked frontiers: `riff wave --autonomous --loop`.
   - Resume the active interrupted run: `riff wave --resume`.
   - Record completed human verification and continue that run: `riff wave --approve --run <id> --phase <id> --evidence "Checked: <scope>; Observed: <result>; Expected: <expected result>"`.
   - Inspect the active run: `riff wave --status`.
4. Invoke the project-local executable as `<git-root>/.riff/riff wave ...` and
   pass `--project-root <git-root>`.
5. Pass `--provider codex|claude` only when the user explicitly requests a
   one-run override. Otherwise the active project profile owns provider choice.
6. Return the engine's state, stop reason, and exact approval or resume command.

## Autonomous contract

The engine selects ready roadmap phases, respects `depends_on`, and invokes the
native `riff next` runner once per phase. It doesn't ask for confirmation
between ordinary phases. `--loop` recomputes readiness after every completed
frontier and continues until the roadmap is dry, a real blocker exists, a
configured cap is reached, or explicit human verification is required. At that
boundary it creates one persisted request for the first dependency-ready phase.
After a structured evidence note is supplied with `--approve` using `Checked`,
`Observed`, and `Expected` fields, it validates the request and approval receipt
and continues the same run automatically.

Security-sensitive implementation remains autonomous. End-only security hooks
run once after the product phases in the wave or loop. Only a reproducible
blocking finding stops completion. Visual or functional checks explicitly
marked for human verification, destructive boundaries, merge, and promotion
remain confirmation boundaries.

Every phase attempt has a distinct native stage identifier. `--resume` safely
reconciles an attempt that completed before interruption and creates a new
attempt only when the previous one stopped before product promotion. A failure
after promotion is left blocked for human inspection instead of being replayed.
After the configured ordinary retry cap is exhausted for a safe pre-promotion
failure in a loop, RIFF runs one fresh read-only debugger diagnosis and, only
when it returns a valid bounded assignment, makes one debugger-guided native
attempt. An unresolved, invalid, interrupted, post-promotion, or failed guided
recovery stops the wave without another debugger dispatch.

Each completed phase contains one Git commit per bounded PLAN task plus an
additional phase evidence commit. The engine continues autonomously on stacked
phase branches, then, after end-only security passes, normally pushes and opens
one detailed pull request per phase. It validates exact remote base and head
OIDs, runs phase PR-preparation hooks, reuses only the unique matching open PR,
and never force-pushes. It never merges, deploys, or promotes. If publication
fails, return the persisted resume command. See `protocols/GIT-DELIVERY.md`.

A completed or interrupted legacy wave without per-action delivery records
cannot be resumed or finished safely. Report the migration boundary and require
a rerun from a clean planning baseline; never synthesize one aggregate commit.

Roadmap dependency frontiers remain ordered by the engine. Inside each native
phase, path-disjoint tasks grouped in the same validated PLAN wave run through
separate isolated workers concurrently, bounded by `wave.parallel_workers` in
the active profile. A value of `1` forces sequential workers.

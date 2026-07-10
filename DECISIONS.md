# Decisions

Durable framework decisions. Protocols may reference these IDs when the rationale matters.

## D25 — Keep Auto-Gates Heuristic and Explicit

`AUTO-TRIGGERS.md` owns path/tag/text heuristics for optional gates. Commands reference those anchors instead of duplicating trigger logic inline.

## D26 — Prefer Mechanical Gates When They Are Good Enough

Deterministic checks such as `scope-check.mjs`, `fallow`, typecheck, tests, and staged-file security scans should run before LLM review. LLM agents are reserved for judgment-heavy review and debugging.

## D27 — Codex Is the Default Executor Runtime, Not an Installed Project Adapter

RIFF installs Claude Code runtime files into projects. Codex execution happens through the configured skill/CLI path and writes normal RIFF artifacts; no `.codex/`, CommandCode, or adapter harness is installed by `riff init`.

## D28 — Autonomous Sessions Have Exactly One Approval Gate

`protocols/AUTONOMY.md` front-loads every question into the launch window and converts each interactive site to a documented default (Conversion table) or a parked branch. One yes at launch; the next human touchpoint is the consolidated REPORT.md. Rationale: mid-run questions destroy the operator's context-switch budget and are worth less than a reviewed defaults ledger.

## D29 — finishers.yaml Is the No-Merge Marker

A pending finisher entry referencing a branch is the machine-readable signal that no agent may merge that branch, in any session. Chosen over branch-name conventions or marker files because it is one flat ledger per run, carries the "waiting on what" context, and is what `scripts/riff-pending.mjs` scans across projects.

## D30 — Safe Phases Auto-Merge in Autonomous Runs

In an autonomous run, a phase classified `safe` with every required gate passing auto-merges via the `local_no_ff` mechanics regardless of `git.merge_strategy`. Security-critical, money-touching, and regulated phases (`hold`) never do. Rationale: parking everything would make every run end in a pile of stale branches; the boundary, not the merge, is the safety mechanism.

## D31 — Loop Mode Stops on Human-Shaped Walls, Not Quota

`--loop` chains autonomous runs until the roadmap is dry, two consecutive runs merge nothing, `--max-runs` is hit, or the STOP kill switch exists. Quota exhaustion schedules a wakeup and resumes — it is a pause, not a stop. Rationale: two zero-merge runs mean every remaining phase waits on a human finisher; further runs only burn tokens against the same wall.

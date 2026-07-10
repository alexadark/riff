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

## D32 — The No-Merge Marker Is Enforced by a Guard Script, Not Prose

`scripts/finisher-guard.mjs` is called before EVERY merge (PR-CREATION.md 8c, next.md Step 8, WAVE-RECONCILE, AUTONOMY merge policy) and refuses any branch referenced by a pending finisher — autonomous and normal sessions alike. Malformed finisher entries that mention the branch also block (fail closed). Rationale (red-team finding): D29 existed only as documentation; no merge path checked it, so one forgetful session could merge unreviewed sensitive work.

## D33 — Park Order Is Marker First, Status Second

`scripts/autonomy-state.mjs parkPhase()` writes finishers.yaml (temp + fsync + atomic rename) BEFORE flipping run.json to `parked`. A crash between the writes leaves a pending finisher without a status flip — safe, the guard still blocks. The reverse order could leave a parked branch with no marker. All autonomy state files (run.json, loop.json, finishers.yaml, the STATE.md pointer) are written atomically.

## D34 — Relaunch Resumes, Never Parallels

An in-flight run or loop (detected via the STATE.md `## Active Autonomous Run` pointer + `.planning/autonomy/lock.json`, atomic check-and-set) makes any new `--autonomous` launch a RESUME. The lock is reclaimed only when the owner is provably dead (pid gone AND no mtime heartbeat for 45 min). Rationale: a crash during launch previously looked like a fresh start and re-opened front-load questions; two parallel runs on one project can double-merge.

## D35 — Autonomy Boundary Classification Is Objective and Errs Toward Hold

`scripts/autonomy-state.mjs classifyPhase()` is the source of truth (summarized in AUTO-TRIGGERS.md under "Autonomy boundary heuristic"). ANY sensitive keyword/tag/provider match in tags, paths, or title/description → `hold`; planner judgment can add holds but never remove one. Vocabulary covers auth, money (incl. invoices/refunds/subscriptions/entitlements/credits and provider names), privacy/GDPR/PII/consent/retention/deletion/export, legal/audit/kyc/aml, and migrations. Bare "delete"/"export" match only in data-subject contexts (delete-account/data-export) to avoid holding every cleanup phase — judgment call biased toward safety while keeping the loop useful.

## D36 — Block Events Ping the Human, Parked Phases Do Not

`hooks/notify-human.sh` (Telegram/email per `notifications.channel`) fires on exactly three autonomous events: report ready, run halted on a global blocker, loop paused/stopped. Individual parked phases land in REPORT.md only. Rationale: parking is routine (that is the design); pinging per park would train her to ignore the channel.

# Autonomous Session Protocol

One approval, then hours of unattended build. Every decision is front-loaded into the launch window; the build has zero open questions by construction. Human-facing verification is batched at the end into one report. Anything security-critical, money-touching, privacy-touching, or regulated builds on a branch and is never merged unattended.

Launch surface: `/riff:next --autonomous` (single phase) or `/riff:wave --autonomous [phases]` (bundle). Both reuse the standard pipeline; this protocol only changes what happens at interaction points, at merge time, and after the last phase. Add `--loop` to chain runs Ralph-style until a stop criterion fires (see Loop mode below).

State machinery (atomic writes, parking, launch lock, classification) is code, not prose: `.riff/scripts/autonomy-state.mjs`. The no-merge guard is `.riff/scripts/finisher-guard.mjs`. Agents call these instead of hand-editing state files.

## Run directory

`.planning/autonomy/<run-id>/`, run-id = `YYYY-MM-DD-HHMM` at launch.

| File | Role |
| --- | --- |
| `run.json` | Machine state: phases, classification, per-phase status, current stage. Resumability lives here. Always written atomically (temp + fsync + rename) via `.riff/scripts/autonomy-state.mjs` — a crash never leaves a torn file. |
| `DECISIONS.md` | Ledger of defaults taken instead of asking. Checkbox per entry; unchecked = not yet human-reviewed. |
| `finishers/<id>.yaml` | Machine ledger of items awaiting human sign-off — ONE file per finisher, each written atomically, so concurrent parks (wave mode) can never lose each other's no-merge marker. Source of truth for the no-merge marker, enforced by `.riff/scripts/finisher-guard.mjs`. Read by `.riff/scripts/riff-pending.mjs`. Legacy single-ledger `finishers.yaml` files are still read but never written. |
| `REPORT.md` | Single consolidated end-of-run report, from `templates/AUTONOMY-REPORT.md`. |

Shared across runs: `.planning/autonomy/lock/` (launch lock directory, see § Launch lock) and `.planning/autonomy/loop.json` (loop state, see § Loop mode).

`run.json` shape:

```json
{
  "run": "2026-07-10-1430",
  "stage": "frontload | build | verify | done",
  "base_sha": "<sha of main at launch>",
  "phases": [
    { "id": "12-checkout-flow", "autonomy": "safe | hold", "status": "todo | building | parked | merged | done", "branch": "riff/phase-12-checkout-flow" }
  ]
}
```

Finisher shape — one file per finisher at `finishers/<id>.yaml`, flat and stable (parsed by the shared tolerant parser in `scripts/lib/finishers.mjs`, do not nest deeper). The id is DERIVED, never counted: `F-<phase>-<type>`, so the same phase+type always maps to the same file and re-parking overwrites its own marker, never anyone else's.

```yaml
# .planning/autonomy/2026-07-10-1430/finishers/F-12-checkout-flow-security.yaml
run: 2026-07-10-1430
finishers:
  - id: F-12-checkout-flow-security
    type: security        # security | payment | ux | branch | decision | review
    phase: 12-checkout-flow
    branch: riff/phase-12-checkout-flow
    waiting_on: "human sign-off on Stripe webhook validation"
    artifact: .planning/phases/12-checkout-flow/SECURITY.md
    status: pending        # pending | resolved
    created: 2026-07-10
```

Write finisher entries via `node .riff/scripts/autonomy-state.mjs park ...` (see § Parking), never by hand-editing the YAML — the helper guarantees marker-before-status ordering and atomic writes. Resolving a finisher (human verdict) flips `status: resolved` inside its file. Pre-existing single-ledger `finishers.yaml` files keep blocking until resolved (read everywhere, written nowhere); a legacy pending duplicate of a re-parked phase double-blocks — fail-closed, resolve both.

## Front-load

The only interactive window. Everything a human might be asked during the run is asked here, once, in one block.

0. **Launch lock + resume check.** Run `node .riff/scripts/autonomy-state.mjs resolve-launch`. If it reports an in-flight run or loop (`action: resume` or `restart-run`), this launch RESUMES it per § Resume — never start a parallel run, never re-ask front-load questions. Only on `action: new`: acquire the lock (`node .riff/scripts/autonomy-state.mjs lock acquire --run <run-id> [--loop]`; exit 4 = a live owner holds it → resume instead), then proceed.
1. Run `protocols/RECONCILE.md` § Step 0 — Sync main + reconcile stale bookkeeping, interactively (sync main, dirty tree, stale branches). A diverged main blocks the launch — never launch autonomous on a diverged main.
2. Select the run scope: the phases for `/riff:wave` bundling, or the single next phase. Apply the standard wave eligibility rules, except `mode: HITL` phases are NOT excluded — HITL semantics are converted per § Conversion table.
3. Confidence gate for every phase in scope. Collect ALL sub-0.7 dimensions and planner questions across all phases into ONE `AskUserQuestion` batch. No question survives past launch.
   **Question domain rule:** the batch may only contain product, design, UX, and scope questions, phrased plainly (`references/EXPLANATION-LEVEL.md`). Security, privacy, GDPR, compliance, and payment-correctness questions are NEVER asked to the human — she does not operate in those domains, and a question she cannot evaluate blocks the launch for nothing. Instead: take the conservative default, log it in the run DECISIONS ledger, classify the phase `hold`, and let the machine verification at the end of the run produce the evidence (see the Batched verification and Finishers sections below).
4. Classify every phase per § Autonomy boundary. Stamp `autonomy: safe | hold` into `run.json`.
5. Plan all phases (standard Step 4 planning, plan adversarial review included per its gate). Plans must contain zero open questions; an assumption a plan still carries becomes a pre-seeded `DECISIONS.md` entry.
6. Present one summary: phases, classifications, plans, baked-in defaults. One yes launches the run. After that yes, FIRST re-verify the lock: `node .riff/scripts/autonomy-state.mjs lock touch --run <run-id>` — the wait for the human's yes can outlast the staleness window, and another launch may have legitimately reclaimed the lock meanwhile. Exit 5 = this launch lost the lock: do NOT start the run; resolve-launch and resume whatever now owns the project. Exit 0: write `run.json` atomically, write the STATE.md pointer (`node .riff/scripts/autonomy-state.mjs pointer set --run <run-id> [--loop]`), and `AskUserQuestion` is forbidden until REPORT.md is delivered.

## Launch lock

`.planning/autonomy/lock/` is the anti-double-launch marker: a lock DIRECTORY (mkdir is atomic and exclusive — creation has exactly one winner by construction) containing `owner.json` with the owning run's TOKEN (`{ token: <run-id>, loop, pid, started }`). Ownership identity is the token, never the pid — the CLI helper that creates the lock exits immediately, so its pid proves nothing. All of it lives in `.riff/scripts/autonomy-state.mjs`. Rules:

- An in-flight run or loop for the project means a new `--autonomous` launch RESUMES it. Never two parallel autonomous sessions on one project.
- **Heartbeat is automatic.** Every phase status transition goes through `node .riff/scripts/autonomy-state.mjs phase-status ...` (or `park`), which writes run.json AND bumps the lock heartbeat in one call — no agent ever needs to remember `lock touch`. Staleness = no heartbeat for 180 minutes — wider than any single phase, so a live build can never look stale between transitions (a recorded pid that is still alive also counts as live, as secondary evidence only). The wide window costs nothing on resume: an in-flight run resolves to `resume` via loop.json/pointer and never needs to reclaim the lock.
- **Reclaim is a compare-and-swap.** A stale lock is renamed aside (atomic — exactly one reclaimer can win; losers fall back to mkdir and lose that too), the moved owner is re-checked against what was read, then the reclaimer acquires fresh via mkdir. A lock is never unlinked in place; two relaunches can never both think they own it.
- **Fencing.** `phase-status` exits 5 (and `lock touch --run <run-id>` likewise) when the lock's token no longer matches this session's run — OR when the lock has VANISHED while this run claims to hold it (reclaimed then released, or force-removed): a missing lock is a fencing failure, never a pass. On exit 5: stop the run, park the in-flight phase, NEVER merge. Another session may own the project now.
- **Release is fenced too.** `lock release --run <run-id>` removes the lock only when the token matches (exit 6 = refused: the lock belongs to another run — an old session finishing late must never delete a successor's lock). A lock whose owner record cannot be read has no provable owner and is released only by an explicit human `--force`. Release when the run reaches `stage: done` (single run) or when the loop stops (loop mode). A pre-redesign `lock.json` single-file lock is fenced the same way (its recorded run id must match, unless stale or forced).

## Autonomy boundary

A phase is `hold` when any of:

- `tags:` contains any tag from the hold set (exact match, case-insensitive, `-`/`_` interchangeable): `security_critical`, `auth`, `payment`, `payments`, `billing`, `compliance`, `regulated`, `migration`, `finance`, `invoice`, `invoices`, `refund`, `refunds`, `credits`, `subscription`, `subscriptions`, `entitlement`, `entitlements`, `privacy`, `pii`, `gdpr`, `data_deletion`, `consent`, `retention`, `legal`, `audit`, `kyc`, `aml`, `dsar`, `dpa`, `data_processing_agreement`, `cookie`, `cookies`, `cookie_consent`, `personal_data`, `analytics_opt_out`, `data_subject`, `erasure` — and tags additionally run through the sensitive-surface patterns below, so a tag like `session-handling` holds even without an exact-set match
- `provider_mode: production`
- `mode: HITL` with `provider_mode: production` (real-provider human verification)
- The heuristics of `protocols/AUTO-TRIGGERS.md` § Autonomy boundary heuristic flag the phase — sensitive keywords or provider names in its tags, file paths, OR title/description
- The planner is unsure — when in doubt, `hold`

The classification is objective by construction: run `node .riff/scripts/autonomy-state.mjs classify --tags "<tags>" --paths "<planned paths>" --text "<title + description>"`. ANY match returns `hold` (exit 3) — it does not depend on the planner's subjective uncertainty; the planner's doubt can only ADD holds, never remove one. A false `hold` costs one human glance; a false `safe` is the failure this protocol forbids.

Everything else is `safe`.

| Class | Build | Merge | End state |
| --- | --- | --- | --- |
| `safe` | Standard pipeline on its phase branch | Auto-merged per § Merge policy when all gates pass | `merged` |
| `hold` | Standard pipeline on its phase branch, PR opened | NEVER merged or deployed by the agent | `parked` + finisher |

A `safe` phase that fails a gate (after one auto-debug attempt) is demoted to `parked` with a finisher; the run continues with the remaining independent phases.

## Parking

"Park" = commit work-in-progress to the phase branch, then run:

```bash
node .riff/scripts/autonomy-state.mjs park --run <run-id> --phase <id> --type <type> \
  --branch riff/phase-<id> --waiting "<what a human must check>" --artifact <path>
```

The helper writes the no-merge marker FIRST (its own file under `finishers/`, temp + fsync + atomic rename), THEN flips the phase to `parked` in `run.json`. The order is load-bearing: a crash between the two writes leaves a pending finisher with no status flip (safe — the guard still blocks the branch), never a parked branch without a marker. One file per finisher means two phases parking at the same moment (wave mode) write two different files — neither marker can be lost. `run.json` statuses are bookkeeping; the markers plus git state are what resume and the guard trust.

## Build rules

- `AskUserQuestion` is forbidden for every agent in the run (planner re-entry, executor, reviewers, debugger, reconcile).
- Missing decision → take the documented default from § Conversion table, log it in `DECISIONS.md`, continue.
- No documented default and the unknown is consequential → park the phase (§ Parking), continue with phases that do not depend on it.
- Truly global blockers (corrupted ROADMAP.yaml, unrecoverable git state) → park all non-terminal phases with one `review`-type finisher describing the halt, still produce REPORT.md for what completed, and notify per § Notifications.
- Main diverged mid-run or on resume → same treatment: park all affected non-terminal phases, one `review` finisher describing the divergence, REPORT.md, notify. Never STOP-and-ask — encoded in the autonomous branch of `protocols/RECONCILE.md` § Step 0 — Sync main + reconcile stale bookkeeping.
- R1–R4 apply unchanged. R3 (architecture change) in autonomous mode = park the phase, never improvise architecture.

### Irreversibility rule

Some actions are never taken autonomously, whatever the phase classification, because they cannot be undone by a `git revert`:

- production deploys and production cutovers (DNS, domains, env promotion)
- irreversible database migrations against non-local data (drops, destructive backfills)
- real-money operations (live charges, refunds, payouts — sandbox is fine)
- outbound communication to real users (emails, push, SMS)
- bulk data deletion outside the repo
- destructive git beyond the documented branch cleanup (force-push, history rewrite)

Hitting one of these mid-run → park the phase with a finisher naming the exact pending action. In interactive sessions the same actions always get an explicit AskUserQuestion first. Everything else the run does (branches, commits, local merges, artifacts) is reversible by construction.

## Conversion table

Every interactive site in the standard pipeline, converted. "Park" = § Parking (branch + finisher + continue).

| Site | Standard behavior | Autonomous behavior |
| --- | --- | --- |
| Confidence gate mid-run re-check unclear (`protocols/EXECUTION.md` § 1. Confidence Gate) | STOP, notify | Park the phase |
| Plan adversarial REVISE exhausted (2 cycles) | STOP, escalate | Park the phase |
| Executor crash residue (`protocols/POST-PHASE.md` § Executor crash residue (Step 5 post-return)) | AskUserQuestion A/B/C | Option A: auto-debug once; `UNRESOLVED` → park |
| Auto-debug `UNRESOLVED` | Halt, surface DEBUG.md | Park the phase, DEBUG.md becomes the finisher artifact |
| Scope-check task drops (`protocols/SCOPE-CHECK.md`) | AskUserQuestion completed/defer/rejected | Defer dropped tasks + DECISIONS entry |
| Scope-check thin smoke section | AskUserQuestion expand/skip | Skip gate + DECISIONS entry |
| Scope-check flow-manifest drops | AskUserQuestion apply/remove/skip | Apply the manifest upserts now |
| Scope-check smoke regressions | AskUserQuestion debug/fix/skip | Auto-debug once; still failing → park |
| Fallow runtime error (`protocols/FALLOW.md`) | AskUserQuestion skip/halt | Skip + log to GATES.md (existing default) |
| Fallow `fail` verdict (`protocols/FALLOW.md` § Verdict behavior) | STOP fix/exception/override | Auto-debug once (max 1 cycle); still failing → park, finisher type `review`, DECISIONS entry |
| Simplifier apply confirmation (`agents/simplifier.md` Step 5) | Orchestrator confirms before apply | Auto-apply + commit as `refactor(phase-N)` commits, never wait |
| Browser smoke runtime error (`protocols/BROWSER-CHECK.md`) | AskUserQuestion skip/halt | Skip + log to GATES.md (existing default) |
| Browser smoke `fail` verdict | STOP fix/exception/override | Auto-debug once; still failing → park |
| Adversarial FAIL / Security BLOCKED after auto-debug | No PR, surface | Park; finisher type `security` when SECURITY.md is BLOCKED |
| Sandbox HITL with no headless driver (`references/BROWSER-VERIFICATION.md` § Skip behavior per caller) | AskUserQuestion verify/install/halt | Skip verification + finisher type `ux`, no prompt |
| Wave codex-exec startup failure (`commands/wave.md` Step 5b) | Fall back to paste flow | Fall back to in-process Sonnet execution (Step 5c); Sonnet also unavailable → park the whole wave, finisher type `review`. NEVER the paste flow |
| Ahead-only main at Step 0 (`protocols/RECONCILE.md` § Step 0) | AskUserQuestion push/skip | Push automatically (our own local merge commits); push fails → log to REPORT.md, continue |
| Diverged main at Step 0 (mid-run/resume) | STOP and surface, ask | Park all affected phases + `review` finisher describing the divergence + REPORT.md + notify. Never ask |
| Dirty tree mid-run outside `.planning/` | AskUserQuestion stash/abort | Stash + DECISIONS entry |
| Pending expertise review (`protocols/POST-PHASE.md`) | AskUserQuestion review/defer/reject | Always defer; count reported in REPORT.md |
| Milestone deep-audit prompt | AskUserQuestion run/defer | Defer + finisher type `review` |
| Wave proposal confirm (`commands/wave.md` Step 2) | AskUserQuestion confirm/adjust/cancel | Replaced by the front-load approval |
| Wave reconcile FAIL (`protocols/WAVE-RECONCILE.md`) | `needs_human_review`, stop | Park affected phases; run continues to the Batched verification stage below |
| Merge cue (`protocols/PR-CREATION.md`) | Human clicks / says "merge" | Merge policy below |
| Usage guard ≥95% (`commands/wave.md`) | Tell user, schedule wakeup | Unchanged — schedule wakeup, resume per § Resume (never burn a hot quota window) |

## Decisions ledger

`.planning/autonomy/<run-id>/DECISIONS.md`. One checkbox entry per default taken:

```markdown
# Decisions — run 2026-07-10-1430

- [ ] AD1 (phase 12-checkout-flow, scope-check): task 3 deferred, scope-check verdict DROPPED. Default per AUTONOMY.md § Conversion table. Evidence: SCOPE-CHECK.json.
- [ ] AD2 (phase 14-emails, planner): retry queue capped at 3 attempts — assumption carried from front-load.
```

Unchecked = pending human review; the inbox CLI counts them. Checking the box (human, during report review) resolves the entry. This ledger complements R1–R4 logging in SUMMARY.md; it never replaces it.

## Batched verification

Runs once, non-interactively, after the last phase reaches a terminal state (`merged` or `parked`). Never mid-build.

1. Aggregate per-phase artifacts already produced: `SECURITY.md`, `REVIEW.md`, `SMOKE.json`, `SCOPE-CHECK.json`, `GATES.md`, `HOOK-RECONCILE.md`.
2. Run `/riff:stress` static pass (no `--target`, no active attacks — the static pass needs no confirmation).
3. If `.uxtest/flows.yaml` exists and the uxtest skill is available: run the replay/regression pass headlessly; UX findings land in the report. Missing manifest or skill → log skip.
4. Sandbox payment/provider flows: browser-verification evidence (screenshots, console transcripts) captured per phase is folded in — payment correctness is never auto-signed; it always yields a `payment` finisher for human review of the evidence.
5. Compose `REPORT.md` from `templates/AUTONOMY-REPORT.md`: per-phase verdict table, findings deduped by file+finding and bucketed BLOCKER/HIGH/NOTE (same shape as `protocols/DEEP-AUDIT.md` synthesis), full DECISIONS ledger, finishers list with exact next commands.
6. Notify per § Notifications: one message, link to REPORT.md.

## Notifications

All human-facing pings go through `bash .riff/hooks/notify-human.sh "<message>"` (channel from `notifications.channel` in `profile.yaml` — Telegram when configured). Fire one at each of these events, and ONLY these (parking a single phase mid-run is not a ping — it lands in REPORT.md):

- **Run report ready** — REPORT.md delivered (end of every run). Include: merged/parked counts, pending finisher count, REPORT.md path.
- **Run halted on a global blocker** — diverged main, corrupted ROADMAP, unrecoverable git state. Include the finisher id and what is needed.
- **Loop paused or stopped** — any loop stop/pause reason (BLOCKER finding, zero-merge brake, roadmap dry, max-runs, kill switch). Include `stop_reason` and the pending-finisher count.

The hook exits 0 even when unconfigured — a missing Telegram token never blocks the run; it warns on stderr.

## Finishers

Every parked phase, every deferred audit, every payment/UX verdict awaiting eyes = one `finishers.yaml` entry, `status: pending`. A pending finisher on a branch IS the no-merge marker: no agent, in any later session, merges a branch referenced by a pending finisher.

That rule is enforced in code, not prose: every merge path (`protocols/PR-CREATION.md` § 8c, `commands/next.md` Step 8, `protocols/WAVE-RECONCILE.md`, and the Merge policy section below) runs `node .riff/scripts/finisher-guard.mjs <branch>` before merging and REFUSES on a non-zero exit — in autonomous AND normal sessions. A later manual "merge phase 12" is refused the same way while its finisher is pending.

Resolution is always human-initiated: she says so in conversation ("finisher F1 ok, merge it" / "reject F2"); the agent then merges or discards and flips `status: resolved`.

**What she reviews depends on the finisher domain — never ask her to evaluate security, privacy, or payment correctness herself:**

- `security` / `payment` / compliance-flavored `review` finishers: the machine produces the judgment (security-reviewer verdict, adversarial Codex, stress pass, GATES.md). REPORT.md translates that evidence into plain language and ends each finisher with ONE recommended action — "all machine checks green, safe to say: finisher F3 ok" or "real finding (<one-line what/why>), fix it before merging / needs an outside expert". Her glance is a go/no-go on the recommendation, not a domain evaluation.
- `ux` finishers: her actual domain. Present the screenshots/flow evidence and let her judge the design directly.
- A `hold` phase whose machine checks are ALL green still waits for her explicit ok before merging — the recommendation makes that ok a 10-second glance, but no sensitive branch ever merges without a human word.

Cross-project inbox: `node .riff/scripts/riff-pending.mjs` (the same file lives at the framework root) sweeps every project registered in `profile.yaml` → `dashboard.projects` and prints one sorted list: pending finishers, unchecked DECISIONS entries, `needs_human_review` phases; unmerged `riff/*` branches are branch hygiene, shown only with `--branches`. Deterministic, exits 0, `--json` for piping.

## Merge policy

- Every merge, `safe` or manual, is preceded by the no-merge guard: `node .riff/scripts/finisher-guard.mjs riff/phase-N-slug || <refuse: do not merge, surface the blocking finisher>`. The guard runs in the merge-strategy DISPATCHER (step 5 of `protocols/PR-CREATION.md` § 8b — Push + PR), before EITHER strategy executes — on `github_button` a blocked branch means the "Click Merge" instruction is never printed; the blocking finisher is surfaced instead.
- `hold` phases: PR opened, branch left unmerged, finisher written. No exception, no override flag.
- `safe` phases: when every required gate in GATES.md passes (`gates-check.mjs --finalize` clean, scope-check MATCH, security PASS or PASS-WITH-WARNINGS, smoke pass/warn) AND the guard exits 0, auto-merge using the `local_no_ff` mechanics of `protocols/PR-CREATION.md` § 8c — Update state after merge, without waiting for a verbal cue, regardless of the profile's `git.merge_strategy`. Record the merge SHA in SUMMARY.md as usual.
- Any gate short of that bar → the phase parks instead. PASS-WITH-WARNINGS security verdicts auto-merge but their warnings are listed in REPORT.md.

## Loop mode

`--loop` on top of `--autonomous` chains runs back-to-back, Ralph-Wiggum style, without re-asking anything between runs. Flags: `/riff:wave --autonomous --loop [--max-runs N]`, same on `/riff:next`.

What changes vs a single autonomous run:

- **Front-load covers the whole loop.** At launch, run the confidence gate + classification (`safe | hold`) + assumption questions for EVERY `todo` phase the loop may reach (not just the first bundle). One approval covers the entire loop session. Detailed PLAN.md files are still written just-in-time per run — planning is non-interactive by then, and any residual assumption becomes a DECISIONS entry, never a question. Phases created after launch (new seeds, `/riff:add-phase`) are NOT in scope; they wait for the next session.
- **Anti-double-launch.** `loop.json` `status: running` is the loop lock, backed by the shared launch lock (§ Launch lock): both are written by atomic check-and-set. A second `--autonomous --loop` launch on the same project RESUMES the existing loop — never a parallel one. Reclaim only when the owner is provably dead (no heartbeat for the stale window; reclaim is a compare-and-swap rename, never an unlink — see § Launch lock).
- **Between runs** (after each REPORT.md): count the finished run (`node .riff/scripts/autonomy-state.mjs loop complete-run --run <run-id>` — idempotent, see below), re-run Step 0 sync per the Conversion table, re-check the usage guard, check the stop criteria below, then start the next run (fresh run-id, fresh run directory): FIRST `loop start-run --run <new-run-id>` (loop.json is the authoritative record), THEN `pointer set` (the STATE.md pointer is a hint). Prefer fresh context per run: at each run boundary, apply `protocols/HANDOFF.md` — checkpoint STATE.md and restart clean rather than dragging a bloated session into the next run.
- **Loop state** lives in `.planning/autonomy/loop.json`: `{ "started": ..., "status": "running | paused | stopped", "stop_reason": ..., "current_run": "<run-id>|null", "completed_runs": ["<run-id>", ...], "last_completed_run": "<run-id>|null", "runs_completed": N, "max_runs": N|null, "consecutive_zero_merge_runs": N }`. Updated between runs via atomic write; a fresh session resuming the loop reads it (same resume contract as run.json). `current_run` is the loop's authoritative in-flight run id, written at every run start via `loop start-run`. `runs_completed` increments exactly once per run, at REPORT.md delivery, via `loop complete-run` — `completed_runs` is the idempotency record (full history, incremented and appended in one atomic write), so replaying ANY old completion after a crash-then-resume can never double-count.

**Stop criteria** — the loop ends when the FIRST of these fires, always ending with a final consolidated report (one REPORT.md per run + a one-screen loop summary) and a § Notifications ping:

1. **Roadmap dry:** no eligible `todo` phase remains (parked phases don't count as eligible — they wait for finishers).
2. **Failure brake:** 2 consecutive runs merged zero phases (everything parked or failed). The wall is human-shaped; more runs only burn quota.
3. **Blocker brake:** the just-finished run's Batched verification produced any BLOCKER-severity finding. A merged-but-broken run is a human-shaped wall too: set `status: paused`, `stop_reason: blocker-finding`, write a `review` finisher pointing at the REPORT.md findings, do NOT start the next run.
4. **`--max-runs N` reached** (default: unlimited — criteria 1–3 are the real brakes).
5. **Kill switch:** `.planning/autonomy/STOP` file exists. She can `touch .planning/autonomy/STOP` from any terminal, or say "stop the loop" in any session — the loop checks between runs, finishes the in-flight run cleanly, never kills mid-phase. Delete the file to re-arm.
6. **Quota is NOT a stop:** the usage guard schedules a wakeup and the loop resumes when the window clears (same mechanics as a single run).

On stop or pause: release the launch lock, clear the STATE.md pointer (stopped) or keep it (paused — a resume continues the loop after the finisher is resolved).

**Loop resume reconciliation** (fresh session, crash, wakeup): `node .riff/scripts/autonomy-state.mjs resolve-launch` does the reconciliation. When `loop.json` says `running`, it is AUTHORITATIVE: `loop.current_run` is checked first, the STATE.md pointer is a hint only (a crash between run start and pointer update leaves them disagreeing — the loop record wins), and a scan of run directories is the defensive fallback. A run id that cannot be verified on disk is never restarted blind.

- `current_run`'s `run.json` parseable and non-terminal → `resume` that run mid-flight (§ Resume).
- `current_run`'s `run.json` says `done` → the crash hit between REPORT.md and the next run start. The completed run is reported as `completedRun` (call `loop complete-run` for it — idempotent) but resolution KEEPS LOOKING for a live run before answering: another non-terminal run on disk wins (`resume` it), and only a clean disk yields `continue-loop`. A fresh run is never started beside a live one.
- `current_run`'s directory exists but `run.json` is missing, partial, or corrupt → `restart-run`: discard the partial `run.json` and restart the SAME run-id fresh. Front-load is already locked, so no questions. Never increment `runs_completed` for the discarded attempt; before re-merging anything, re-check each phase branch against main (a phase whose merge commit already landed is `merged`, not re-mergeable — the finisher guard and `git merge-base --is-ancestor` prevent double-merges).
- No usable candidate (legacy loop.json without `current_run`, pointer stale): exactly ONE non-terminal run directory on disk → resume it; ZERO → `continue-loop` (cleanly between runs, start the next one); SEVERAL → `halt-ambiguous`: pause the loop with one `review` finisher naming the candidate run ids and notify — starting more work on top of several unfinished runs compounds the mess; a human untangles it.

## Resume

The run must survive session death (compaction, crash, quota wakeup).

- Entry point: STATE.md carries a machine-parseable pointer section (`## Active Autonomous Run` — run-id + loop flag, see `templates/STATE.md`), written atomically at launch and cleared at `done`. `node .riff/scripts/autonomy-state.mjs resolve-launch` reconciles loop.json (authoritative when running) + pointer (hint) + run dirs (fallback) and says whether to `resume`, `restart-run`, `continue-loop`, or start `new`.
- Every phase status transition goes through `node .riff/scripts/autonomy-state.mjs phase-status --run <run-id> --phase <id> --status <s>` — one call that writes run.json atomically AND heartbeats the launch lock. Exit 5 = the lock's token no longer matches this run (lost to another launch): stop, park the in-flight phase, never merge.
- Relaunching `/riff:next --autonomous` or `/riff:wave --autonomous` with an in-flight `run.json` resumes it: skip front-load entirely (decisions are already locked), re-enter at the first non-terminal phase, reusing the standard crash-residue and branch-resume mechanics of `protocols/RECONCILE.md` § Step 2b — Crash residue checks (pre-branch).
- Resume never re-opens locked decisions. A contradiction discovered on resume (per `protocols/HANDOFF.md`) parks the affected phase instead of re-asking.

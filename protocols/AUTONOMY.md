# Autonomous Session Protocol

One approval, then hours of unattended build. Every decision is front-loaded into the launch window; the build has zero open questions by construction. Human-facing verification is batched at the end into one report. Anything security-critical, money-touching, or regulated builds on a branch and is never merged unattended.

Launch surface: `/riff:next --autonomous` (single phase) or `/riff:wave --autonomous [phases]` (bundle). Both reuse the standard pipeline; this protocol only changes what happens at interaction points, at merge time, and after the last phase.

## Run directory

`.planning/autonomy/<run-id>/`, run-id = `YYYY-MM-DD-HHMM` at launch.

| File | Role |
| --- | --- |
| `run.json` | Machine state: phases, classification, per-phase status, current stage. Resumability lives here. |
| `DECISIONS.md` | Ledger of defaults taken instead of asking. Checkbox per entry; unchecked = not yet human-reviewed. |
| `finishers.yaml` | Machine ledger of items awaiting human sign-off. Source of truth for the no-merge marker. Read by `.riff/scripts/riff-pending.mjs`. |
| `REPORT.md` | Single consolidated end-of-run report, from `templates/AUTONOMY-REPORT.md`. |

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

`finishers.yaml` shape (flat and stable — parsed line-based by the inbox CLI, do not nest deeper):

```yaml
run: 2026-07-10-1430
finishers:
  - id: F1
    type: security        # security | payment | ux | branch | decision | review
    phase: 12-checkout-flow
    branch: riff/phase-12-checkout-flow
    waiting_on: "human sign-off on Stripe webhook validation"
    artifact: .planning/phases/12-checkout-flow/SECURITY.md
    status: pending        # pending | resolved
    created: 2026-07-10
```

## Front-load

The only interactive window. Everything a human might be asked during the run is asked here, once, in one block.

1. Run `protocols/RECONCILE.md` § Step 0 — Sync main + reconcile stale bookkeeping, interactively (sync main, dirty tree, stale branches). A diverged main blocks the launch — never launch autonomous on a diverged main.
2. Select the run scope: the phases for `/riff:wave` bundling, or the single next phase. Apply the standard wave eligibility rules, except `mode: HITL` phases are NOT excluded — HITL semantics are converted per § Conversion table.
3. Confidence gate for every phase in scope. Collect ALL sub-0.7 dimensions and planner questions across all phases into ONE `AskUserQuestion` batch. No question survives past launch.
4. Classify every phase per § Autonomy boundary. Stamp `autonomy: safe | hold` into `run.json`.
5. Plan all phases (standard Step 4 planning, plan adversarial review included per its gate). Plans must contain zero open questions; an assumption a plan still carries becomes a pre-seeded `DECISIONS.md` entry.
6. Present one summary: phases, classifications, plans, baked-in defaults. One yes launches the run. After that yes, `AskUserQuestion` is forbidden until REPORT.md is delivered.

## Autonomy boundary

A phase is `hold` when any of:

- `tags:` contains `security_critical`, `auth`, `payment`, `payments`, `billing`, `compliance`, `regulated`, or `migration`
- `provider_mode: production`
- `mode: HITL` with `provider_mode: production` (real-provider human verification)
- The path/text heuristics of `protocols/AUTO-TRIGGERS.md` flag auth or payment surface
- The planner is unsure — when in doubt, `hold`

Everything else is `safe`.

| Class | Build | Merge | End state |
| --- | --- | --- | --- |
| `safe` | Standard pipeline on its phase branch | Auto-merged per § Merge policy when all gates pass | `merged` |
| `hold` | Standard pipeline on its phase branch, PR opened | NEVER merged or deployed by the agent | `parked` + finisher |

A `safe` phase that fails a gate (after one auto-debug attempt) is demoted to `parked` with a finisher; the run continues with the remaining independent phases.

## Build rules

- `AskUserQuestion` is forbidden for every agent in the run (planner re-entry, executor, reviewers, debugger, reconcile).
- Missing decision → take the documented default from § Conversion table, log it in `DECISIONS.md`, continue.
- No documented default and the unknown is consequential → park the phase (commit work-in-progress to its branch, `status: parked`, finisher entry), continue with phases that do not depend on it.
- Truly global blockers (diverged main mid-run, corrupted ROADMAP.yaml) → stop the run, write a `review`-type finisher describing the halt, still produce REPORT.md for what completed.
- R1–R4 apply unchanged. R3 (architecture change) in autonomous mode = park the phase, never improvise architecture.

## Conversion table

Every interactive site in the standard pipeline, converted. "Park" = branch + finisher + continue.

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
| Browser smoke runtime error (`protocols/BROWSER-CHECK.md`) | AskUserQuestion skip/halt | Skip + log to GATES.md (existing default) |
| Browser smoke `fail` verdict | STOP fix/exception/override | Auto-debug once; still failing → park |
| Adversarial FAIL / Security BLOCKED after auto-debug | No PR, surface | Park; finisher type `security` when SECURITY.md is BLOCKED |
| Sandbox HITL with no headless driver (`references/BROWSER-VERIFICATION.md`) | AskUserQuestion verify/install/halt | Skip verification + finisher type `ux` |
| Dirty tree mid-run outside `.planning/` | AskUserQuestion stash/abort | Stash + DECISIONS entry |
| Pending expertise review (`protocols/POST-PHASE.md`) | AskUserQuestion review/defer/reject | Always defer; count reported in REPORT.md |
| Milestone deep-audit prompt | AskUserQuestion run/defer | Defer + finisher type `review` |
| Wave proposal confirm (`commands/wave.md` Step 2) | AskUserQuestion confirm/adjust/cancel | Replaced by the front-load approval |
| Wave reconcile FAIL (`protocols/WAVE-RECONCILE.md`) | `needs_human_review`, stop | Park affected phases; run continues to § Batched verification |
| Merge cue (`protocols/PR-CREATION.md`) | Human clicks / says "merge" | § Merge policy |
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
6. Notify via `notifications.channel` (`hooks/notify-human.sh` mechanics): one message, link to REPORT.md.

## Finishers

Every parked phase, every deferred audit, every payment/UX verdict awaiting eyes = one `finishers.yaml` entry, `status: pending`. A pending finisher on a branch IS the no-merge marker: no agent, in any later session, merges a branch referenced by a pending finisher.

Resolution is always human-initiated: she reviews the artifact, then says so in conversation ("finisher F1 ok, merge it" / "reject F2"); the agent then merges or discards and flips `status: resolved`.

Cross-project inbox: `node .riff/scripts/riff-pending.mjs` (or from the framework repo, `node scripts/riff-pending.mjs`) sweeps every project registered in `profile.yaml § dashboard.projects` and prints one sorted list: pending finishers, unchecked DECISIONS entries, `needs_human_review` phases, unmerged `riff/*` branches. Deterministic, exits 0, `--json` for piping.

## Merge policy

- `hold` phases: PR opened, branch left unmerged, finisher written. No exception, no override flag.
- `safe` phases: when every required gate in GATES.md passes (`gates-check.mjs --finalize` clean, scope-check MATCH, security PASS or PASS-WITH-WARNINGS, smoke pass/warn), auto-merge using the `local_no_ff` mechanics of `protocols/PR-CREATION.md` § 8c — Update state after merge, without waiting for a verbal cue, regardless of the profile's `git.merge_strategy`. Record the merge SHA in SUMMARY.md as usual.
- Any gate short of that bar → the phase parks instead. PASS-WITH-WARNINGS security verdicts auto-merge but their warnings are listed in REPORT.md.

## Resume

The run must survive session death (compaction, crash, quota wakeup).

- `run.json` is updated at every phase status transition; `STATE.md` carries a pointer (`## Active Autonomous Run: <run-id>`).
- Relaunching `/riff:next --autonomous` or `/riff:wave --autonomous` with an in-flight `run.json` resumes it: skip front-load entirely (decisions are already locked), re-enter at the first non-terminal phase, reusing the standard crash-residue and branch-resume mechanics of `protocols/RECONCILE.md` § Step 2b — Crash residue checks (pre-branch).
- Resume never re-opens locked decisions. A contradiction discovered on resume (per `protocols/HANDOFF.md`) parks the affected phase instead of re-asking.

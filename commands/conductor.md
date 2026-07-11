---
description: Sweep every registered project, advance each safe backlog through the autonomous loop, deliver one consolidated report
allowed-tools: Bash, Read, Write, Glob, Grep, AskUserQuestion
args: "[--dry-run] [--projects a,b] [--max-runs-per-project N] [--wave] [--scheduled]"
model: opus  # static mirror of profile.yaml models.reasoning (frontmatter can't read config); keep in sync
---

# /riff:conductor [--dry-run | --projects a,b | --max-runs-per-project N]

Advance the whole portfolio, one project at a time, unattended. Contract: `protocols/CONDUCTOR.md`. The Conductor orchestrates the EXISTING autonomous loop (`protocols/AUTONOMY.md`) per project; it never merges, never edits autonomy state, never asks mid-sweep.

Run from the framework root (`~/DEV/frameworks/riff`). All deterministic pieces are `.riff/scripts/riff-conductor.mjs` (the same file lives at the framework root as `riff-conductor.mjs` under its scripts directory).

## Arguments

- `--dry-run` → print the plan (advance/skip per project, with reasons) and stop. Writes nothing, launches nothing.
- `--projects a,b` → restrict the sweep to the named projects (directory name or full path).
- `--max-runs-per-project N` → per-project loop budget, passed as `--max-runs` (default 3).
- `--wave` → advance with `/riff:wave --autonomous --loop` instead of `/riff:next --autonomous --loop`.
- `--scheduled` → headless morning-run mode: only `auto_advance: true` projects, no approval question (`protocols/CONDUCTOR.md` § Approval model).

## Step 0 — Resume check

```bash
node .riff/scripts/riff-conductor.mjs state read 2>/dev/null
```

A run with `status: running` means a previous Conductor died or paused mid-sweep: skip Steps 1–3, re-enter Step 4 at its `next_project` with the recorded plan. Approval is never re-asked on resume. No running state → new run, continue.

## Step 1 — Plan (sweep + select)

```bash
node .riff/scripts/riff-conductor.mjs stop-check   # exit 3 = STOP file present: report it and end here
node .riff/scripts/riff-conductor.mjs plan --json [--scheduled] [--projects a,b]
```

The plan lists, per registered project, `advance` (with the safe phases, or the resume action) or `skip` (with the reason: `scratch`, `not-opted-in`, `invalid-roadmap`, `dirty-tree`, `diverged`, `in-flight-session`, `ambiguous-state`, `merges-blocked`, `no-eligible-work`, `missing`, `not-a-git-repo`). Selection rules: `protocols/CONDUCTOR.md` § Eligibility rules.

`--dry-run` → print the human-readable plan (`plan` without `--json`) and STOP. Zero advance candidates (any mode) → print the skips and stop; nothing to do is a valid outcome, not an error.

## Step 2 — One approval (interactive only)

Present ONE summary: projects in order, phases per project, resume actions, every skip with its reason, the per-project run budget. One `AskUserQuestion` yes launches the whole sweep. Anything she wants changed (drop a project, cap runs) → adjust the plan once, re-present, still one yes.

`--scheduled` skips this step entirely — `auto_advance: true` is the standing approval.

After the yes (or in scheduled mode, immediately): mint the run-id (`YYYY-MM-DD-HHMM`), save the plan and init the state:

```bash
node .riff/scripts/riff-conductor.mjs plan --json [flags] > .planning/conductor/<run-id>/plan.json
node .riff/scripts/riff-conductor.mjs state init --run <run-id> --plan .planning/conductor/<run-id>/plan.json
```

From here until REPORT.md, `AskUserQuestion` is forbidden.

## Step 3 — Advance each project (sequential)

For each `pending` project, in plan order — never more than one at a time:

1. **Kill switches**: `node .riff/scripts/riff-conductor.mjs stop-check --project <path>` — exit 3 → `state finish --run <run-id> --status stopped --reason kill-switch`, jump to Step 4 with what completed.
2. **Usage guard**: mechanics of `commands/wave.md` § Usage guard (`ccusage` ≥95% on the 5-hour block or the weekly window → do NOT launch; schedule a wakeup carrying the run-id, resume at Step 0). Quota pauses the sweep, never kills it.
3. **Mark + launch**:

   ```bash
   node .riff/scripts/riff-conductor.mjs state project --run <run-id> --project <path> --status advancing
   cd <path> && claude -p "/riff:next --autonomous --loop --max-runs <N>"   # --wave: /riff:wave --autonomous --loop
   ```

   Run the child in the background and WAIT for it to exit before the next project (a loop runs for hours; never launch the next one early). The child enforces the whole autonomy contract itself — launch lock, resume, finishers, merge policy, batched verification. The Conductor adds no flags beyond `--max-runs`.
4. **Record**: child exited cleanly → `state project ... --status done`. Child failed to start or crashed → `state project ... --status halted --reason "<one line>"`, continue with the next project. A halted project is a report line, not a sweep failure.

## Step 4 — Consolidate + notify

1. Aggregate: each advanced project's latest run REPORT.md (`.planning/autonomy/<run-id>/REPORT.md` inside that project), its loop `stop_reason` when the loop braked, the halted/skipped reasons from `conductor.json`, and the cross-project inbox:

   ```bash
   node .riff/scripts/riff-pending.mjs --json
   ```

2. Compose `.planning/conductor/<run-id>/REPORT.md` from `templates/CONDUCTOR-REPORT.md`: portfolio table, per-project sections, aggregated pending inbox, skipped table, exact next commands (finisher resolutions first). Finisher lines follow `protocols/AUTONOMY.md` § Finishers: machine evidence translated to plain language, ONE recommended action each — never a security/payment question.
3. Close and ping once:

   ```bash
   node .riff/scripts/riff-conductor.mjs state finish --run <run-id>
   bash .riff/hooks/notify-human.sh "Conductor <run-id>: <A> advanced, <M> merged, <P> parked, <F> finishers pending — .planning/conductor/<run-id>/REPORT.md"
   ```

One message, whatever happened. Per-project loop pings already fired from the loops themselves; the Conductor never duplicates them.

## Failure modes

Full table: `protocols/CONDUCTOR.md` § Failure modes. The short version: STOP stops between projects, quota pauses and resumes, a crashed child halts only its own project, a dead Conductor resumes from `conductor.json` at Step 0.

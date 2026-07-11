# Cross-Project Conductor Protocol

One command, the whole portfolio. The Conductor sweeps every registered project, advances each one's safe backlog through the EXISTING autonomous loop, and hands the operator ONE consolidated report. She approves instead of operating: the only decisions that come back to her are the parked finishers.

The Conductor is a thin orchestration layer over `protocols/AUTONOMY.md`. It consumes the autonomy protocol unchanged and adds NO new interaction points, NO new merge path, and NO state files it edits by hand. Everything deterministic lives in `.riff/scripts/riff-conductor.mjs` (the same file lives at the framework root); the orchestration steps live in `commands/conductor.md`.

## Hard boundaries (inherited, never overridden)

- **No merge path.** The Conductor never merges anything itself. Merges happen inside each project's autonomous loop, behind `.riff/scripts/finisher-guard.mjs` and the gates of `protocols/AUTONOMY.md` § Merge policy. A `hold` phase parks with a finisher exactly as in a hand-launched run.
- **No state hand-edits.** Lock, loop.json, run.json, finisher files: only via `.riff/scripts/autonomy-state.mjs` and `.riff/scripts/finisher-guard.mjs`, and only inside the loop the Conductor launches. The Conductor's own bookkeeping goes through `.riff/scripts/riff-conductor.mjs state`.
- **Sequential, never parallel.** One project's loop finishes before the next starts — quota and git safety. Never two autonomous loops at once, in any mode.
- **No questions she cannot answer.** Security, privacy, GDPR, and payment questions are never asked; they park as finishers per `protocols/AUTONOMY.md` § Finishers, and the report ends each with one plain-language recommended action.

## Lifecycle

```
sweep -> select -> advance (per project, sequential) -> consolidate -> notify
```

1. **Sweep.** Registry = `profile.yaml` → `dashboard.projects` (deduped by inode, same resolution as `.riff/scripts/riff-pending.mjs`).
2. **Select.** `node .riff/scripts/riff-conductor.mjs plan --json` evaluates every project against the eligibility rules below and returns advance/skip per project. `plan` is strictly read-only.
3. **Advance.** For each selected project in registry order: check the kill switches, check the usage guard, then launch that project's autonomous loop and wait for it to finish (see § Advancing one project).
4. **Consolidate.** Aggregate each advanced project's run REPORT.md, the skip reasons, and the cross-project inbox (`node .riff/scripts/riff-pending.mjs --json`) into ONE report from `templates/CONDUCTOR-REPORT.md`, written to `.planning/conductor/<run-id>/REPORT.md` at the framework root.
5. **Notify.** One message via `bash .riff/hooks/notify-human.sh` (`protocols/AUTONOMY.md` § Notifications mechanics): advanced/merged/parked counts, pending finisher count, report path.

## Eligibility rules

A project is advanced only when ALL checks pass; any failure skips it with the reason logged in the plan and the report. Skip and LOG, never auto-fix.

| Check | Skip reason |
| --- | --- |
| Directory exists | `missing` |
| Is a git repository | `not-a-git-repo` |
| `.planning/config.json` scope is not `scratch` (missing config = production) | `scratch` |
| Scheduled runs only: `auto_advance: true` in `.planning/config.json` | `not-opted-in` |
| `ROADMAP.yaml` present, parseable, with phases | `invalid-roadmap` |
| No tracked modifications (untracked-only files are fine, counted in the report — same convention as `protocols/AUTONOMY.md` front-load step 1) | `dirty-tree` |
| Default branch not diverged from the locally known `origin/<branch>` (no network fetch; the loop's own Step 0 sync re-checks with a real fetch and parks on divergence — this is defense in depth) | `diverged` |
| No live launch lock (`lock status` held and not stale — another session is already running this project) | `in-flight-session` |
| `resolve-launch` does not answer `halt-ambiguous` (several unfinished runs: a human untangles it, the Conductor never starts work beside an unresolved state) | `ambiguous-state` |
| No global no-merge blocker: an unreadable finisher file, a malformed entry without a branch, or a pending branchless security/payment/branch marker blocks every merge in the project (fail closed, same rules as `.riff/scripts/finisher-guard.mjs`) | `merges-blocked` |
| At least one eligible phase: `status: todo`, all `depends_on` satisfied (`done` or `skipped`), classified `safe` by the autonomy boundary (`classify` on tags + title + slug + description; `provider_mode: production` is always `hold`) | `no-eligible-work` |

**Resume beats freshness.** When `resolve-launch` answers `resume`, `restart-run`, or `continue-loop` (an unfinished autonomous state with no live session), the project is advanced even with zero new safe phases: launching the loop RESUMES that state per `protocols/AUTONOMY.md` § Resume, which is the only correct way to finish it. The Conductor never reads run state on its own — `resolve-launch` is authoritative.

`hold`-classified phases are never selected. They are counted in the plan (`holds`) so the report can say what is waiting on a human, and they build only when the loop itself reaches them — parked, never merged.

## Advancing one project

1. **Kill switches.** `node .riff/scripts/riff-conductor.mjs stop-check --project <path>` — exit 3 (a STOP file exists, global or per-project) halts the Conductor between projects: mark the run `stopped`, write the report for what completed, notify. The global switch is `.planning/autonomy/STOP` at the framework root; each project's own `.planning/autonomy/STOP` additionally stops that project's loop (`protocols/AUTONOMY.md` § Loop mode).
2. **Usage guard.** Same mechanics as `commands/wave.md` § Usage guard: at ≥95% of the 5-hour block or the weekly window, do NOT launch the next project; schedule a wakeup carrying the conductor run-id and resume when the window clears. Quota pauses the Conductor, never kills it. Never interrupt an in-flight loop to save budget.
3. **Launch the loop headlessly.** Run the project's autonomous loop in a fresh child session with the project as working directory:

   ```bash
   claude -p "/riff:next --autonomous --loop --max-runs <N>"
   ```

   `<N>` = `--max-runs-per-project` (default 3). Fresh context per project by construction; the loop applies `protocols/AUTONOMY.md` end to end (launch lock, front-load already locked or non-interactive resume, finishers, merge policy, batched verification). Wave-shaped projects may use `/riff:wave --autonomous --loop` instead via the `--wave` flag. Wait for the child to exit before touching the next project.
4. **Record the outcome.** `state project --status done` (loop finished, whatever it merged or parked) or `--status halted --reason <why>` (child failed to start, crashed, or its loop paused on a blocker). A halted project never blocks the rest of the sweep: log it, continue, surface it in the report.

The child session is trusted to enforce its own safety: the Conductor passes no flags that weaken the autonomy contract, and there is nothing the Conductor could pass that would — merge policy and finisher enforcement live inside the loop's own scripts.

## Approval model

- **Interactive (`/riff:conductor`).** One plan — which projects, which phases, in which order, with every skip and its reason — presented once. One yes launches the whole sweep. After that yes, zero questions until the report (`AskUserQuestion` is forbidden mid-sweep, same rule as `protocols/AUTONOMY.md` front-load step 6).
- **Scheduled (`--scheduled`).** No questions at all. Only projects with `auto_advance: true` in their `.planning/config.json` are touched — opting a project in ONCE is the standing approval for every scheduled run. Default is `false`: a project never opted in is never advanced by a scheduled Conductor.
- **`--dry-run`.** Prints the plan (advance/skip per project, phases, reasons) and stops. Writes nothing, launches nothing, touches no branch.

## Config surface

| Knob | Where | Default | Meaning |
| --- | --- | --- | --- |
| `auto_advance` | each project's `.planning/config.json` | `false` | Standing approval for scheduled sweeps. Set it with a one-line edit or by asking ("opt <project> into auto-advance"). |
| `--projects a,b` | flag | all registered | Restrict the sweep to the named projects (directory name or full path). |
| `--max-runs-per-project N` | flag | 3 | Passed to each loop as `--max-runs` — bounds one project's appetite so a single roadmap cannot eat the whole quota window. |
| `--wave` | flag | off | Advance with `/riff:wave --autonomous --loop` instead of `/riff:next --autonomous --loop`. |
| `--scheduled` | flag | off | Headless mode: `auto_advance` projects only, no approval question, same report + notification. |

## Run directory and resume

`.planning/conductor/<run-id>/` at the framework root, run-id = `YYYY-MM-DD-HHMM` at launch:

| File | Role |
| --- | --- |
| `plan.json` | The approved plan, verbatim (`plan --json` output). |
| `conductor.json` | Machine state: per-project `pending / advancing / done / halted / skipped(+reason)`, run status `running / done / stopped`. Written atomically by `state` subcommands only. |
| `REPORT.md` | The consolidated report, from `templates/CONDUCTOR-REPORT.md`. |

A killed or quota-paused Conductor resumes cleanly: `node .riff/scripts/riff-conductor.mjs state read` returns the latest `running` run and its `next_project` — re-enter the advance stage there. Before re-launching a project's loop, the per-project `resolve-launch` inside that launch handles whatever the interrupted child left behind; the Conductor never reconciles a project's autonomy state itself. Approval is not re-asked on resume — the recorded plan is the locked front-load.

## Scheduled contract (the morning run)

No scheduler primitive ships with RIFF; the contract is one cron entry on the machine (or runner) that hosts the projects:

```cron
30 6 * * * cd ~/DEV/frameworks/riff && claude -p "/riff:conductor --scheduled" >> ~/.riff/conductor-cron.log 2>&1
```

Requirements: the `claude` CLI authenticated for the operator, permissions pre-authorized for unattended autonomous runs (runner provisioning is out of scope here), and `notifications.channel` configured in `profile.yaml` so the one report ping actually lands. The scheduled run produces exactly the same report and notification as an interactive one; the only differences are the missing approval question and the `auto_advance` filter.

## Failure modes

| Failure | Behavior |
| --- | --- |
| STOP file appears mid-sweep | Finish the in-flight project's loop, then stop between projects: `state finish --status stopped`, report + notify for what completed. |
| Usage guard fires between projects | Pause, schedule a wakeup with the run-id, resume at `next_project`. Never a stop. |
| Child session fails to start or crashes | `state project --status halted --reason <why>`, continue with the next project, surface in the report. The project's own lock/resume machinery makes the next launch safe. |
| A project's loop pauses on a BLOCKER finding | That is the loop's own brake (`protocols/AUTONOMY.md` § Loop mode stop criteria); the Conductor records `done`, the finisher and stop reason land in the report. |
| Registry project missing / not a repo / corrupt roadmap | Skip with reason, never auto-fix, always visible in the report. |
| Conductor session dies | Relaunch resumes from `conductor.json` (§ Run directory and resume). Projects already `done` are never re-advanced in the same run. |

# RECONCILE — pre-phase sync and crash recovery

Procedures used by `/riff:next`:

- **Step 0** — sync main and reconcile stale bookkeeping before picking the next phase.
- **Step 2b checks** — detect crash residue from a prior run before creating the phase branch.

Cross-references (shared state touched by other steps):

- `.planning/active-phase.txt` — sidecar. Step 0 clears it, Step 2b writes it, Step 8c clears it on `local_no_ff` merge.
- STATE.md `## Active Phase` — same shared lifecycle as the sidecar.
- `CRASH.json` — Step 0 wipes files with `verdict: abandoned`, Step 5 writes new ones on executor crash, Step 2b reads partial state to decide resume/restart.

---

## Step 0 — Sync main + reconcile stale bookkeeping

When `merge_strategy: github_button`, the previous session stops after opening the PR. If the user merges later on GitHub, the previous phase is shipped on main but still `status: todo` in ROADMAP.yaml. Step 0 catches that drift before picking the next phase, and also guarantees Step 2b branches from a clean main.

### Session sidecar reset (do FIRST)

Before any git operation, clear runtime sidecars left over from any prior `/riff:next` run:

```bash
# Cleared by every Step 0 start. Rewritten by Step 2b once a new phase is picked.
rm -f .planning/active-phase.txt

# Wipe stale CRASH.json files from any phase the user previously aborted
# (verdict: abandoned). The fresh run gets a clean slate; if Step 5 crashes
# again, it writes a fresh CRASH.json with the current timestamp.
find .planning/phases -name CRASH.json -exec grep -l '"verdict": *"abandoned"' {} \; 2>/dev/null | xargs rm -f 2>/dev/null || true
```

### Active Phase section bootstrap

If `STATE.md` does not yet have an `## Active Phase` section (legacy projects from before this contract), insert one. Detection: `grep -q '^## Active Phase' STATE.md`.

Insertion anchors, in priority order:

1. Insert between `## Current Position` and `## Active Decisions` (canonical position).
2. If `## Active Decisions` is not found, insert immediately after the `## Current Position` block.
3. If `## Current Position` is also not found, prepend the section after the first level-1 heading (top of file).

```markdown
## Active Phase

- **Id**: -
- **Slug**: -
- **Branch**: -
- **Step**: -
```

If the section already exists, reset all four field values to `-`.

### Sub-steps

1. **Switch to main + check divergence (do NOT blindly pull).**

   ```bash
   git checkout main
   git fetch origin main
   ahead=$(git rev-list --count origin/main..main)
   behind=$(git rev-list --count main..origin/main)
   ```

   Branch on the result:

   - **In sync (`ahead=0` AND `behind=0`):** continue.
   - **Behind only (`ahead=0`, `behind>0`):** `git pull --ff-only origin main`.
   - **Ahead only (`ahead>0`, `behind=0`):** local has unpushed commits on main. Surface to the user: `Local main has <ahead> unpushed commits. Push now? (yes / skip)`. On `yes`: `git push origin main`. On `skip`: continue without pushing.
     **Autonomous runs** ([`AUTONOMY.md`](./AUTONOMY.md) § Conversion table): push automatically without asking — the ahead-only commits are our own local merge commits, safe to push. If the push fails (network, permissions), log the failure to the run's REPORT.md and continue; never ask.
   - **Diverged (`ahead>0` AND `behind>0`):** **STOP and surface — do not auto-fix.** Common cause: a recent PR was squash-merged on GitHub and the squash bundled local-only commits that existed on the phase branch (e.g. unpushed personal commits Alex had on local main when the phase branch was cut). Print:

     ```
     Local main has <ahead> unpushed commits AND <behind> commits on origin.
     Likely a squash-merge bundling local-only commits on the phase branch.

     1. List the local-only commits and the origin-only commits to compare:
          git log origin/main..main --oneline
          git log main..origin/main --oneline
     2. If the content of every local-only commit is already represented on origin
        (typical when PR was squash-merged): `git reset --hard origin/main`
        aligns local main. Destructive — drops local SHAs, content preserved on origin.
     3. If there is real local work not on origin: rebase or cherry-pick onto
        origin/main, then push.

     Resolve manually before re-running /riff:next.
     ```

     Ask the user how they want to proceed. Do not run any destructive command without explicit confirmation.

     **Autonomous runs** ([`AUTONOMY.md`](./AUTONOMY.md) § Conversion table, § Build rules): never STOP-and-ask, never auto-fix. At LAUNCH (front-load, still interactive): a diverged main blocks the launch — resolve interactively first. MID-RUN or ON RESUME: park all affected non-terminal phases with one `review` finisher describing the divergence (`AUTONOMY.md` § Parking), produce REPORT.md for what completed, notify per `AUTONOMY.md` § Notifications, end the run. No destructive git command, ever.

2. **Detect stale-todo phases.** For each phase in ROADMAP.yaml with `status: todo`, check whether it has shipped on main. Detection runs in three tiers from strongest to weakest signal:

   **Tier 1 — SHA ancestry (canonical).** Read `.planning/phases/<id>-<slug>/SUMMARY.md`. Look for a line matching `^> Merge commit: ([0-9a-f]{7,40})$`. If found, run:

   ```bash
   git merge-base --is-ancestor <sha> main
   ```

   Exit 0 → phase is merged. Exit 1 → not merged yet (continue to next phase). PR titles can be free-form; this check ignores them entirely.

   **Tier 2 — `gh pr view` lookup.** SHA absent from SUMMARY.md but a PR number is recorded (look for `PR #<num>` or `(#<num>)` near the top of SUMMARY.md). Try:

   ```bash
   gh pr view <PR-number> --json mergeCommit,state -q '.state + " " + (.mergeCommit.oid // "")'
   ```

   If state is `MERGED` and a SHA comes back, write the line `> Merge commit: <sha>` into SUMMARY.md: replace the `{{MERGE_COMMIT}}` placeholder if the line exists, otherwise insert a new `> Merge commit: <sha>` line into the blockquote header block (right after `> Duration:`) so legacy SUMMARY.md files written before this line was templated still get the SHA. Then re-run the Tier 1 ancestry check to confirm.

   **Tier 3 — commit-subject grep (legacy fallback).** Only if Tiers 1 and 2 give nothing. Pre-Phase-4 phases have no `> Merge commit:` line and may not have a PR number recorded:

   ```bash
   git log --oneline --grep="Phase <id>:" main | head -1
   ```

   A match means the PR was merged with the canonical RIFF subject. If none of the three tiers detect a merge, the phase is genuinely still todo.

3. **If a stale-todo phase is found:**
   - Read `.planning/phases/<id>-<slug>/SUMMARY.md` to get the shipped scope, file/test counts, and PR number.
   - Set `status: done` for that phase in ROADMAP.yaml.
   - Update STATE.md: rewrite the `## Current Phase` prose to describe the shipped phase, append a row to the `## Phases Completed` table, refresh `## Next Action` to drop the now-shipped phase from "eligible".
   - Commit:
     ```bash
     git add ROADMAP.yaml STATE.md .planning/phases/<id>-<slug>/SUMMARY.md
     git commit -m "docs(phase-<N>): mark done in roadmap and state after merge"
     git push origin main
     ```

   The SUMMARY.md is included in the commit when Tier 2 just back-filled the merge SHA, so the durable artifact catches up to reality.

4. **No stale phase found:** continue to the dirty-tree preflight (below).

5. **Dirty-tree preflight.** Run `git status --porcelain`. If output is non-empty, classify each line: UNTRACKED (`??`) vs TRACKED modifications (everything else).

   - **All dirty files are inside `.planning/` only:** auto-skip. These are RIFF artifact residue (interrupted hook writes, etc.) safe to leave; Step 5's executor will overwrite them. Print a one-line notice and continue.
   - **Only UNTRACKED files outside `.planning/`:** never a question, in ANY mode. Untracked files cannot leak into a phase commit (atomic commits, never `git add .`) and asking about the same stray notes at every launch is noise. Print a one-line notice listing them (max 5) and continue. Autonomous runs: list them in REPORT.md.
   - **TRACKED modifications outside `.planning/`:** autonomous runs — launch AND mid-run — take option A without prompting + a DECISIONS entry ([`AUTONOMY.md`](./AUTONOMY.md) § Conversion table); the stash is recoverable, so nothing is lost and no question is worth blocking the run. Interactive sessions AskUserQuestion:
     > Working tree has uncommitted changes outside .planning/:
     > <git status --porcelain output, max 10 lines>
     > A) Stash and continue (recovered after PR)
     > B) Abort, commit or discard manually then re-run /riff:next

     On A: `git stash push -m "riff-preflight-stash-<timestamp>"`. Record the stash ref in STATE.md `## Open Buckets` (`Stashed before phase <N>: <stash-ref>`). Continue.
     On B: halt.

---

## Step 2b — Crash residue checks (pre-branch)

Before creating the phase branch, run two preflight checks against the picked phase to detect crash residue from a prior run.

### Check 2b-i — existing branch

If `git branch --list "riff/phase-N-slug"` returns non-empty, the branch was created in a prior run.

- If `.planning/phases/N-slug/SUMMARY.md` exists, jump to Check 2b-ii (partial SUMMARY.md drives the decision).
- If SUMMARY.md does NOT exist, the branch was created but execution never started. Autonomous runs: take option A without prompting + DECISIONS entry. AskUserQuestion:
  > Branch riff/phase-N-slug exists but no SUMMARY.md found. Likely a crashed run before execution started.
  > A) Delete branch and start fresh (recommended)
  > B) Abort, inspect manually

  On A: `git branch -D riff/phase-N-slug && git push origin :riff/phase-N-slug 2>/dev/null || true`. Continue.
  On B: halt.

### Check 2b-ii — partial SUMMARY.md

If `.planning/phases/N-slug/SUMMARY.md` exists AND the phase is `status: todo` in ROADMAP.yaml AND the file does NOT contain a `> Merge commit: <40-char-sha>` line (i.e. the line is absent or still reads `{{MERGE_COMMIT}}`), this is a crashed Step 5 from a prior run.

- If `.planning/phases/N-slug/PLAN.md` does NOT exist (very early crash, before plan was written), delete SUMMARY.md and continue from Step 4 normally.
- Otherwise (autonomous runs: take option A Resume without prompting + DECISIONS entry) AskUserQuestion:
  > Phase N-slug has a partial execution log (SUMMARY.md exists, executor appears to have crashed before completing).
  > A) Resume — checkout the existing branch, re-run from Step 5 (executor re-reads PLAN.md and continues; may produce duplicate commits for already-done tasks)
  > B) Restart — delete SUMMARY.md and re-plan from scratch
  > C) Abort, inspect manually

  On A:
    - `git checkout riff/phase-N-slug` (if branch missing, fall back to B with a warning).
    - Update STATE.md `## Open Buckets` with one line: `Resuming crashed phase N-slug from Step 5 — SUMMARY.md was partial`.
    - Skip Steps 2c (PROMPTS.md already exists), 3, 4, 4b, 4c. Jump to the active-phase sidecar write below, then to Step 5.
  On B:
    - `rm .planning/phases/N-slug/SUMMARY.md` (keep PLAN.md, planner reuses it).
    - `rm -f .planning/phases/N-slug/CRASH.json` (clean previous crash marker if any).
    - `git branch -D riff/phase-N-slug 2>/dev/null || true`.
    - `git push origin :riff/phase-N-slug 2>/dev/null || true`.
    - Continue (branch is recreated below).
  On C: halt.

# PR-CREATION — Step 8 procedure

Three sub-steps run in order: documentation check, push + PR composition + merge strategy branching, post-merge state update.

**Invariant:** do NOT update ROADMAP.yaml or STATE.md on the feature branch. Those mutations land on `main` (via Step 8c on `local_no_ff`, or via Step 0 stale-todo reconciliation on the next `/riff:next` run for `github_button` / `auto_merge`).

Cross-reference: Step 8c clears `.planning/active-phase.txt` and STATE.md `## Active Phase` — the same sidecar that Step 0 clears at the start of each run and Step 2b writes when a new phase is picked. See [`RECONCILE.md`](./RECONCILE.md) § Step 0.

---

## 8a — Documentation check (BLOCKING)

Compare SUMMARY.md against `.claude/references/project-details.md` (file tree), `docs/architecture.md` (service/route tables), `taste.md` (new patterns). Stale → spawn Haiku sub-agent to update before PR.

**README check (BLOCKING):** if `README.md` does NOT exist at the project root, halt 8a and write one before proceeding. Rescue path for projects bootstrapped before `start.md` had the README step (or for brownfield onboardings via `/riff:init` that never ran `/riff:start`). Seed from PROJECT.md (or the project's CLAUDE.md if PROJECT.md is missing). Sections per the `start.md` Stage 5 production scope spec (project name + context + stack + local dev commands + workflow + repo layout + status). Cross-check the dev commands match `package.json` `scripts:`. Skip on `scope: scratch` (a one-line stub README is fine for scratch projects but still required).

---

## 8b — Push + PR

1. `git push -u origin riff/phase-N-slug`
2. Compose the PR body:
   a. Draft the human summary (phase title, artifacts touched, review + security verdict, key changes from SUMMARY.md)
   b. **Finalize PROMPTS.md.** Open `.planning/phases/N-slug/PROMPTS.md`. For any section whose sub-agent did not fire this phase (typically `## Debugger (if invoked)` when no failure occurred, or `## Simplifier` if Step 5b skipped), replace the remaining `{{prompt verbatim}}` placeholder with `_(not invoked)_`. Every section must end up either with the actual prompt or with `_(not invoked)_`. The metadata script in (c) hard-fails if any `{{prompt verbatim}}` remains, blocking PR creation — by design, so stakeholders never see template tokens leaking into the body.
   c. Run `bash .riff/scripts/riff-pr-metadata.sh <phase-id>` and capture stdout — this is the tracked Generation metadata section (models per step, real duration from git timestamps, gates, Codex usage, agents observed in commit trailers, **token usage per agent parsed from USAGE.md**, and **agent prompts in a collapsible block parsed from PROMPTS.md**)
   d. Concatenate: `<human summary>` + `<script stdout>`. The script output already starts with a horizontal rule `---` and an `## Generation metadata (RIFF)` heading, so no separator needed
3. `PR_URL=$(gh pr create --title "<phase title>" --body "<composed body>")`
   Capture stdout (the URL) so every strategy can interpolate the real PR URL into the final report. Required for `auto_merge` (passed to `gh pr merge`); improves report accuracy for the other two.
4. **Read `profile.yaml` `git.merge_strategy`** (resolved per `.riff/references/PROFILE-RESOLUTION.md`; default `github_button` if missing or file missing) and branch:
   - **`github_button`:** print final report ending with `PR open at $PR_URL. Click Merge on GitHub when ready. Run /riff:next again — Step 0 reconciles ROADMAP/STATE on the next run.` STOP. Skip 8c.
   - **`local_no_ff`:** print final report ending with `PR open at $PR_URL. Review on GitHub, then tell me 'merge' to merge locally and continue.` Stay alive. When the user says "merge" (or equivalent), run 8c.
   - **`auto_merge`:** (AFK chaining path)
     1. **Blocking-label check.** Read `git.auto_merge_blocking_labels` from resolved profile (default `["do-not-merge", "wip", "hold"]`). Then:
        ```bash
        labels=$(gh pr view "$PR_URL" --json labels --jq '[.labels[].name] | @csv' | tr -d '"')
        ```
        If any label in `labels` appears in the blocking list, append `LOOP_STOP[$LOOP_ID]: blocking label on PR <PR_URL> — human must resolve` to STATE.md, print the report, STOP.
     2. **Re-verify gates (read-only, no agent re-spawn).** Both must pass:
        - Security: `grep -Eq '^### \[(CRITICAL|HIGH)\]' .planning/phases/<id>-<slug>/SECURITY.md` → any match fails (security-reviewer writes SECURITY.md per `agents/security-reviewer.md` and `templates/SECURITY.md`; CRITICAL/HIGH headings use this exact format).
        - Scope: `jq -e '.verdict == "MATCH"' .planning/phases/<id>-<slug>/SCOPE-CHECK.json` (exit 0 = pass; non-zero = fail). The file is the structured output produced by `agents/scope-checker.md`.
        On either failure: append `LOOP_STOP[$LOOP_ID]: gate failure before auto-merge on PR <PR_URL> — <security|scope>` to STATE.md, print the report, STOP. The gates already ran at Steps 6-7; this is a fast assertion against their durable artifacts.
     3. **Schedule merge:**
        ```bash
        gh pr merge "$PR_URL" --auto --squash --delete-branch
        ```
        Returns immediately; GitHub merges when all required checks pass. Exit code non-zero (e.g. branch protections, auto-merge disabled on the repo): append `LOOP_STOP[$LOOP_ID]: gh pr merge failed on PR <PR_URL>` and STOP.
     4. Print final report ending with `PR open at $PR_URL. Auto-merge scheduled. Loop continues after CI completes; Step 0 of the next run reconciles ROADMAP/STATE.` STOP. Skip 8c (same as `github_button` — Step 0 stale-todo detection handles bookkeeping after the squash-merge lands).

The metadata script lives in the framework at `.riff/scripts/riff-pr-metadata.sh` and reads only tracked artifacts (PLAN.md path, SUMMARY.md path, GATES.md, ROADMAP.yaml, `.planning/codex-usage.csv`, git commit timestamps and trailers). It never includes Claude estimates like the PLAN.md `Estimate:` field — duration comes from first/last commit timestamps.

---

## 8c — Update state after merge

The flow depends on `git.merge_strategy`:

- **`github_button`:** Step 8c is a no-op in this session. Step 0 of the next `/riff:next` run reconciles ROADMAP.yaml + STATE.md.

- **`local_no_ff`:** on the user's "merge" cue:

  ```bash
  git checkout main
  git pull --ff-only origin main
  git merge --no-ff riff/phase-N-slug -m "Phase N: <title> (#<PR-number>)"
  merge_sha=$(git rev-parse HEAD)
  git push origin main
  git branch -d riff/phase-N-slug || git branch -D riff/phase-N-slug
  git push origin :riff/phase-N-slug
  ```

  **Capture the merge SHA into SUMMARY.md.** Replace the `{{MERGE_COMMIT}}` placeholder (or any prior empty value) on the `> Merge commit:` line of `.planning/phases/N-slug/SUMMARY.md` with `$merge_sha`. This is the durable artifact that lets Step 0 of any future `/riff:next` confirm merge state via `git merge-base --is-ancestor` instead of grepping commit subjects.

  **Clear runtime session sidecars:**

  ```bash
  rm -f .planning/active-phase.txt
  ```

  Reset STATE.md `## Active Phase` section: set all four fields back to `-`.

  Then update ROADMAP.yaml (`status: done`) + STATE.md (Current Phase prose, Phases Completed row, Next Action), commit, push:

  ```bash
  git add ROADMAP.yaml STATE.md .planning/phases/N-slug/SUMMARY.md
  git commit -m "docs(phase-N): mark done in roadmap and state after merge"
  git push origin main
  ```

  GitHub auto-closes the PR as merged when it sees the merge commit on origin/main. If `git branch -d` complains "not fully merged" because GitHub already squash-merged a previous run, fall back to `-D` (the branch is merged in spirit).

- **`auto_merge`:** skipped — Step 0 stale-todo detection on the next run handles bookkeeping after the squash-merge lands.

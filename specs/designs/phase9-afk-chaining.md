# Phase 9 — AFK Chaining (auto-merge + merge-wait): Design

> **Status:** Design (not yet implemented).
> **Source plan:** `specs/plans/audit-fixes.md` § Phase 9.
> **Owner:** alexandra (manual execution per RIFF phase workflow).
> **Depends on:** Phase 2 (`templates/settings.afk.json` must exist). Phase 5 recommended (durable per-step artifacts) but not blocking.

The AFK loop currently stops after each PR and waits for a human to merge. This design adds `auto_merge` as a third `git.merge_strategy` value. When set, `/riff:next` Step 8 schedules GitHub auto-merge after all gates pass; Step 0 grows a merge-wait sub-step that polls until the prior PR lands before picking the next phase; `riff-loop.sh` replaces its fixed cooldown with adaptive polling; and two new security files unlock `gh pr merge --auto --squash --delete-branch` exclusively for the `auto_merge` strategy while leaving the existing Phase 2 deny rules intact for all other strategies.

---

## 1. TL;DR

Five things change:

1. `templates/profile.neutre.yaml` adds `auto_merge` to the `git.merge_strategy` enum and a `loop:` section with `merge_wait_timeout_min`.
2. `commands/next.md` Step 8b gains an `auto_merge` branch: capture PR URL from `gh pr create`, check blocking labels, re-verify gates, then call `gh pr merge "$PR_URL" --auto --squash --delete-branch`. Step 8c is a no-op for `auto_merge` (same as `github_button`).
3. `commands/next.md` Step 0 gains sub-step 0.1a: poll open RIFF PRs until merged, closed, blocked-by-label, or timed out. Writes `LOOP_STOP[$LOOP_ID]: <reason>` on any non-merge outcome.
4. `riff-loop.sh` reads `MERGE_STRATEGY` and `MERGE_WAIT_TIMEOUT` at startup, selects the correct AFK settings file, makes the HEREDOC instruction strategy-conditional, and replaces the fixed `sleep "$COOLDOWN"` with an adaptive poll loop for `auto_merge`.
5. Two new security files: `templates/settings.afk.auto-merge.json` (settings copy with `gh pr merge --auto --squash --delete-branch` in allow, `gh pr merge *` removed from deny) and `hooks/dangerous-command-guard.auto-merge.sh` (guard copy with a surgical carve-out that permits exactly the three-flag form and rejects everything else including compound commands).

`github_button` and `local_no_ff` behavior is unchanged.

---

## 2. Decisions (five open questions from the plan)

### D1 — Timeout default

**30 minutes, configurable as `git.merge_wait_timeout_min` in profile.** Rationale: most CI runs complete in 5-15 min; 30 min leaves headroom for slow test suites without letting a hung CI block the loop overnight. A 2h default would be too loose for the common case and would make a failing CI effectively silent. If a project consistently needs longer, the user sets `merge_wait_timeout_min: 120` in their profile.

### D2 — PR closed without merge (CI failure or manual close)

**Write LOOP_STOP and exit. Do not retry.** Specific marker: `LOOP_STOP[$LOOP_ID]: PR #N closed without merge — CI failure or manual close`. The loop halts. The user inspects the PR, fixes, and re-runs. Rationale: an auto-retry risks repeated failed CI runs against code the user may need to change. A LOOP_STOP gives the human the same information as a normal stop signal and the same recovery path (re-run `/riff:next` or `riff-loop.sh`).

### D3 — `local_no_ff` and merge-wait

**Merge-wait (sub-step 0.1a) does not apply to `local_no_ff`.** That strategy is HITL by definition: the loop stops after each PR and waits for the user to say "merge." No polling needed. Sub-step 0.1a is guarded by `if [ "$MERGE_STRATEGY" = "auto_merge" ]`. For `github_button`, Step 0's existing stale-todo detection (Tier 1-3) already handles the reconciliation case where a PR was merged while the session was closed.

### D4 — Gate requirement for auto-merge

**Strict-AND: all three must pass before scheduling auto-merge.**

| Gate | Source of truth | What counts as pass |
|------|-----------------|---------------------|
| Security-reviewer | REVIEW.md `## Security verdict` | No CRITICAL or HIGH findings |
| Scope-checker | PLAN.md acceptance criteria vs. diff | MATCH (no out-of-scope drift) |
| GitHub CI | `gh pr view $PR_URL --json statusCheckRollup` | All checks PASS or SKIPPED (no FAILURE/ERROR/PENDING after a configurable window) |

If any gate fails before the `gh pr merge` call, write `LOOP_STOP[$LOOP_ID]: gate failure before auto-merge on PR #N — <gate name>` and exit. This check re-runs the fast gate assertions (reading REVIEW.md and PLAN.md outputs that already exist) rather than re-spawning agents; the agents already ran at Steps 6-7.

### D5 — Blocking labels

**Yes, with configurable defaults.** Profile field: `git.auto_merge_blocking_labels` (list of strings, default `["do-not-merge", "wip", "hold"]`). If any label from this list appears on the PR when Step 8b.4 runs, write `LOOP_STOP[$LOOP_ID]: blocking label on PR #N — human must resolve` and exit. The user adds a blocking label on GitHub to pause chaining without killing the loop process. To resume, remove the label and re-run the loop. The label list is evaluated at schedule time and again by sub-step 0.1a's polling loop (so adding a label after the PR is created but before it merges also stops the loop).

---

## 3. Contract by component

### A. `templates/profile.neutre.yaml`

Add inline comment on the `merge_strategy` line documenting the three valid values. Add a commented `auto_merge_blocking_labels` line under `git:`. Add a new `loop:` section with `merge_wait_timeout_min` commented out at its default.

**Exact changes (relative to current file line 38-39):**

```yaml
git:
  # Valid values: github_button | local_no_ff | auto_merge
  merge_strategy: github_button
  # auto_merge_blocking_labels: ["do-not-merge", "wip", "hold"]

loop:
  # merge_wait_timeout_min: 30    # Default 30. Only used when merge_strategy: auto_merge.
```

The `loop:` section is new. The `auto_merge_blocking_labels` line is commented-out so the default list is picked up by code; the user uncomments and edits to override.

### B. `commands/next.md` — Step 8b (PR creation + merge strategy branch)

**Change 1 (line 575): capture PR URL.**

Current: `3. \`gh pr create --title "<phase title>" --body "<composed body>"\``

New: `3. \`PR_URL=$(gh pr create --title "<phase title>" --body "<composed body>")\``

This is load-bearing for all three strategies — `github_button` and `local_no_ff` need the URL to print it in the report. The variable was silently unused before.

**Change 2 (lines 576-578): add `auto_merge` branch to the strategy switch.**

After the existing `local_no_ff` bullet, add:

```
- **`auto_merge`:** (AFK chaining path)
  a. Read `git.auto_merge_blocking_labels` from resolved profile (default `["do-not-merge", "wip", "hold"]`).
     Run: `gh pr view "$PR_URL" --json labels --jq '[.labels[].name] | map(select(. == "LABEL")) | length'`
     for each label in the list. If any match: write `LOOP_STOP[$LOOP_ID]: blocking label on PR #N — human must resolve` to STATE.md. Print report. STOP.
  b. Re-verify gates (read-only, no agent re-spawn):
     - Security gate: `grep -q 'CRITICAL\|HIGH' .planning/phases/N-slug/REVIEW.md` → any match fails.
     - Scope gate: `grep -q '^Status: MATCH' .planning/phases/N-slug/PLAN.md` → absence fails.
     If either fails: write `LOOP_STOP[$LOOP_ID]: gate failure before auto-merge on PR #N — <security|scope>` to STATE.md. Print report. STOP.
  c. Schedule merge: `gh pr merge "$PR_URL" --auto --squash --delete-branch`
     This returns immediately; GitHub merges when all required checks pass.
  d. Print final report: `PR open at $PR_URL. Auto-merge scheduled. Loop continues after CI completes.` STOP.
  e. Skip 8c (same as github_button — Step 0 of next run reconciles via stale-todo detection).
```

**No change to Step 8c** for `auto_merge`. The `github_button` no-op branch already covers it: Step 0 stale-todo detection (Tier 1 SHA ancestry, Tier 2 gh pr view lookup) will find the merged PR and update ROADMAP/STATE.

### C. `commands/next.md` — Step 0 (merge-wait sub-step 0.1a)

Insert between the existing Step 0.1 "Switch to main + check divergence" block and the existing Step 0.2 "Detect stale-todo phases" block. Guard with `if merge_strategy == auto_merge`.

**New sub-step 0.1a text (to insert):**

```
**0.1a — Merge-wait (auto_merge strategy only).** Skip entirely if `git.merge_strategy` is not `auto_merge`.

Read `git.merge_wait_timeout_min` from resolved profile (default 30). Compute deadline: `deadline = now + timeout_min * 60`.

Enumerate open RIFF PRs:

    gh pr list --author @me --state open \
      --json number,headRefName,title \
      --jq '[.[] | select(.headRefName | startswith("riff/phase-"))]'

If the result is empty, skip to Step 0.2. If one or more PRs are open, poll each one every 30 seconds:

    gh pr view <number> \
      --json state,mergeStateStatus,labels \
      --jq '{state: .state, mergeStateStatus: .mergeStateStatus, labels: [.labels[].name]}'

For each poll result, branch:
- `state == "MERGED"`: mark this PR done in the poll list. When all polled PRs are MERGED, continue to Step 0.2 (stale-todo detection will formalize the ROADMAP update).
- `state == "CLOSED"`: write `LOOP_STOP[$LOOP_ID]: PR #N closed without merge — CI failure or manual close` to STATE.md. STOP.
- Any label in the resolved `git.auto_merge_blocking_labels` list appears: write `LOOP_STOP[$LOOP_ID]: blocking label on PR #N — human must resolve` to STATE.md. STOP.
- `now >= deadline`: write `LOOP_STOP[$LOOP_ID]: merge timeout on PR #N after <timeout_min> min` to STATE.md. STOP.
- Otherwise (state `OPEN`, mergeStateStatus `BLOCKED` / `CLEAN` / `UNSTABLE` / `UNKNOWN`): sleep 30s and poll again.

In AFK mode (loop context): the Claude Code agent running `/riff:next` is synchronous. The 30s poll sleep is acceptable inside the agent call — it does not exit the agent between polls. The `riff-loop.sh` adaptive cooldown (Component D) is an additional outer layer for the case where the agent itself exits cleanly after scheduling merge; both layers provide coverage.
```

### D. `riff-loop.sh` — profile reads, settings selection, HEREDOC, adaptive cooldown

Four changes to `riff-loop.sh`. All are guarded by `MERGE_STRATEGY`.

**Change 1: read profile values at startup.** After line 115 (`if [ ! -d ".planning" ]`), add:

```bash
# Read merge strategy and timeout from resolved profile
MERGE_STRATEGY="github_button"  # default
MERGE_WAIT_TIMEOUT=30           # minutes, default
if command -v yq >/dev/null 2>&1; then
  _PROFILE="$("$SCRIPT_DIR/lib/resolve-profile.sh" "$(pwd)" "$SCRIPT_DIR" 2>/dev/null)"
  if [ -n "$_PROFILE" ]; then
    _STRATEGY="$(printf '%s' "$_PROFILE" | yq '.git.merge_strategy // ""' 2>/dev/null)"
    [ -n "$_STRATEGY" ] && MERGE_STRATEGY="$_STRATEGY"
    _TIMEOUT="$(printf '%s' "$_PROFILE" | yq '.loop.merge_wait_timeout_min // ""' 2>/dev/null)"
    [ -n "$_TIMEOUT" ] && MERGE_WAIT_TIMEOUT="$_TIMEOUT"
  fi
fi
notify "Merge strategy: $MERGE_STRATEGY | Merge-wait timeout: ${MERGE_WAIT_TIMEOUT}min" "info"
```

If `yq` is absent, `MERGE_STRATEGY` stays `github_button` (safe default: no auto-merge without explicit opt-in).

**Change 2: settings file selection.** Replace current line 202:

```bash
AFK_SETTINGS="$SCRIPT_DIR/templates/settings.afk.json"
```

With:

```bash
if [ "$MERGE_STRATEGY" = "auto_merge" ]; then
  AFK_SETTINGS="$SCRIPT_DIR/templates/settings.afk.auto-merge.json"
else
  AFK_SETTINGS="$SCRIPT_DIR/templates/settings.afk.json"
fi
```

**Change 3: strategy-conditional HEREDOC instruction.** Replace current line 195:

```
- Never auto-merge PRs. The user reviews and merges manually after the loop completes.
```

With a variable resolved before the HEREDOC:

```bash
if [ "$MERGE_STRATEGY" = "auto_merge" ]; then
  MERGE_INSTRUCTION="- Auto-merge is enabled. After creating the PR and all gates pass, run: gh pr merge \"\$PR_URL\" --auto --squash --delete-branch. Then STOP."
else
  MERGE_INSTRUCTION="- Never auto-merge PRs. The user reviews and merges manually after the loop completes."
fi
```

Then in the HEREDOC, replace the hardcoded line with `$MERGE_INSTRUCTION`. Note: since the HEREDOC delimiter `RIFF_PROMPT` is unquoted (intentional, allows `$LOOP_ID` interpolation), `$MERGE_INSTRUCTION` expands correctly.

**Change 4: adaptive cooldown.** Replace lines 262-266:

```bash
# Cooldown between iterations
if [ $ITERATION -lt $MAX_ITERATIONS ]; then
  echo -e "${BLUE}Cooldown: ${COOLDOWN}s before next iteration...${NC}"
  sleep "$COOLDOWN"
fi
```

With:

```bash
# Cooldown between iterations
if [ $ITERATION -lt $MAX_ITERATIONS ]; then
  if [ "$MERGE_STRATEGY" = "auto_merge" ]; then
    # Adaptive: poll for open RIFF PRs every 30s instead of fixed sleep.
    # The agent's Step 0.1a already polled; this outer loop catches the case
    # where the agent exited early (LOOP_STOP) before the PR merged.
    DEADLINE=$(($(date +%s) + MERGE_WAIT_TIMEOUT * 60))
    POLLING=true
    while $POLLING; do
      OPEN_PR=$(gh pr list --author @me --state open \
        --json number,headRefName \
        --jq '[.[] | select(.headRefName | startswith("riff/phase-"))] | length' 2>/dev/null || echo "0")
      if [ "$OPEN_PR" -eq 0 ]; then
        POLLING=false
      elif [ "$(date +%s)" -ge "$DEADLINE" ]; then
        notify "Outer cooldown: merge timeout after ${MERGE_WAIT_TIMEOUT}min. Stopping loop." "warn"
        break 2  # break out of the outer while loop entirely
      else
        echo -e "${BLUE}Waiting for open RIFF PR to merge (${MERGE_WAIT_TIMEOUT}min timeout)...${NC}"
        sleep 30
      fi
    done
  else
    echo -e "${BLUE}Cooldown: ${COOLDOWN}s before next iteration...${NC}"
    sleep "$COOLDOWN"
  fi
fi
```

Note: `break 2` exits both the `while $POLLING` inner loop and the `while [ $ITERATION -lt $MAX_ITERATIONS ]` outer loop. This is a clean stop without writing LOOP_STOP because the agent's Step 0.1a already wrote it (the agent exited via LOOP_STOP, which the main loop's STOP_REASON detection will catch in the next iteration if `break 2` doesn't fire first). If the outer cooldown timeout fires independently (edge case: agent exited cleanly but PR still open), the `break 2` is the safety net.

### E. Security — two new files

#### E1. `templates/settings.afk.auto-merge.json`

Copy of `templates/settings.afk.json` with three diffs:

1. Add `"Bash(gh pr merge --auto --squash --delete-branch)"` to the `allow` array, after `"Bash(gh pr list *)"` (current line 40).

2. Remove `"Bash(gh pr merge *)"` from the `deny` array (current line 246). This entry no longer applies because the allowlist now has the exact permitted form; leaving both would create a conflict (deny takes precedence over allow for wildcard rules, but the exact-match allow form is more specific — to avoid ambiguity, remove the deny entry and let the guard hook enforce the boundary).

3. Change the PreToolUse hook command from `dangerous-command-guard.sh` to `dangerous-command-guard.auto-merge.sh`.

No other changes. All PostToolUse hooks remain the same.

#### E2. `hooks/dangerous-command-guard.auto-merge.sh`

Copy of `hooks/dangerous-command-guard.sh` with one insertion: a carve-out block inserted after line 26 (`fi` ending the empty-CMD check) and before line 28 (`PATTERNS=(`).

The carve-out:

```bash
# auto-merge carve-out: permit EXACTLY gh pr merge <url> --auto --squash --delete-branch.
# Three flag checks are order-independent (model may produce flags in any order).
# Fourth check rejects compound commands (&&, ||, ;, |) that could smuggle
# destructive payloads past this gate.
if printf '%s' "$CMD" | grep -Eq '^gh[[:space:]]+pr[[:space:]]+merge[[:space:]]'; then
  if printf '%s' "$CMD" | grep -q -- '--auto' \
     && printf '%s' "$CMD" | grep -q -- '--squash' \
     && printf '%s' "$CMD" | grep -q -- '--delete-branch' \
     && ! printf '%s' "$CMD" | grep -Eq -- '(&&|\|\||;|\|[^|])'; then
    exit 0
  fi
fi
```

Rationale for the four conditions:

1. `^gh pr merge ` — anchors to the permitted command family. Without this anchor, a command like `echo '--auto --squash --delete-branch' | gh pr merge` could pass the three-flag checks.
2. `--auto` present — required flag.
3. `--squash` present — required flag (prevents `--merge` or `--rebase` substitution).
4. `--delete-branch` present — required flag (ensures branch cleanup, also makes the permitted form more specific).
5. No compound separator — prevents `gh pr merge $PR --auto --squash --delete-branch && rm -rf .` from passing. The pattern `\|[^|]` catches single pipes while allowing `||` to be caught by the `\|\|` alternative. Together `&&|\|\||;|\|[^|]` covers all Bash compound separators.

If any of conditions 1-4 fail (or condition 5 fires), the carve-out does NOT exit 0, and the command falls through to the PATTERNS array. The existing pattern `'\bgh[[:space:]]+pr[[:space:]]+merge'` at line 78 of the original guard will then match and block it.

**`init.md` — no change needed.** Step 4 already globs `hooks/*.sh` when creating symlinks. The new `dangerous-command-guard.auto-merge.sh` will be symlinked into `.claude/hooks/riff/` automatically on the next `riff:init` run. Projects that ran `riff:init` before Phase 9 will need to re-run the init step or manually symlink the file.

---

## 4. File-by-file change list

| File | Action | What changes |
|------|---------|-------------|
| `templates/profile.neutre.yaml` | modify | Add `auto_merge` comment on merge_strategy, add commented `auto_merge_blocking_labels`, add `loop:` section with commented `merge_wait_timeout_min: 30` |
| `commands/next.md` | modify | Step 8b.3: capture `$PR_URL`. Step 8b.4: add `auto_merge` branch (blocking-label check, gate re-verify, `gh pr merge` call). Step 0: insert sub-step 0.1a merge-wait block |
| `riff-loop.sh` | modify | Add profile reads for `MERGE_STRATEGY`/`MERGE_WAIT_TIMEOUT`. Branch AFK settings selection. Strategy-conditional HEREDOC line. Replace fixed sleep with adaptive poll |
| `templates/settings.afk.auto-merge.json` | new | Copy of settings.afk.json; add `gh pr merge --auto --squash --delete-branch` to allow; remove `gh pr merge *` from deny; point PreToolUse hook to guard variant |
| `hooks/dangerous-command-guard.auto-merge.sh` | new | Copy of dangerous-command-guard.sh; add five-condition carve-out after line 26 |
| `references/PROFILE-RESOLUTION.md` | modify | Add one sentence under the `git.merge_strategy` discussion documenting the `auto_merge` value and its requirements |
| `HOW-IT-WORKS.md` | modify | Add sub-section under "Unattended Mode": three strategies, chaining contract, merge-wait behavior, security model |

---

## 5. Data flow

```
riff-loop.sh starts
  │
  ├─ reads MERGE_STRATEGY from resolve-profile.sh
  ├─ if auto_merge: AFK_SETTINGS = settings.afk.auto-merge.json
  │  else:          AFK_SETTINGS = settings.afk.json
  │
  ├─ [iteration N]
  │   ├─ writes iteration marker to STATE.md
  │   ├─ spawns: claude -p <prompt> --settings <AFK_SETTINGS>
  │   │   │
  │   │   ├─ /riff:next Step 0
  │   │   │   ├─ (0.1a, auto_merge only) poll open RIFF PRs
  │   │   │   │   ├─ MERGED → continue
  │   │   │   │   ├─ CLOSED → LOOP_STOP, exit
  │   │   │   │   ├─ blocking label → LOOP_STOP, exit
  │   │   │   │   └─ timeout → LOOP_STOP, exit
  │   │   │   └─ (0.2) stale-todo detection → mark done phases, update ROADMAP/STATE
  │   │   │
  │   │   ├─ Steps 1-7: pick phase, plan, execute, review (unchanged)
  │   │   │
  │   │   └─ Step 8b
  │   │       ├─ push branch
  │   │       ├─ PR_URL=$(gh pr create ...)
  │   │       ├─ if auto_merge:
  │   │       │   ├─ check blocking labels → LOOP_STOP or continue
  │   │       │   ├─ re-verify gates (read REVIEW.md, PLAN.md) → LOOP_STOP or continue
  │   │       │   ├─ dangerous-command-guard.auto-merge.sh permits: gh pr merge $PR_URL --auto --squash --delete-branch
  │   │       │   └─ gh pr merge $PR_URL --auto --squash --delete-branch  (returns immediately)
  │   │       └─ print report + STOP
  │   │
  │   ├─ detects LOOP_STOP in STATE.md → break
  │   │
  │   └─ adaptive cooldown (auto_merge: poll gh pr list every 30s until all PRs merged or timeout)
  │
  └─ [iteration N+1 starts from clean main, prior PR already merged]
```

---

## 6. Risks and mitigations

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| R1 | `gh pr merge --auto` returns success but GitHub never merges (required checks never pass or are disabled on the repo). Loop polls forever. | Medium | `MERGE_WAIT_TIMEOUT` caps the outer wait. LOOP_STOP fires after timeout. |
| R2 | `yq` absent at loop start: `MERGE_STRATEGY` stays `github_button`. User configured `auto_merge` but loop silently falls back to non-merging behavior. | Low | Emit a clear warning: `yq not found — merge_strategy will default to github_button. Install yq to use auto_merge.` |
| R3 | Model emits `gh pr merge "$PR_URL" --auto --squash --delete-branch && something_bad` — the compound separator bypasses naive allows. | High | The carve-out condition 5 (no compound separator) catches this. The command falls through to PATTERNS which blocks `gh pr merge *`. |
| R4 | Model emits `gh pr merge 123 --auto --squash` (missing `--delete-branch`). Carve-out rejects it. The PATTERNS block fires. Agent gets blocked. | Low-acceptable | This is correct behavior: the sanctioned form requires all three flags. The agent should produce the exact form from the HEREDOC instruction. If it doesn't, LOOP_STOP is safer than a partial merge. |
| R5 | Two iterations both find the same open PR in their 0.1a poll (race condition: iteration N queued, user starts iteration N+1 manually). | Low | The `headRefName | startswith("riff/phase-")` filter returns PRs by branch prefix. Each iteration creates a unique branch (`riff/phase-N-slug`). Two iterations would see two different PRs. Not a race. |
| R6 | `settings.afk.auto-merge.json` is accidentally used for a non-`auto_merge` project (e.g. user manually copies it). | Low | The guard variant `dangerous-command-guard.auto-merge.sh` still blocks bare `gh pr merge` calls (carve-out requires all three flags). Net effect: slightly looser than the base guard but still blocked for most forms. Document that the auto-merge settings file should only be used by the loop when `MERGE_STRATEGY=auto_merge`. |
| R7 | `break 2` in adaptive cooldown targets the wrong loop nesting level if the cooldown block is later refactored. | Low | Add a comment: `# break 2: inner poll loop + outer iteration loop`. |

---

## 7. Out of scope

- **Auto-retry on CI failure.** Phase 9 stops on CI failure. Deciding to re-run the phase, push a fix, or abandon is a human judgment. Retry logic would require knowing why CI failed, which is a separate problem.
- **`gh pr merge --rebase` or `--merge` variants.** Only squash is sanctioned. Squash keeps a clean linear history appropriate for automated commits.
- **Parallel phase execution.** The loop is strictly sequential (one Claude agent at a time). Parallelization is a separate design (out of scope per the plan's dependency map).
- **Auto-merge for `local_no_ff`.** That strategy is HITL; adding polling for user confirmation is a UX redesign, not a minor addition.
- **Label creation.** The blocking-labels feature reads existing labels; it does not create the `do-not-merge` label on the repo. The user must create it manually. Document in `HOW-IT-WORKS.md`.
- **Docker sandbox integration.** Phase 2 identified Docker as Layer 3. Phase 9 does not modify or extend the Docker path.

---

## 8. Build sequence

- [ ] A. `templates/profile.neutre.yaml`: add `auto_merge` comment, `auto_merge_blocking_labels` comment, `loop:` section.
- [ ] B. `templates/settings.afk.auto-merge.json`: create as copy of `settings.afk.json`, apply three diffs (add allow entry, remove deny entry, update hook command).
- [ ] C. `hooks/dangerous-command-guard.auto-merge.sh`: create as copy of `dangerous-command-guard.sh`, insert carve-out after line 26. `chmod +x`.
- [ ] D. `commands/next.md` Step 8b: change line 575 to capture `PR_URL`. Add `auto_merge` branch after `local_no_ff`.
- [ ] E. `commands/next.md` Step 0: insert sub-step 0.1a.
- [ ] F. `riff-loop.sh`: add profile reads (after line 115). Branch settings selection (around line 202). Make HEREDOC line conditional (before HEREDOC at line 185). Replace cooldown block (lines 262-266) with adaptive version.
- [ ] G. `references/PROFILE-RESOLUTION.md`: one-sentence addition for `auto_merge`.
- [ ] H. `HOW-IT-WORKS.md`: new sub-section under Unattended Mode.
- [ ] I. Manual gates: (1) configure test project with `merge_strategy: auto_merge`, run `./riff-loop.sh -n 3`, confirm 3 phases ship in sequence. (2) Simulate CI failure on PR #1, confirm LOOP_STOP with correct message. (3) Run with `merge_strategy: github_button`, confirm no regression. (4) Add `do-not-merge` label after PR creation, confirm LOOP_STOP on blocking label.

Recommended implementation order: A → B → C (security files first, no dependencies) → D → E (next.md changes) → F (loop changes) → G → H (docs last, can reference final code). Run each manual gate before the final commit.

---

## 9. Surprises during design

**`dangerous-command-guard.sh` line 78 blocks ALL `gh pr merge` calls.** The Phase 2 deny list in `settings.afk.json` entry `"Bash(gh pr merge *)"` at line 246 is the allowlist-level block. But line 78 of `dangerous-command-guard.sh` — `'\bgh[[:space:]]+pr[[:space:]]+merge'` — is a separate regex block at the hook level. The allowlist entry permits the command past the permission engine; the hook fires independently and blocks it. This means: removing `gh pr merge *` from the deny list in a settings file is necessary but not sufficient. A new guard variant is also required. This drove the two-file design for Component E.

**Compound-separator attack surface on the carve-out.** The obvious carve-out (check for three flags present) is vulnerable to `gh pr merge $PR --auto --squash --delete-branch && rm -rf .`. The compound-separator condition (condition 5 in the carve-out) closes this. It was not called out in the plan but is required for correctness.

**`gh pr create` return value was never captured.** Line 575 of `commands/next.md` uses `gh pr create` with no capture. The PR URL returned by `gh pr create` was printed to stdout and then lost — the existing `github_button` and `local_no_ff` strategies printed "PR open at `<url>`" but interpolated the URL from the `--title` or a subsequent `gh pr view` call (or just left it as a placeholder). For `auto_merge`, the URL is load-bearing (needed for `gh pr merge "$PR_URL"`). The fix (capture into `$PR_URL`) also improves the report for other strategies since the URL is now accurate.

**`jq` filter for RIFF PRs.** The plan suggests `--label riff-phase` or `--head "riff/phase-*"`. The `--head` flag requires an exact branch name; it does not support glob patterns. The `--label riff-phase` approach requires every RIFF PR to have that label applied, which the current flow does not do. The correct filter is `--json headRefName --jq '[.[] | select(.headRefName | startswith("riff/phase-"))]'` which filters by branch prefix in jq. This is the approach used in sub-step 0.1a and the adaptive cooldown.

**`local_no_ff` Step 8c writes `> Merge commit:` to SUMMARY.md.** Sub-step 0.1a's post-merge path for `auto_merge` relies on stale-todo detection (Step 0.2 Tier 1 SHA ancestry) to mark the phase done. For this to work after a GitHub squash-merge, Step 0.2 Tier 2 (`gh pr view` lookup) must back-fill the merge SHA into SUMMARY.md. This already works in the existing Step 0 design. No additional change needed for `auto_merge` — the detection chain handles all three strategies identically.

---

## Relevant file paths

- `/Users/webstantly/DEV/frameworks/riff/specs/plans/audit-fixes.md` (§ Phase 9, lines 300-334)
- `/Users/webstantly/DEV/frameworks/riff/commands/next.md` (Step 0 line 32, Step 8b lines 567-578, Step 8c lines 584-620)
- `/Users/webstantly/DEV/frameworks/riff/riff-loop.sh` (profile reads after line 115, settings line 202, HEREDOC lines 185-196, cooldown lines 262-266)
- `/Users/webstantly/DEV/frameworks/riff/hooks/dangerous-command-guard.sh` (carve-out insertion point: after line 26, before line 28; existing gh pr merge pattern: line 78)
- `/Users/webstantly/DEV/frameworks/riff/templates/settings.afk.json` (allow target: line 40, deny target: line 246, hook command: line 323)
- `/Users/webstantly/DEV/frameworks/riff/templates/profile.neutre.yaml` (git section: lines 38-39)
- `/Users/webstantly/DEV/frameworks/riff/lib/resolve-profile.sh` (shell resolver, used in riff-loop.sh startup)
- `/Users/webstantly/DEV/frameworks/riff/references/PROFILE-RESOLUTION.md` (add one sentence for auto_merge)
- `/Users/webstantly/DEV/frameworks/riff/templates/settings.afk.auto-merge.json` (new file)
- `/Users/webstantly/DEV/frameworks/riff/hooks/dangerous-command-guard.auto-merge.sh` (new file)

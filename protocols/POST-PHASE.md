# POST-PHASE — pending review, auto-debug, and Codex usage

Procedures used by `/riff:next` outside the main step sequence:

- **Prompt capture convention** — used by every step that spawns a sub-agent (4, 4b, 5, 5b, 6, 7, auto-debug).
- **Pending expertise review** — runs after Step 10's report.
- **Auto-debug pattern** — invoked from Steps 5, 6, 7 on failure.
- **Codex usage tracking** — invoked from Steps 4b and 6 around each Codex call.
- **Executor crash residue** — Step 5 post-return check.
- **Usage CSV logging** — Step 10.

---

## Prompt capture convention

After launching each sub-agent, append the substantive prompt to `.planning/phases/N-slug/PROMPTS.md` under the section heading named in each step (e.g. `## Planner`, `## Executor`, `## Adversarial reviewer (Codex)`, `## Simplifier`, `## Security reviewer`, `## Debugger (if invoked)`). PROMPTS.md was seeded at Step 2c from `.riff/templates/PROMPTS.md`. It is finalized at Step 8b only when `metadata.pr_body: full`; leftover `{{prompt verbatim}}` placeholders then become `_(not invoked)_`, and `riff-pr-metadata.sh` hard-fails if any remain.

**Substantive** means: capture only what tells the reader what the agent was asked to DO. Drop the boilerplate that controls how its output gets formatted. The PR reader is a stakeholder, not the agent — they want signal, not the agent's mechanical instructions.

| Keep | Drop |
|------|------|
| Mission / role / agent identity | "Output requirements" / format rules / one-sentence-per-line / line-break rules |
| Phase context (number, slug, branch, working dir) | "Where to save" / file paths to write artifacts to (`SUMMARY.md`, `REVIEW.md`, …) |
| Files to read | "What to return" / "Reporting back" sections aimed at the orchestrator |
| Hard rules, contracts, invariants | Output template scaffolding (markdown headers, table headers, frontmatter shape) |
| Verification criteria, severity grades, gate thresholds | Persistence/idempotency hints ("overwrite if exists", "fail-silent on error") |
| Locked decisions referenced by ID (D1, B-05, etc.) | Repeated stylistic rules already in `taste.md` / `profile.yaml` |

When in doubt: would removing this line change the reader's understanding of WHAT the agent did? If no, drop it.

---

## Pending expertise review

**Improver completion check (only if Step 7b ran this phase):** look for the sentinel `.planning/expertise/.pending/.improver-N-slug.done`. If absent, surface a one-line warning to the user: `Improver may not have completed for phase N-slug — sentinel missing.` The review loop below still operates on `*.md` files in `.pending/`. When the loop completes (accept, reject-all, or defer), `rm -f .planning/expertise/.pending/.improver-N-slug.done`.

Compute pending count: `ls .planning/expertise/.pending/*.md 2>/dev/null | wc -l`. If 0 → skip this section.

If > 0, run AskUserQuestion:

> "{{N}} expertise patches pending. What do you want to do?"
>
> - **Review now** — walk per-pattern (recommended for staying coherent)
> - **Defer to next phase** — leave them in `.pending/`, will ask again at end of next phase
> - **Reject all** — wipe `.pending/` (with one confirmation step)

**Review now** flow (per-pattern):

1. Glob `.planning/expertise/.pending/*.md`. For each file, read it and identify each PATTERN inside (a file may contain multiple).
2. For each pattern, classify into one of three tiers:

   | Tier             | Scope                                                                                                  | Destination                                                                       |
   | ---------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
   | **Stack**        | Gotcha / convention for a tech (Drizzle, Zod, RR7, Vitest, etc.) that applies to any project using it | `~/DEV/frameworks/riff/references/taste/stacks/<stack>.md` (framework)            |
   | **Architecture** | Design principle, multi-tenant rule, security pattern applicable beyond one project                   | `~/DEV/frameworks/riff/references/taste/{architecture,security,backend,testing}.md` |
   | **Project**      | File paths, provider quirks, domain-specific patterns tied to this codebase                           | `.planning/expertise/<agent>.md` and/or project `taste.md`                        |

3. AskUserQuestion per pattern: **Accept (at tier X) / Reject / Edit / Re-tier**.
4. Apply the decision: append to destination (without `Justification` line for Project tier), remove pattern from pending file.
5. When all patterns in a pending file are handled, delete the pending file.
6. Auto-reject duplicates of existing rules and note them in the report.

Rules:
- Default to **Project** tier when unsure. Over-promotion to framework bloats references for all users.
- If a framework file exceeds 15 entries after append, warn to compress.
- When promoting to RIFF framework (Stack or Architecture tier), remind: "Existing projects won't auto-pick-up this rule, their `taste.md` was seeded at `/riff:start`. They'd need a manual sync."

**Defer** flow:
Print `Deferred. {{N}} patches stay in .planning/expertise/.pending/. Will ask again at the end of the next phase.` Do nothing else.

**Reject all** flow:
Confirm with one more AskUserQuestion ("Wipe all {{N}} patches? This is irreversible."). On confirm: `rm -f .planning/expertise/.pending/*.md`. Print `Rejected {{N}} patches.`

Report at end: `Reviewed: M accepted (stack/arch/project breakdown), K rejected, E edited, D deferred.`

## Improver invocation (Step 7b)

**Gate:** skip by default. Run conditions: [`AUTO-TRIGGERS.md#improver-heuristic`](./AUTO-TRIGGERS.md#improver-heuristic).

**If running:** Agent tool, `model: "haiku"`, `run_in_background: true`. Prompt: _"Read `agents/improver.md`. Read SUMMARY.md and `.planning/expertise/` files. Write learnings to `.planning/expertise/.pending/`. Do not auto-merge. Use Context7 or Ref MCP for recent libs. As final act, write completion sentinel `.planning/expertise/.pending/.improver-N-slug.done` (lets Step 10 distinguish 'completed with no findings' from 'killed mid-write')."_

---

## Auto-debug pattern

Shared by Steps 5, 6, 7. Skip if `auto_debug: false`.

**Model:** `profile.yaml` `models.reasoning` (default `opus`), or `sonnet` if `debug_model: sonnet`.

**Prompt:**

> Read `agents/debugger.md`. Branch: `riff/phase-N-slug`. Failure type: `{{failure_type}}`. Failure artifact: `{{artifact}}`. Phase path: `.planning/phases/N-slug/`. Diagnose, attempt fix, write `.planning/phases/N-slug/DEBUG.md`.

**Prompt capture:** After launching the debugger sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under the `## Debugger (if invoked)` section heading.

**After completion:**

- DEBUG.md `RESOLVED` → re-run originating step, UNLESS all of these hold:
  - debugger ran with the default reasoning model (not a `debug_model: sonnet` override)
  - debugger's verification block in DEBUG.md reports tests green + tsc clean
  - every finding in the originating artifact has a corresponding new test locking the fix

  In that case, accept RESOLVED as the verdict without a re-run. Surface in Step 10 report: `Re-run skipped: RESOLVED with pinning tests`.

- DEBUG.md `UNRESOLVED` → halt, surface DEBUG.md to user.

---

## Codex usage tracking

Every Codex call (Step 4b, Step 6) appends a row to `.planning/codex-usage.csv` at project root. This is a Plus-quota awareness counter, not a billing tool. Already covered by the project-level `.gitignore` rule on `.planning/`.

**File:** `.planning/codex-usage.csv` (create with header on first call if missing). The helper does row-only appends; the orchestrator owns the header. Before the first append in a session:

```bash
if [ ! -f .planning/codex-usage.csv ]; then
  echo "timestamp,phase,step,model,effort,outcome,duration_sec" > .planning/codex-usage.csv
fi
bash .riff/scripts/csv-append.sh .planning/codex-usage.csv "$row"
```

```csv
timestamp,phase,step,model,effort,outcome,duration_sec
```

**Why no message count:** the rescue skill does not return a token usage figure we can rely on. Duration is the proxy.

**Soft cap warning (pre-spawn):** before spawning Codex at Step 4b or Step 6, count rows in `codex-usage.csv` whose `timestamp` is within the last 5 hours. If the count is greater than 5, print:

> Codex: 5+ calls in last 5h. Consider switching `budget_quality: frugal` for the rest of the session, or take a break.

Do NOT block. Just warn and proceed.

**Outcome values:** `pass`, `fail`, `revise`, `proceed`, `error` (skill failure / setup missing).

**Step is one of:** `4b`, `6`.

---

## Executor crash residue (Step 5 post-return)

After the executor sub-agent returns, the orchestrator checks for crash residue:

1. **If `.planning/phases/N-slug/SUMMARY.md` is absent**, the executor crashed silently (internal error, context exhaustion, killed sub-agent). Write a crash marker to `.planning/phases/N-slug/CRASH.json`:

   ```json
   {
     "schema_version": 1,
     "phase": "N-slug",
     "crashed_at": "<ISO-8601 timestamp>",
     "crash_type": "executor_silent_exit",
     "last_step": 5,
     "summary_written": false,
     "verdict": "pending",
     "notes": ""
   }
   ```

   Then AskUserQuestion:
   > Executor returned but did not write SUMMARY.md. Likely an internal crash or context exhaustion.
   > A) Trigger auto-debug (failure_type: `executor_silent_exit`, artifact: `CRASH.json`)
   > B) Resume manually (keep the branch, re-run /riff:next when ready, Step 0 detects partial state)
   > C) Abort, mark phase as crashed (verdict: abandoned)

   On A: run auto-debug. On RESOLVED, re-run Step 5. On UNRESOLVED, halt with DEBUG.md surfaced.
   On B: update STATE.md Resume Command to `continue /riff:next at Step 5 for phase N-slug. Read STATE.md.` Halt.
   On C: set CRASH.json `verdict: abandoned`. Update STATE.md `## Active Phase` Step to `CRASHED`. Halt.

2. **If SUMMARY.md exists**, scan it for `FAILED` / `ERROR` / `unresolved` / incomplete tasks. Found → run auto-debug pattern with `failure_type: executor_fail`, `artifact: SUMMARY.md`.

3. **On successful Step 5 completion** (including after auto-debug RESOLVED), `rm -f .planning/phases/N-slug/CRASH.json` to clear any prior crash marker.

Cross-reference: Step 0 and Step 2b in [`RECONCILE.md`](./RECONCILE.md) read the CRASH.json and partial SUMMARY.md state written here to decide resume/restart on the next run.

---

## Usage CSV logging (Step 10)

Append to `.planning/usage-log.csv` via the standalone helper at `.riff/scripts/csv-append.sh` (flock-protected, falls back to bare `>>` if flock is not installed). Invoke as a child bash process so the shebang applies (caller shell may be zsh, which does not parse the fd-redirect syntax).

**Two-step append (orchestrator owns the header):** the helper does ONLY a row append; it never writes a header. Before the first append, the orchestrator must create the file with the header line if it does not already exist:

```bash
if [ ! -f .planning/usage-log.csv ]; then
  echo "phase,title,date,total_tokens,duration_min,tool_calls,planner_tokens,executor_tokens,adversarial_tokens,security_tokens,debugger_tokens" > .planning/usage-log.csv
fi
bash .riff/scripts/csv-append.sh .planning/usage-log.csv "$row"
```

Header (written once on file creation by the block above):

```csv
phase,title,date,total_tokens,duration_min,tool_calls,planner_tokens,executor_tokens,adversarial_tokens,security_tokens,debugger_tokens
```

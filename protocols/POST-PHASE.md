# POST-PHASE — pending review, auto-debug, and Codex usage

Procedures used by `/riff:next` outside the main step sequence:

- **Pending expertise review** — runs after Step 10's report.
- **Auto-debug pattern** — invoked from Steps 5, 6, 7 on failure.
- **Codex usage tracking** — invoked from Steps 4b and 6 around each Codex call.

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

---

## Auto-debug pattern

Shared by Steps 5, 6, 7. Skip if `auto_debug: false`.

**Model:** `opus` (or `sonnet` if `debug_model: sonnet`).

**Prompt:**

> Read `agents/debugger.md`. Branch: `riff/phase-N-slug`. Failure type: `{{failure_type}}`. Failure artifact: `{{artifact}}`. Phase path: `.planning/phases/N-slug/`. Diagnose, attempt fix, write `.planning/phases/N-slug/DEBUG.md`.

**Prompt capture:** After launching the debugger sub-agent, write the substantive prompt (per the prompt-capture convention in § Step 2c) into `.planning/phases/N-slug/PROMPTS.md` under the `## Debugger (if invoked)` section heading.

**After completion:**

- DEBUG.md `RESOLVED` → re-run originating step, UNLESS all of these hold:
  - debugger ran with `opus` (default)
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

# DEEP-AUDIT

How RIFF runs a Codex deep audit at milestone boundaries — a cross-phase coherence pass that catches what per-phase Step 6 cannot see (drift between phases, duplicated helpers, broken assumptions across waves, accumulated tech debt, module-level security). Read by Claude when the user mentions a deep audit, or when `/riff:next` completes a phase tagged `milestone:` and the user picks "run now". There is no `/riff:deep-audit` slash command, the flow is conversational.

---

## When to read this protocol

User says any of:

- "deep audit", "audit ce module", "milestone review", "review complète"
- Or `/riff:next` Step 10 detects the just-completed phase has a `milestone:` tag and the user picks "run now" on the AskUserQuestion prompt.

**Question phrasing:** every `AskUserQuestion` in this protocol (Step 1 milestone picker, Step 3 BLOCKER/HIGH triage, Step 3 DECAY append confirm) follows the resolved `explanation_level`. See `references/EXPLANATION-LEVEL.md` § Interactive questions.

---

## Prerequisites

- `.planning/` exists at project root
- `ROADMAP.yaml` has at least one phase with a `milestone:` tag
- The Codex `codex:codex-rescue` skill is configured. If missing, log a one-line warning, skip the flow, never block the pipeline.

---

## Steps

### Step 0: Refresh Assay baseline

Skip this step if `scope=scratch` in `.planning/config.json`. Assay (`npx tryassay assess`) provides a free, fast bug baseline before the paid Codex deep audit, so Codex can focus on what Assay cannot see (cross-pipeline coherence, architecture drift, multi-tenant boundaries, subtle logic bugs).

1. If `.assay-assessment/assessment-summary.json` exists and is older than 7 days → back it up to `.assay-assessment-<YYYY-MM-DD>-baseline/`, then run `npx tryassay assess`.
2. If `.assay-assessment/` does not exist → run `npx tryassay assess`.
3. If `.assay-assessment/assessment-summary.json` is younger than 7 days → reuse it, no rerun.
4. Read `.assay-assessment/bug-report.md` and `.assay-assessment/executive-summary.md` before continuing.

The Step 2 Codex spawn prompt will reference these findings so Codex skips them.

### Step 1: Identify scope

Pick the milestone name. Sources, in order:

1. If invoked from `/riff:next` auto-prompt, use the `milestone:` value of the just-completed phase.
2. If invoked conversationally and exactly one milestone exists in ROADMAP.yaml, use it.
3. Otherwise AskUserQuestion: list every distinct `milestone:` value in ROADMAP.yaml, let the user pick.

Resolve the file list:

- Read every phase in ROADMAP.yaml whose `milestone:` matches.
- For each phase, collect changed files. Preferred: `git diff --name-only main...riff/phase-N-slug` if the branch still exists. Fallback: `git log --all --name-only --oneline | awk` filtered by the phase's date range (the phase's SUMMARY.md header has the completion date).
- Deduplicate to a single file list. Strip files that no longer exist on main. This is the audit scope.

If the resolved scope has fewer than 5 files, surface to user: "Milestone scope is small (<5 files). Step 6 already covered each phase. Run anyway or skip?" Default: skip.

### Step 2: Spawn deep-auditor (Codex)

**Pre-spawn usage check:** count rows in `.planning/codex-usage.csv` whose `timestamp` is within the last 5 hours. If >5, print the soft-cap warning from `commands/next.md` § Codex usage tracking. Do NOT block.

Agent tool → skill `codex:codex-rescue`. Pass `--model gpt-5.5 --effort xhigh`.

Prompt: milestone name, deduplicated file list, list of phases in scope, instruction _"Run with `--model gpt-5.5 --effort xhigh`. Read `agents/deep-auditor.md`. Read PROJECT.md, the ROADMAP.yaml entries for the phases above, every SUMMARY.md in `.planning/phases/<each-phase>/`, the file list above, and `taste.md` sections relevant to the touched surface. Apply the protocol. Write `.planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md` with PROCEED or FINDINGS verdict."_

If Step 0 ran (i.e. `scope` is not `scratch` and an Assay assessment exists), append to the prompt: _"Assay {{assessment-date}} flagged these critical/high findings: {{paste titles + one-line summaries from .assay-assessment/bug-report.md}}. Skip those, focus on what Assay cannot see: cross-pipeline coherence, architecture drift, multi-tenant boundaries, subtle logic bugs, accumulated tech debt across phases."_

Create `.planning/audits/` if missing.

After the agent returns, append a row to `.planning/codex-usage.csv`:

```
timestamp,phase,step,model,effort,outcome,duration_sec
<utc>,-,deep-audit,gpt-5.5,xhigh,proceed|findings|error,<measured>
```

Use `phase=-` because the audit spans multiple phases. Use UTC ISO-8601 for the timestamp.

### Step 2.5: Synthesize and dedup findings

After the Codex audit returns, combine its output with the Assay baseline so the user reads a single unified action list, not two separate reports.

1. Read the Codex audit artifact at `.planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md`.
2. Read `.assay-assessment/bug-report.md` (refreshed in Step 0). If Step 0 was skipped (scope=scratch or Assay unavailable), proceed without dedup and note that in the synthesis.
3. For each Codex finding, check the Assay bug-report for a matching entry by file path + finding nature. Mark Codex findings that duplicate Assay as `dup`. Track count.
4. Categorize unique (non-dup) Codex findings by severity:
   - **BLOCKER** — must fix before next milestone / promotion / release. Adversarial verdict marked it ship-stopping.
   - **HIGH** — fix this sprint (next 1-2 phases).
   - **NOTE** — backlog, batch into normal work over the next quarter.
5. Write `.planning/audits/AUDIT-SYNTHESIS-{{milestone}}-{{YYYY-MM-DD}}.md` with this structure:

   ```markdown
   # Audit Synthesis — {{milestone}} — {{YYYY-MM-DD}}

   **Codex audit:** .planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md
   **Assay baseline:** .assay-assessment/bug-report.md
   **Previous synthesis:** {{path or "none — first synthesis"}}

   ## TLDR

   {{3-5 lines: state of the milestone, what to fix first, dedup signal, archive note}}

   ## Dedup stats

   - Codex findings: {{total}}
   - Already in Assay: {{dup count}}
   - Unique to Codex: {{unique count}}

   If dup count >50%, refine future Codex prompts to skip those Assay categories more aggressively.

   ## BLOCKER (must fix before next milestone / promote / release)

   For each:
   - **Title** | **File:** path:line | **Fix:** one-line | **Proposed RIFF action:** new P0 phase via `/riff:add-phase`.

   ## HIGH (fix this sprint)

   For each:
   - **Title** | **File:** path:line | **Fix:** one-line | **Proposed RIFF action:** new P1 phase, or batch into the next existing phase.

   ## NOTE (backlog)

   One-line per finding. Proposed action: append to DECAY.md "Deferred from deep audit" section.

   ## Archive

   - Codex: .planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md
   - Assay current: .assay-assessment/
   - Assay rotated baseline (if Step 0 backed up): .assay-assessment-{{prev-date}}-baseline/
   ```

6. This synthesis file is what Step 3 surfaces to the user — not the raw Codex AUDIT-*.md.

### Step 3: Surface verdict

Read the synthesis at `.planning/audits/AUDIT-SYNTHESIS-<milestone>-<YYYY-MM-DD>.md`.

- **No BLOCKER, no HIGH** → print the synthesis path + TLDR. Done. NOTE items already routed to DECAY.md proposal, ask once if the user wants to apply the DECAY append now or defer.
- **BLOCKER or HIGH present** → paste the synthesis BLOCKER + HIGH sections to the user, then offer triage via AskUserQuestion:
  - `Spawn /riff:add-phase for BLOCKER findings` — open new P0 phase(s) pre-filled from the synthesis BLOCKER list.
  - `Spawn /riff:add-phase for HIGH findings` — open new P1 phase(s) pre-filled from the synthesis HIGH list. (Can combine with the previous option.)
  - `Append NOTE findings to DECAY.md` — append synthesis NOTE list to DECAY.md "Deferred from deep audit" section (create section if missing).
  - `Acknowledge and move on` — no further action; synthesis stays on disk for later.

**Never auto-fix.** Synthesis informs, user decides. The deep-auditor did not write code; this protocol does not write code either. Material fixes go through `/riff:add-phase`, the standard RIFF loop.

### Step 4: Report

Print:

```
Deep audit on milestone {{name}}: {{verdict}}
Synthesis: .planning/audits/AUDIT-SYNTHESIS-{{milestone}}-{{YYYY-MM-DD}}.md
Codex raw: .planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md
Dedup: {{unique Codex findings}}/{{total}} (rest already in Assay)
Codex calls in last 5h: {{count from codex-usage.csv}}
```

---

## Anti-patterns

- Don't auto-fix Findings. The audit informs, the user decides.
- Don't run on every phase — milestones are 5-10 phases apart by design.
- Don't run on a single-phase scope. Step 6 already covered it.
- Don't bypass `codex:codex-rescue` — the rescue skill is the only sanctioned path to Codex from RIFF.
- Don't block the pipeline if Codex setup is missing. Log warning, skip, return to the user.
- Don't downgrade `--effort` to save quota. The whole point is the deepest possible analysis on a rare boundary; that's why frequency is low.

# DEEP-AUDIT

How RIFF runs a Codex deep audit at milestone boundaries — a cross-phase coherence pass that catches what per-phase Step 6 cannot see (drift between phases, duplicated helpers, broken assumptions across waves, accumulated tech debt, module-level security). Read by Claude when the user mentions a deep audit, or when `/riff:next` completes a phase tagged `milestone:` and the user picks "run now". There is no `/riff:deep-audit` slash command, the flow is conversational.

---

## When to read this protocol

User says any of:

- "deep audit", "audit ce module", "milestone review", "review complète"
- Or `/riff:next` Step 10 detects the just-completed phase has a `milestone:` tag and the user picks "run now" on the AskUserQuestion prompt.

---

## Prerequisites

- `.planning/` exists at project root
- `ROADMAP.yaml` has at least one phase with a `milestone:` tag
- The Codex `codex:codex-rescue` skill is configured. If missing, log a one-line warning, skip the flow, never block the pipeline.

---

## Steps

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

Create `.planning/audits/` if missing.

After the agent returns, append a row to `.planning/codex-usage.csv`:

```
timestamp,phase,step,model,effort,outcome,duration_sec
<utc>,-,deep-audit,gpt-5.5,xhigh,proceed|findings|error,<measured>
```

Use `phase=-` because the audit spans multiple phases. Use UTC ISO-8601 for the timestamp.

### Step 3: Surface verdict

Read the audit artifact at `.planning/audits/AUDIT-<milestone>-<YYYY-MM-DD>.md`.

- **PROCEED** → print the path. Done. No findings worth acting on.
- **FINDINGS** → paste the Findings section to the user, then offer triage via AskUserQuestion:
  - `Spawn /riff:add-phase for material findings` — open a new phase to fix what matters; pre-fill the phase description with the BLOCKER/WARNING titles.
  - `Note in DECAY.md and defer` — append a one-line entry under DECAY.md's "Deferred from deep audit" section (create the section if missing); address next quarter.
  - `Acknowledge and move on` — print the path, no action.

**Never auto-fix.** FINDINGS surface to the user. The deep-auditor did not write code; this protocol does not write code either. Material fixes go through `/riff:add-phase`, the standard RIFF loop.

### Step 4: Report

Print:

```
Deep audit on milestone {{name}}: {{verdict}}
Artifact: .planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md
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

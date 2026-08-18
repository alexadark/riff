# DEEP-AUDIT

RIFF runs a cross-phase coherence audit at milestone boundaries. The audit checks drift between phases, duplicated helpers, broken assumptions across waves, accumulated technical debt, and module-level security. This is a conversational flow with no slash command.

## When to read this protocol

Read this protocol when the user says "deep audit", "audit this module", "milestone review", or "full milestone review". Also read it when the phase workflow detects a completed phase tagged `milestone:` and the user chooses to run the audit.

Do not load this protocol for a bare "review", a codebase audit, a health check, or an incident review.

Every interactive question follows the resolved `explanation_level`. See `references/EXPLANATION-LEVEL.md` under Interactive questions.

## Prerequisites

- `.planning/` exists at the project root.
- `ROADMAP.yaml` has at least one phase with a `milestone:` tag.
- The active runtime adapter can dispatch the shared reviewer.

If the adapter or shared reviewer is unavailable or fails, stop the audit. Preserve any audit draft already produced, report the blocker, and do not synthesize, report completion, or leave the pipeline unblocked.

## Steps

### Step 0: Refresh the Assay baseline

Skip this step when `.planning/config.json` has `scope=scratch`.

1. If `.assay-assessment/assessment-summary.json` is older than 7 days, back it up to `.assay-assessment-<YYYY-MM-DD>-baseline/`, then run `npx tryassay assess`.
2. If `.assay-assessment/` does not exist, run `npx tryassay assess`.
3. If the summary is younger than 7 days, reuse it.
4. Read `.assay-assessment/bug-report.md` and `.assay-assessment/executive-summary.md` before continuing.

The reviewer prompt includes the current findings so the review can focus on cross-pipeline coherence, architecture drift, multi-tenant boundaries, subtle logic bugs, and accumulated technical debt.

### Step 1: Identify scope

Choose the milestone name in this order:

1. Use the `milestone:` value of the just-completed phase when invoked from the phase workflow.
2. Use the only milestone in `ROADMAP.yaml` when exactly one exists.
3. Ask the user to choose one distinct milestone value from `ROADMAP.yaml`.

Read every phase whose `milestone:` matches. Collect changed files from the phase branch when available, preferably with `git diff --name-only main...riff/phase-N-slug`. Otherwise use the phase date range and `git log --all --name-only` filtered to that range. Deduplicate the list and remove paths that no longer exist on the main branch.

If the scope has fewer than 5 files, tell the user that per-phase review already covered the small scope and ask whether to run or skip. Default to skip.

### Step 2: Dispatch the shared reviewer

Use the active runtime adapter to dispatch the shared reviewer with all of the following constraints:

- Start a fresh, independent context.
- Use read-only access.
- Set review `mode` to `milestone`.
- Pass `role_spec_path: agents/roles/reviewer.md` in the dispatch context.
- Pass the milestone name, phase list, deduplicated file list, project context, every relevant phase summary, and relevant taste sections.
- Return the audit report content to the orchestrator with a `PROCEED` or `FINDINGS` verdict.
- Do not write files or mutate `.planning` from the fresh read-only reviewer context.

The runtime adapter owns execution settings. Do not add runtime settings or accounting fields to the audit artifact.

If Step 0 produced an Assay assessment, include its critical and high findings as deduplication context. Ask the reviewer to skip matching findings and focus on issues Assay cannot see.

If dispatch fails, the reviewer is unavailable, or the response lacks the required report and verdict, stop. Preserve any audit draft already produced, record the blocker, and do not report completion, synthesize, or unblock the pipeline.

### Step 2.5: Synthesize and deduplicate findings

After the reviewer returns, the orchestrator creates `.planning/audits/` when missing and writes the returned report content to `.planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md`. Then combine the raw audit with the Assay baseline so the user receives one action list.

1. Read `.planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md`.
2. Read `.assay-assessment/bug-report.md` when available. If Assay was skipped or unavailable, record that in the synthesis.
3. Match each reviewer finding against Assay by file path and finding nature. Mark matches as `dup` and count them.
4. Categorize unique findings by severity:
   - **BLOCKER:** fix before the next milestone, promotion, or release.
   - **HIGH:** fix in the next sprint or one of the next two phases.
   - **NOTE:** defer to normal backlog work.
5. Write `.planning/audits/AUDIT-SYNTHESIS-{{milestone}}-{{YYYY-MM-DD}}.md` with this structure:

   ```markdown
   # Audit Synthesis: {{milestone}}: {{YYYY-MM-DD}}

   **Audit:** .planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md
   **Assay baseline:** .assay-assessment/bug-report.md
   **Previous synthesis:** {{path or "none: first synthesis"}}

   ## TLDR

   {{3-5 lines: milestone state, first fixes, dedup signal, archive note}}

   ## Dedup stats

   - Reviewer findings: {{total}}
   - Already in Assay: {{dup count}}
   - Unique to reviewer: {{unique count}}

   If duplicate findings exceed 50%, tighten future reviewer prompts to skip matching Assay categories.

   ## BLOCKER (must fix before next milestone, promotion, or release)

   - **Title** | **File:** path:line | **Fix:** one line | **Proposed RIFF action:** new P0 phase via `/riff:add-phase`.

   ## HIGH (fix this sprint)

   - **Title** | **File:** path:line | **Fix:** one line | **Proposed RIFF action:** new P1 phase or the next existing phase.

   ## NOTE (backlog)

   One line per finding. Proposed action: append to the DECAY.md deferred deep-audit section.

   ## Archive

   - Audit: .planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md
   - Assay current: .assay-assessment/
   - Assay rotated baseline: .assay-assessment-{{prev-date}}-baseline/ when created
   ```

6. Surface the synthesis, not the raw audit, in Step 3.

### Step 3: Surface the verdict

Read `.planning/audits/AUDIT-SYNTHESIS-<milestone>-<YYYY-MM-DD>.md`.

- With no BLOCKER or HIGH, print the synthesis path and TLDR. Ask once whether to append NOTE items to DECAY.md or defer.
- With BLOCKER or HIGH, show those sections and ask whether to spawn `/riff:add-phase` for BLOCKER findings, spawn it for HIGH findings, append NOTE findings to DECAY.md, or acknowledge and move on.

Never auto-fix findings. The synthesis informs the user, and material fixes go through the standard RIFF phase loop.

### Step 4: Report

Print:

```text
Deep audit on milestone {{name}}: {{verdict}}
Synthesis: .planning/audits/AUDIT-SYNTHESIS-{{milestone}}-{{YYYY-MM-DD}}.md
Raw audit: .planning/audits/AUDIT-{{milestone}}-{{YYYY-MM-DD}}.md
Dedup: {{unique reviewer findings}}/{{total}} (rest already in Assay)
```

## Anti-patterns

- Do not auto-fix findings.
- Do not run on every phase.
- Do not run on a single-phase scope by default.
- Do not continue when the active runtime adapter is unavailable.
- Do not put runtime dispatch settings or accounting fields in business artifacts.

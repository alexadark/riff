---
description: Bundle N parallel-eligible phases and delegate execution to Codex (or run solo)
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, Agent
model: opus
---

# /riff:wave [W{N} | --resume W{N}]

Group wave-eligible phases into a Codex Apex AXV run. Opus plans, Codex executes, browser-check proves it works.

**Prerequisite:** `executors.available` includes `codex` in profile. Otherwise the command errors and points to `/riff:onboard`.

## Modes

| Invocation | Behavior |
|---|---|
| `/riff:wave` | Auto-pick next wave from ROADMAP.yaml, propose, await confirmation |
| `/riff:wave W3` | Build wave `W3` explicitly (must reference an existing wave id or phase set) |
| `/riff:wave --solo P12` | Single-phase Codex delegation (no parallel, but same prompt machinery) |
| `/riff:wave --resume W3` | Read `.planning/waves/W3.RESULT.md`, reconcile, update ROADMAP |
| `/riff:wave --status` | List active/pending/completed waves |

## Step 1: Eligibility scan

Read ROADMAP.yaml. A phase is **wave-eligible** when ALL of:

- `status: todo`
- `mode: AFK` (HITL phases never enter a wave)
- `provider_mode != production` (sandbox or unset OK)
- No unmet `depends_on` (all upstream phases `status: completed`)
- No `wave_eligible: false` override

Group eligible phases by absence of `depends_on` between them. Phases with a mutual `depends_on` chain cannot share a wave.

Skip phases marked `planner_model: opus` AND `complex_execution: true` — those need Opus-strict execution, not Codex autonomy. Surface them separately as "solo-eligible only".

## Step 2: Propose the wave

`AskUserQuestion` with the proposed grouping:

> "Wave W{N} candidates: phases [{P5}, {P7}, {P8}]. Estimated Codex effort: high. Browser-check: enabled on phases touching frontend. Confirm?"
>
> - **Confirm and build bundle**
> - **Adjust composition** (drop a phase, change effort, force solo)
> - **Cancel**

## Step 3: Build the bundle

Read [`protocols/WAVE-BUNDLE.md`](../protocols/WAVE-BUNDLE.md). Write `.planning/waves/W{N}.bundle.md` containing:

- Goal (one paragraph, what the wave delivers as a user-facing outcome)
- Per-phase PLAN.md, acceptance criteria, files touched, risks
- Browser-check contract per UI phase
- Final contract (atomic commits per phase, RESULT.md output, stop-conditions)

If any phase lacks a PLAN.md, run `agents/planner.md` inline for that phase first. Do not skip.

## Step 4: Decide in-process vs out-of-process

Read [`protocols/CODEX-DELEGATION.md`](../protocols/CODEX-DELEGATION.md) § Routing. Heuristic:

- ≤1 phase AND estimated under 30 min → in-process (`codex:codex-rescue` skill, blocks Claude)
- ≥2 phases OR estimated over 30 min → out-of-process (Claude prints the command, user runs it in a separate Codex terminal)

User can force with `--in-process` or `--out-of-process` flag.

## Step 5a: In-process route

Spawn Agent → skill `codex:codex-rescue` with the bundle. Wait for return. Read RESULT.md. Jump to Step 6.

## Step 5b: Out-of-process route

Print the exact command to paste in Codex. Format:

```
─────────────────────────────────────────────────────────────
WAVE W{N} READY — paste this in a new Codex terminal:

cd {{project_root}}
/apex -a -x -v -bundle .planning/waves/W{N}.bundle.md

Effort: high (override per phase via codex_effort in ROADMAP)
Expected duration: ~{{eta}}
Output: .planning/waves/W{N}.RESULT.md
─────────────────────────────────────────────────────────────
```

Update STATE.md: `wave_pending: W{N}`. Stop. User runs Codex, comes back with `/riff:wave --resume W{N}`.

## Step 6: Reconcile (--resume path)

Read `.planning/waves/W{N}.RESULT.md`. For each phase in the wave:

1. Verify the commit exists (`git log --grep="<phase_slug>"`)
2. Read the per-phase block: pass/fail per acceptance criterion, browser-check verdict, any deviation note
3. Spawn `scope-checker` agent against the wave's planned files vs actual diff
4. If a phase reports browser-check FAIL or scope drift → mark `status: needs_human_review`, surface to user
5. If all phases PASS → mark `status: completed`, update ROADMAP.yaml, run [`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) once per phase (compressed)

Write `.planning/waves/W{N}.SUMMARY.md` (one consolidated post-mortem, not N separate ones).

## Step 7: Output

```
Wave W{N} complete. {{N}} phases shipped. {{M}} commits.
Browser-check: {{passed}}/{{total}} green.
Scope-check: {{clean | drifted}}.
Next: /riff:next or /riff:wave for the next eligible group.
```

## Failure modes

| Symptom | Action |
|---|---|
| Codex aborts mid-wave | RESULT.md has partial results. Reconcile what completed, mark rest as `status: todo` with `notes: wave-W{N}-partial` |
| Browser-check fails on a phase | Phase marked `status: needs_human_review`. User decides: re-queue in next wave, or hand-fix |
| Scope drift detected | Same as failure: `needs_human_review`. Do not auto-rollback |
| `codex:codex-rescue` skill missing | Error, point to `commands/onboard.md` § Codex setup |

## Anti-patterns

- Don't bundle a phase whose `depends_on` is not yet `completed`
- Don't mix HITL phases into a wave (they require human verification, period)
- Don't override `provider_mode: production` to fit a phase into a wave
- Don't write the bundle yourself, always go through `protocols/WAVE-BUNDLE.md`

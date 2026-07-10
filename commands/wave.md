---
description: Bundle N parallel-eligible phases and delegate execution to Codex or parallel Sonnet workers (or run solo)
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, AskUserQuestion, Agent
model: opus  # static mirror of profile.yaml models.reasoning (frontmatter can't read config); keep in sync
---

# /riff:wave [W{N} | --resume W{N}]

Group wave-eligible phases into a wave run. The session frontier model plans, the configured executor builds, opt-in smoke/browser checks prove it works.

**Executor resolution:** `--executor codex|sonnet` flag → `profile.yaml § wave.executor` → default `codex`. `codex` delegates to the Codex CLI (Steps 4-5b). `sonnet` runs parallel Claude sub-agent workers (Step 5c) — no Codex required.

**Codex sub-mode (mode C is the default):** when the executor is `codex`, the default flow is **codex-exec-in-session** (`profile.yaml § wave.codex_exec.run_mode: codex-exec-in-session`). The RIFF session launches `codex exec` headless in the background and auto-reconciles (Step 6) when it exits, so the user never pastes a prompt and is interrupted only on a FAIL verdict or an HITL phase. The legacy paste flow (open a separate Codex terminal, paste the prompt) is the **fallback** — used when `wave.codex_exec.run_mode` is unset/`paste` or the user passes `--paste`. Both render the same `W{N}.prompt.md`; mode C just runs it for the user instead of handing it over.

**Prerequisite (codex executor only):** `executors.available` includes `codex` in profile. Otherwise the command errors and points to `/riff:onboard` — or suggests `--executor sonnet`.

## Modes

| Invocation | Behavior |
|---|---|
| `/riff:wave` | Auto-pick next wave from ROADMAP.yaml, propose, await confirmation |
| `/riff:wave W3` | Build wave `W3` explicitly (must reference an existing wave id or phase set) |
| `/riff:wave --solo P12` | Single-phase Codex delegation (no parallel, but same prompt machinery) |
| `/riff:wave --resume W3` | Read `.planning/waves/W3.RESULT.md`, reconcile, update ROADMAP |
| `/riff:wave --status` | List active/pending/done waves |
| `/riff:wave --scratch` | Run the wave with security gates downgraded to warnings. See § Scratch mode below |
| `/riff:wave --executor sonnet\|codex` | Override the wave executor for this wave. Combinable with the other modes |
| `/riff:wave --autonomous` | Autonomous session: all decisions front-loaded at launch, zero questions during build, batched end verification, park + finisher instead of stopping. Lifecycle: [`protocols/AUTONOMY.md`](../protocols/AUTONOMY.md). Combinable with `--executor` |
| `/riff:wave --autonomous --loop [--max-runs N]` | Chain autonomous runs Ralph-style until roadmap dry / 2 zero-merge runs / max-runs / `.planning/autonomy/STOP`. See `protocols/AUTONOMY.md` § Loop mode |

## Step 1: Eligibility scan

Hard gate before grouping phases:

```bash
bash .riff/lib/validate-roadmap.sh ROADMAP.yaml || { echo "ROADMAP invalid, STOP"; exit 1; }
```

Read ROADMAP.yaml. A phase is **wave-eligible** when ALL of:

- `status: todo`
- `mode: AFK` (HITL phases never enter a wave)
- `provider_mode != production` (sandbox or unset OK)
- No unmet `depends_on`: every upstream phase is `status: done` OR included earlier in this same wave as part of a sequential chain
- No `wave_eligible: false` override

Group eligible phases into two shapes:

- **Parallel group**: phases with no `depends_on` between them. These can execute concurrently (flag `-m` in the prompt).
- **Sequential chain**: phases where A→B→C forms a `depends_on` chain AND all are AFK-eligible. These execute in order within a single Codex session (no `-m` flag). This avoids running N solo delegations for what is logically one body of work (e.g., a content track where each phase builds on the previous).

A wave can contain one parallel group, one sequential chain, or a mix (e.g., two parallel phases followed by a sequential finisher). The bundle's Execution rules section specifies the execution order explicitly.

Phases with a mutual `depends_on` chain **can** share a wave as a sequential chain, provided every upstream phase in the chain is either `status: done` or included earlier in the same wave.

Skip phases marked `planner_model: opus` AND `complex_execution: true` — those need Opus-strict execution, not Codex autonomy. Surface them separately as "solo-eligible only".

A wave with ZERO parallelism (a pure sequential chain) is a valid wave. Do not refuse or downgrade it to solo runs.

**Autonomous runs** ([`protocols/AUTONOMY.md`](../protocols/AUTONOMY.md)): `mode: HITL` phases ARE wave-eligible — their human-verification semantics convert per `AUTONOMY.md` § Conversion table, and phases crossing the autonomy boundary build as `hold` (branch parked for sign-off, never merged).

## Step 2: Propose the wave

Autonomous runs: skip this question — the front-load approval (`AUTONOMY.md` § Front-load) already locked the composition.

`AskUserQuestion` with the proposed grouping:

> "Wave W{N} candidates: phases [{P5}, {P7}, {P8}]. Estimated Codex effort: high. Browser-check: enabled on phases touching frontend. Confirm?"
>
> - **Confirm and build bundle**
> - **Adjust composition** (drop a phase, change effort, force solo)
> - **Cancel**

## Step 3: Build the bundle

Read [`protocols/WAVE-BUNDLE.md`](../protocols/WAVE-BUNDLE.md). Write `.planning/waves/W{N}.bundle.md` containing:

- Bundle header: set `scratch_mode: true` when `--scratch` was passed, `false` otherwise
- Goal (one paragraph, what the wave delivers as a user-facing outcome)
- Per-phase PLAN.md, acceptance criteria, files touched, risks
- Smoke/browser-check contract per opted-in phase
- Final contract (atomic commits per phase, RESULT.md output, stop-conditions)

If any phase lacks a PLAN.md, run `agents/planner.md` inline for that phase first. Do not skip.

## Step 4: Decide in-process vs out-of-process

If the executor resolves to `sonnet`, skip this step and go to Step 5c.

For the `codex` executor, pick the route:

- **codex-exec-in-session (Step 5b, DEFAULT)** — when `wave.codex_exec.run_mode: codex-exec-in-session` (the shipped default). The session runs `codex exec` headless in the background and auto-reconciles. Works for any phase count. This is mode C.
- **in-process (Step 5a)** — `≤1` phase AND under ~30 min, when you want the `codex:codex-rescue` skill to block the session inline. Force with `--in-process`.
- **paste / out-of-process (Step 5b-fallback)** — when `run_mode` is unset/`paste` or the user passes `--paste`: render the prompt and hand it to the user to run in a separate Codex terminal.

Read [`protocols/CODEX-DELEGATION.md`](../protocols/CODEX-DELEGATION.md) § Routing decision for the in-process vs out-of-process details. User can force with `--in-process`, `--out-of-process`, or `--paste`.

## Step 5a: In-process route

Record `wave_W{N}_base_sha: $(git rev-parse HEAD)` in STATE.md so Step 6
can resolve the diff range without guessing. Spawn Agent → skill
`codex:codex-rescue` with the bundle. Wait for return. Read RESULT.md.
Jump to Step 6.

## Step 5b: codex-exec in-session route (mode C, DEFAULT)

The session runs the wave headless and reconciles it, so the user does nothing
between launch and result.

1. **Render the prompt.** Save the rendered Codex prompt to
   `.planning/waves/W{N}.prompt.md` (launch metadata + full `/goal` block),
   the audit trail for what the executor received (see `protocols/WAVE-BUNDLE.md` § Prompt preservation).
   For `codex exec`, **strip the leading `/goal` line** —
   slash prefixes are interactive-only; the body works as plain instructions.

2. **Capture the base SHA** in STATE.md BEFORE launching, so Step 6 can resolve
   the diff range:
   - `wave_pending: W{N}`
   - `wave_W{N}_base_sha: $(git rev-parse HEAD)`

3. **Launch headless in the background.** Run via Bash with the OS sandbox
   disabled (the run needs network + write), backgrounded so the session is
   freed and re-invoked on exit (no polling):

   ```
   {{env_prefix}}codex exec \
     --dangerously-bypass-approvals-and-sandbox \
     -C {{project_root}} \
     -c model_reasoning_effort="{{effort}}" \
     -o .planning/waves/W{N}.RESULT-codex.md \
     - < .planning/waves/W{N}.prompt.md
   ```

   `{{effort}}` defaults to `wave.codex_exec.reasoning_effort` (model + effort
   otherwise come from `~/.codex/config.toml`); bump to
   `reasoning_effort_security_critical` for `security_critical`/`adversarial`
   phases. `{{env_prefix}}` is empty when `scratch_mode: false`, and
   `RIFF_SCRATCH_MODE=1 RIFF_WAVE_ID=W{N} ` (single line, trailing space) when
   `scratch_mode: true`.

4. **On exit, auto-reconcile.** When the background run returns, proceed to
   Step 6 automatically (read `W{N}.RESULT.md`, reconcile, summarize, merge).
   Interrupt the user only on a FAIL verdict or an HITL gate.

5. **Fallback.** If `codex exec` fails to start (auth/env/binary missing), fall
   back to the paste flow below and tell the user.
   **Autonomous runs** (`protocols/AUTONOMY.md` § Conversion table): NEVER the
   paste flow — fall back to in-process Sonnet execution (Step 5c) with the same
   bundle. If Sonnet workers are also unavailable (usage guard ≥95%, Agent tool
   failure), park the whole wave: one finisher type `review` covering the wave
   (`AUTONOMY.md` § Parking), log the startup failure in DECISIONS.md, continue
   to Batched verification with whatever previously completed.

### RESULT.md Schema

W{N}.RESULT.md must contain:

- **Header**: wave number, goal, date, executor model
- **Per-phase block**: phase id, slug, status (pass|fail|partial), commit hash, acceptance criteria (each with pass/fail), smoke/browser-check (pass/fail/skipped/N/A), deviations (if any), files touched, duration
- **Wave notes**: cross-cutting learnings, patterns for taste.md, follow-up phases needed

### Step 5b-fallback: paste / out-of-process route (`--paste` or `run_mode: paste`)

Print the exact two-step sequence to paste in Codex. Format:

```
─────────────────────────────────────────────────────────────
WAVE W{N} READY — open a new Codex terminal and run:

  cd {{project_root}}
  {{env_prefix}}codex --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort="{{effort}}"

Then paste this /goal-prefixed prompt (rendered from CODEX-DELEGATION
Template A):

{{full rendered prompt}}

Effort: {{effort}} (override per phase via codex_effort in ROADMAP)
Expected duration: ~{{eta}}
Output: .planning/waves/W{N}.RESULT.md
─────────────────────────────────────────────────────────────
```

`{{env_prefix}}` follows the same scratch-mode rule as above. See
`protocols/CODEX-DELEGATION.md` § Out-of-process.

Stop. User runs Codex, comes back with `/riff:wave --resume W{N}`.

## Step 5c: Sonnet workers route (`--executor sonnet`)

Claude-native alternative when Codex is unavailable or the user prefers Claude executors. Same bundle, same RESULT.md contract, same reconcile.

1. **Usage guard first** — see § Usage guard. Do not launch workers above the threshold.
2. Record `wave_W{N}_base_sha: $(git rev-parse HEAD)` in STATE.md (same as Step 5a).
3. Spawn one sub-agent per phase with `model: sonnet`, in dependency order:
   - **Parallel group** → all Agent calls in a single message, they run concurrently.
   - **Sequential chain** → one at a time; each worker receives the previous phase's per-phase RESULT block.
4. Each worker prompt is a self-contained handoff packet: the bundle's per-phase block (goal, full plan, acceptance criteria, files, browser-check, digested rules, stack rules) + the bundle's Execution rules including stop conditions. Workers never navigate the wider RIFF docs.
5. Workers return their per-phase RESULT block as final output. The orchestrator assembles `.planning/waves/W{N}.RESULT.md` (executor model: sonnet), saves the worker prompts to `W{N}.prompt.md`, and jumps to Step 6.

The orchestrator (session frontier model) never writes phase code on this route — it plans, dispatches, vets, reconciles. That keeps expensive tokens on judgment and cheap tokens on volume.

## Usage guard (Claude-side routes only)

Out-of-process Codex runs spend Codex quota, not Claude — no guard needed there (asymmetric-budget policy, `protocols/MODEL.md`). Guard the Claude-side routes: Step 5a in-process, Step 5c Sonnet workers, and any session chaining multiple waves.

Before launching, and again between waves:

1. Run `npx -y ccusage@latest blocks --active --json`.
2. If the active 5-hour block or the weekly window is at or above **95%**, do NOT launch. Tell the user which window is hot and the observed usage.
3. If a wakeup/resume tool is available, schedule a self-contained resume at `min(3600, secondsUntilWindowClears)`; chain wakeups for longer waits. The wake prompt must carry: the remaining wave plan, the 95% rule, the exact usage command, and the previous block start timestamp.
4. On resume, re-check usage before continuing. A new block start timestamp is stronger evidence than "enough time passed".
5. Never interrupt in-flight workers to save budget — finish the running wave, gate the next one.

## Step 6: Reconcile (--resume path)

Read `.planning/waves/W{N}.RESULT.md`. For each phase in the wave:

1. Verify the commit exists (`git log --grep="<phase_slug>"`)
2. Read the per-phase block: pass/fail per acceptance criterion, browser-check verdict, any deviation note
3. Vet, don't trust: RESULT.md claims are leads, not facts. Spot-check `git show <hash> --stat` against the planned file list, and reopen the riskiest cited file before marking the phase done

### Step 6.1: Security and scope reconcile

Read [`protocols/WAVE-RECONCILE.md`](../protocols/WAVE-RECONCILE.md). The
protocol drives the verification matrix based on
`profile.yaml § wave.reconcile_mode` (default `both`):

- `hooks` — re-run the four PostToolUse security hooks against the wave
  diff via `.riff/hooks/lib/reconcile-diff.sh`, plus mechanical scope-check per
  phase
- `sonnet` — spawn `security-reviewer` per phase, plus mechanical scope-check
  per phase
- `both` — hooks + sonnet + mechanical scope-check, verdicts merged
- `off` — mechanical scope-check only

Output: `.planning/waves/W{N}.RECONCILE.md` from
[`templates/RECONCILE.md`](../templates/RECONCILE.md). Verdict is one of
`PASS`, `PASS-WITH-WARNINGS`, `FAIL`.

### Step 6.2: React to verdict

- `FAIL` → mark wave `status: needs_human_review`, surface verdict + top
  3 blocking findings inline, stop.
  Autonomous runs: do not stop — park the failing phases (finisher per
  phase) and continue to `protocols/AUTONOMY.md` § Batched verification
- `PASS-WITH-WARNINGS` → mark phases `done`, surface warnings in
  Step 7 output, continue
- `PASS` → mark phases `done`, no friction. Autonomous runs: `safe`
  phases then merge per `AUTONOMY.md` § Merge policy; `hold` phases park

If a phase reports smoke/browser-check FAIL or the reconcile is FAIL → mark
`status: needs_human_review`, surface to user. Otherwise mark
`status: done`, update ROADMAP.yaml, run
[`protocols/POST-PHASE.md`](../protocols/POST-PHASE.md) once per phase
(compressed).

Write `.planning/waves/W{N}.SUMMARY.md` (one consolidated post-mortem, not N separate ones).

## Step 7: Output

```
Wave W{N} complete. {{N}} phases shipped. {{M}} commits.
Smoke/browser-check: {{passed}}/{{total}} green.
Scope-check: {{clean | drifted}}.
Next: /riff:next or /riff:wave for the next eligible group.
```

## Failure modes

| Symptom | Action |
|---|---|
| Codex aborts mid-wave | RESULT.md has partial results. Reconcile what completed, mark rest as `status: todo` with `notes: wave-W{N}-partial` |
| Sonnet worker dies mid-phase | Same as Codex abort: assemble partial RESULT.md from returned blocks, re-queue the dead phase |
| Usage guard fires mid-session (≥95%) | Finish in-flight workers, do NOT launch the next wave. Schedule a wakeup or tell the user when the window clears |
| Smoke/browser-check fails on a phase | Phase marked `status: needs_human_review`. User decides: re-queue in next wave, or hand-fix |
| Scope drift detected | Same as failure: `needs_human_review`. Do not auto-rollback |
| Reconcile verdict `FAIL` | Wave marked `status: needs_human_review`. Surface top 3 findings, no auto-rollback. User fixes, re-runs `/riff:wave --resume W{N}` |
| `wave_W{N}_base_sha` missing in STATE.md | Fallback to parent of first wave commit via `git log --grep="<first_phase_slug>"`. Warn in reconcile Notes section |
| `codex:codex-rescue` skill missing | Error, point to `protocols/CODEX-DELEGATION.md` § Execution skill resolution |

## Scratch mode

`/riff:wave --scratch` runs the wave with the four PostToolUse security hooks
(idor, route-auth, input-validation, boundary) and the security-scan
pre-commit hook **downgraded to warnings**. The wave still ships, the
findings are logged, but no hook blocks the commit.

What changes in scratch mode:

1. Bundle header sets `scratch_mode: true`.
2. Codex receives an extra instruction block (CODEX-DELEGATION Template A,
   scratch conditional): for every file flagged by a security hook, insert
   a `// TODO(security): <hook>: <message>` comment at the top of the file.
3. The hooks themselves auto-append every finding to
   `.planning/followups/SECURITY-W{N}-RECONCILE.md` via the shared helper
   `hooks/lib/scratch-mode.sh`. The file is created from
   `templates/SECURITY-RECONCILE.md` on first finding.
4. `/riff:wave` propagates `RIFF_SCRATCH_MODE=1` and `RIFF_WAVE_ID=W{N}` to
   Codex through the launch command, so the hooks see them. See
   `protocols/CODEX-DELEGATION.md` § Out-of-process invocation.
5. The promotion flow (`protocols/PROMOTE.md`) refuses to flip scope to
   production while any non-empty `SECURITY-W*-RECONCILE.md` exists.

When to use:

- Demo prep where you need a feature shipped before the call, knowing the
  reconcile pass will happen after
- Internal sandbox features that will never face real users
- Spike phases that explore a flow you'll rewrite cleanly afterwards

When NOT to use:

- Anything touching production data, auth, payments, PII
- A wave whose phases include `provider_mode: production`
- A project already at `scope: production` — RIFF still allows the flag for
  spike phases but the promote gate is dormant there; prefer fixing the
  finding inline
- A pattern. Every scratch wave adds debt to the reconcile queue. Two
  scratch waves in a row without an intervening reconcile is a smell.

The reconcile gate is the backstop. There is no way to promote with a
non-empty reconcile file. Resolve, delete the file (or empty its Findings
section), then promote.

## Anti-patterns

- Don't bundle a phase whose `depends_on` is neither `done` nor included earlier in the same wave's sequential chain
- Don't mix HITL phases into a wave (they require human verification, period)
- Don't override `provider_mode: production` to fit a phase into a wave
- Don't write the bundle yourself, always go through `protocols/WAVE-BUNDLE.md`
- Don't use `--scratch` as a habit. The promote gate will catch it eventually,
  but the goal is to ship clean by default

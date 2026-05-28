# Wave reconcile

How `/riff:wave --resume W{N}` Step 6 verifies that a wave delivered what it
planned and stayed clean against security gates. Output is
`.planning/waves/W{N}.RECONCILE.md` per `templates/RECONCILE.md`.

This protocol is the engine behind `commands/wave.md` Step 6. The wave
command sets the inputs (W{N}, the bundle, the commit range), this protocol
runs the verification, and `protocols/PROMOTE.md` consumes the verdict.

## Modes

Driven by `profile.yaml` field `wave.reconcile_mode`. Resolution order:
project override `.planning/profile.yaml` → framework default → `both`.

| Mode | What runs | Cost | When |
|---|---|---|---|
| `hooks` | Hooks re-run on diff (no LLM) + mechanical scope-check per phase | Cheap, no token spend | Trusted waves, every phase already passed live hooks |
| `sonnet` | security-reviewer (Sonnet) per phase + mechanical scope-check per phase | ~1 Sonnet pass per phase | Hooks not trusted, or extra adversarial read wanted |
| `both` | hooks + sonnet + mechanical scope-check, verdicts merged | Maximum coverage | Default. Catches what either alone would miss |
| `off` | mechanical scope-check only | Cheapest | Spike / personal projects on `scope: scratch` |

Override per wave: not exposed yet. Profile setting is wave-level for now.

## Inputs

1. Wave id `W{N}` (from `/riff:wave --resume`)
2. Wave bundle `.planning/waves/W{N}.bundle.md` (already exists from Step 3)
3. Wave result `.planning/waves/W{N}.RESULT.md` (written by Codex at end of
   execution)
4. Git diff range, computed as:
   - `base`: the commit on the integration branch right before the wave
     started, captured in `STATE.md` as `wave_W{N}_base_sha` when Step 5
     transitions to in-flight
   - `head`: the current `HEAD` after `--resume` reads the RESULT.md

If `wave_W{N}_base_sha` is missing from STATE.md (legacy wave or manual
recovery), fall back to the parent of the first wave commit identified by
`git log --grep="<first_phase_slug>"`.

## Substeps

Run substeps in the order below. Each is a precondition for the next.

### 1. Scope-check, per phase

For each phase in the wave (read from the bundle), run
`node .riff/scripts/scope-check.mjs --phase .planning/phases/{id}-{slug}`.
The script writes
`.planning/phases/{id}-{slug}/SCOPE-CHECK.json` with a `verdict` of `MATCH`,
`DROPPED`, or `MALFORMED`.

Collect the verdicts. Any `DROPPED` or `MALFORMED` makes the wave
RECONCILE verdict `FAIL`. `MATCH` is the only passing value.

### 2. Hooks re-run (mode `hooks` or `both`)

Run `bash .riff/hooks/lib/reconcile-diff.sh <base> <head> <project_root>`.
Capture stdout. Each line is either:

- `FINDING|<hook>|<file>|<message>`
- `SUMMARY|files_scanned=<n>|findings=<n>`

Parse the FINDING lines. Map hooks to severity:

| Hook | Default severity |
|---|---|
| `idor-detector` | HIGH (data exposure) |
| `route-auth-guard` | HIGH (auth gap) |
| `input-validation-guard` | MEDIUM (validation gap) |
| `boundary-check` | LOW (scope drift signal) |
| `security-scan` (re-run mode not used here; security-scan is pre-commit) | — |

If any HIGH finding exists, the wave RECONCILE verdict is at least
`PASS-WITH-WARNINGS`. CRITICAL findings (none expected from the four
PostToolUse hooks at this severity) would push to `FAIL`.

### 3. Sonnet security-reviewer, per phase (mode `sonnet` or `both`)

For each phase in the wave, spawn the `security-reviewer` agent on the
phase's diff. It writes `.planning/phases/{id}-{slug}/SECURITY.md` with a
frontmatter `verdict` of `PASS`, `PASS-WITH-WARNINGS`, or `BLOCKED`.

`BLOCKED` (any CRITICAL or HIGH finding) → wave RECONCILE verdict is
`FAIL`. `PASS-WITH-WARNINGS` → at least `PASS-WITH-WARNINGS` at wave
level.

The `security-reviewer` agent already honors `scope: scratch` and exits
early there. So in `scope: scratch` projects, the Sonnet branch is a
no-op and the verdict relies on hooks + mechanical scope-check only.

### 4. Compose RECONCILE.md

Write `.planning/waves/W{N}.RECONCILE.md` from `templates/RECONCILE.md`.
Fill in:

- Frontmatter (wave, generated_at, verdict, reconcile_mode, diff_range)
- Scope-check table, one row per phase
- Hook re-run table + findings detail (if mode hooks or both)
- Sonnet review table, one row per phase (if mode sonnet or both)

Verdict resolution rules: see `templates/RECONCILE.md § Verdict resolution`.

### 5. React to verdict

- `PASS`: continue Step 6 in `commands/wave.md` (mark phases done,
  update ROADMAP)
- `PASS-WITH-WARNINGS`: mark phases done, surface warnings to user,
  flag in `commands/wave.md` Step 7 output
- `FAIL`: mark the wave `status: needs_human_review` in ROADMAP. Do NOT
  flip phases to `done`. Surface the verdict and the first three
  blocking findings inline to the user. The user decides: re-queue in
  next wave, hand-fix, or accept and override

### 6. Promote gate handshake

`/riff:promote` (or the conversational "promote to production" trigger)
reads every `.planning/waves/W*.RECONCILE.md`:

- Missing RECONCILE.md for a done wave → BLOCK promote, with
  instruction to run `/riff:wave --resume W{N}` first
- RECONCILE.md verdict `FAIL` → BLOCK promote
- RECONCILE.md verdict `PASS-WITH-WARNINGS` → ALLOW promote, surface
  warnings in the promote pre-flight summary
- RECONCILE.md verdict `PASS` → no friction

See `protocols/PROMOTE.md` § Step 1.6.

## Interaction with scratch mode

Scratch mode (`scratch_mode: true` in the bundle, see
`protocols/WAVE-BUNDLE.md`) does NOT skip reconcile. The reconcile still
runs and the findings still surface. The two gates compose:

- `SECURITY-W{N}-RECONCILE.md` (from scratch mode) blocks promote until
  every scratch finding is fixed
- `W{N}.RECONCILE.md` (from this protocol) records the wave-level verdict
  and is read by both `/riff:wave --resume` and `/riff:promote`

A scratch wave whose phases all pass live hooks AND adversarial Sonnet
read will have a clean `W{N}.RECONCILE.md` but a non-empty
`SECURITY-W{N}-RECONCILE.md` from the live findings during execution.
Both must clear before promote.

## Failure recovery

If reconcile crashes mid-run (e.g., scope-check cannot parse a PLAN.md,
or git diff fails), write a partial RECONCILE.md with verdict `FAIL` and
a `## Notes` block describing what crashed. The user can re-trigger after
fixing the underlying issue.

## Cross-references

- `commands/wave.md` Step 6 invokes this protocol
- `templates/RECONCILE.md` defines the output schema
- `protocols/PROMOTE.md` Step 1.6 reads the verdict
- `protocols/SCOPE-CHECK.md` + `scripts/scope-check.mjs` write per-phase SCOPE-CHECK.json
- `agents/security-reviewer.md` writes per-phase SECURITY.md
- `hooks/lib/reconcile-diff.sh` runs the hook re-run pass

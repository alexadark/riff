---
name: "riff:loop"
description: "Run multiple phases autonomously (Ralph loop) using Codex per-iteration. Explicitly invoke as $riff:loop."
---

# RIFF Loop

Use this skill when the user invokes `$riff:loop` or `$riff:loop <N>` in Codex.

## Input

Use the user's inline text after `$riff:loop` as the iteration count. Pass it as `--input`:

- No args or empty: run all remaining AFK-eligible phases (max 20)
- `<N>` (a number): run exactly N phases

## Preflight

1. Confirm `.riff/scripts/riff-codex.mjs` exists in the current project. If it is missing, stop and tell the user to run `riff init --harness codex` in that project.
2. Confirm `ROADMAP.yaml` exists in the project root. If not, stop and tell the user to run `$riff:start` first.
3. Check `STATE.md` for any `LOOP_STOP` marker. If one is present, stop and tell the user to resolve the underlying issue before re-running the loop.
4. Keep this invocation to one RIFF capability. Do not continue into the next RIFF command after this skill finishes.

## Run

Run exactly this adapter command with the iteration count as input:

```bash
node .riff/scripts/riff-codex.mjs loop --run --input "<N>"
```

If no count was given, omit `--input` entirely:

```bash
node .riff/scripts/riff-codex.mjs loop --run
```

## Stop Conditions

| Condition | Action |
| --------- | ------ |
| Verification FAIL | Stop, write `LOOP_STOP[<id>]: verification failed` to STATE.md |
| R3 deviation | Stop, write `LOOP_STOP[<id>]: R3 architecture change needed` to STATE.md |
| Security CRITICAL or HIGH | Stop, write `LOOP_STOP[<id>]: security issue` to STATE.md |
| All phases done | Stop, notify "BUILD COMPLETE" |
| Only production-provider HITL phases remain | Stop, human presence required |
| All remaining phases blocked | Stop, human intervention needed |
| Iteration limit reached | Stop (safety) |

## HITL vs Sandbox-HITL

A phase is AFK-eligible for the loop when EITHER:

- `mode: AFK`, OR
- `mode: HITL` AND `provider_mode: sandbox`

Sandbox-HITL phases run through the browser verification protocol (`references/BROWSER-VERIFICATION.md`) using a headless driver. Production-provider HITL phases (real OAuth, real payment, MFA, DNS cutover, irreversible migrations) stop the loop.

## Report

After the loop finishes, report: number of iterations run, phases completed, and the stop reason (done, LOOP_STOP, or iteration limit). If `STATE.md` has a `LOOP_STOP` marker, surface it prominently.

## Next Step

End with: "Review completed phases. If a LOOP_STOP is present, resolve the issue before re-running `$riff:loop`."

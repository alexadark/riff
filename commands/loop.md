---
description: Run multiple phases autonomously (Ralph loop)
allowed-tools: Bash, Read
args: "[N]"
---

# /riff:loop

Launch autonomous phase execution. Each phase runs in a fresh Claude Code context via `/riff:next`.

## Arguments

- No args: run all remaining AFK phases (max 20)
- `[N]`: run exactly N phases

## What You Do

1. Check: ROADMAP.yaml exists, `.planning/` exists, the loop script is reachable (try `.riff/riff-loop.sh` first per `commands/init.md`, fall back to `./riff-loop.sh` for framework-root dev runs).
2. Launch — pick the first that exists:

   ```bash
   if [ -x .riff/riff-loop.sh ]; then
     bash .riff/riff-loop.sh -n {{N}}
   elif [ -x ./riff-loop.sh ]; then
     bash ./riff-loop.sh -n {{N}}
   else
     echo "riff-loop.sh not found. Run /riff:init first."
     exit 1
   fi
   ```

The loop handles: reading ROADMAP, spawning fresh agents, atomic commits, Telegram notifications, stop conditions.

## Stop Conditions

| Condition                                            | Action                                    |
| ---------------------------------------------------- | ----------------------------------------- |
| Verification FAIL                                    | Stop, write LOOP_STOP to STATE.md, notify |
| R3 deviation                                         | Stop, architecture decision needs human   |
| Security CRITICAL/HIGH                               | Stop, needs human                         |
| All phases done                                      | Stop, notify "BUILD COMPLETE"             |
| Only production-provider HITL phases remain          | Stop, human presence required             |
| All remaining blocked                                | Stop, human intervention needed           |
| Iteration limit                                      | Stop (safety)                             |

## HITL vs sandbox-HITL

A phase counts as **AFK-eligible** for the loop when EITHER:

- `mode: AFK`, OR
- `mode: HITL` AND `provider_mode: sandbox` (see `agents/planner.md` § `provider_mode`)

For sandbox-HITL phases the loop does NOT pause. Instead, when the phase reaches a verification step that would normally require a human at a browser (OAuth callback, Stripe test checkout, magic-link click, etc.), it routes the verification through the user-level `browser-automation` skill:

- Preferred driver: **Lightpanda** (headless, fast) or **agent-browser** (headless, feature-rich). Never Claude in Chrome inside the loop — it requires a visible session.
- Credentials: sandbox / dev tenant only (Stripe test card, Auth0 dev tenant, Clerk test mode, Mailtrap, etc.). The phase plan is responsible for surfacing which sandbox creds it expects, sourced from `.env.local` or the user's secret manager — never from production.
- Evidence: capture screenshots + console transcript and append them (or links to them) under a `## Sandbox verification` block in `.planning/phases/N-slug/SUMMARY.md`.
- Fallback: if the `browser-automation` skill is unavailable or returns no driver it can drive headlessly (e.g. Computer Use only), log `LOOP_STOP[<id>]: sandbox verification unavailable — falling back to HITL` to STATE.md and stop the loop. Do NOT silently degrade to "skip verification."

Production-provider HITL phases (real OAuth, real payment, MFA, DNS cutover, irreversible migrations) keep the existing pause behavior — they never run inside the loop.

When counting AFK-eligible work for the "Only HITL phases remain" stop condition, sandbox-HITL phases count as AFK-eligible.

## Session handoff

Each iteration = fresh Claude Code context via `riff-loop.sh` → handoff between iterations automatic, no heuristic.

Inside iteration: per-`/riff:next` checkpoints in [`protocols/HANDOFF.md`](../protocols/HANDOFF.md) apply. Heuristic trips mid-iteration → spawned process surfaces suggestion, stops clean. User resumes manually in fresh window before re-launch.

## Anti-Patterns

- Don't run on production-provider HITL phases (loop skips them automatically; sandbox-HITL phases DO run, see § HITL vs sandbox-HITL)
- Don't run without ROADMAP.yaml
- Don't run if STATE.md has LOOP_STOP — fix the issue first
- Don't route sandbox verification through Claude in Chrome inside the loop — pick a headless driver (Lightpanda / agent-browser)
- Don't use production credentials in a sandbox-HITL phase — if the only path to verify is production, the phase should be `provider_mode: production` (default) and pause the loop

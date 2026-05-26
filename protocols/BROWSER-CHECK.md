# Browser-check

The "prove the feature actually works" contract Codex (or Claude) must honor during wave / solo execution. Adapted from Apex `-v verify`.

**Not the same as smoke test.** Smoke test = "the page loads, no 500". Browser-check = "the user can do the thing the feature promises".

**Not the same as sandbox-HITL.** Sandbox-HITL = a specific protocol for sandbox provider flows (test Stripe, Auth0 dev). Browser-check is broader: any UI feature, any flow.

## The contract

When a phase has `browser_check: true`, the executing agent (Codex or Claude) accepts this contract:

> You do not stop until the feature provably works in the browser. "Compiled" is not "works". "Tests pass" is not "works". "Looks right in the diff" is not "works".
>
> You launch the app. You navigate to the route. You perform the user actions listed in the phase's browser-check block. You observe the outcome. If the outcome does not match the acceptance criterion, you read the relevant logs (browser console, server logs, DB query output), find the cause, fix the code, retest. You loop until the criterion is green or you log a blocker.

This is the Melvyn pattern: "Frérot, tu dois toi-même me prouver que ça fonctionne. Du moment que c'est pas le cas, tu t'arrêtes pas."

## Auto-enable rule

`/riff:wave` Step 3 (bundle construction) sets `browser_check: true` on a phase when ANY:

- Phase touches `app/`, `src/`, `routes/`, `pages/`, or any path under a route directory
- Phase tags include `ui`, `frontend`, `ux`, `e2e`
- `taste/frontend.md` exists AND diff includes a `.tsx`, `.jsx`, `.svelte`, `.vue`, `.astro`, or framework-route file
- Phase has `provider_mode: sandbox` (sandbox provider flow always needs end-to-end proof)

Skip when:

- Phase is pure backend (no UI surface, no public route) — `browser_check: false` explicit, or auto-detect from diff (no client files)
- Phase is pure CLI / skill / content / automation project — `taste/frontend.md` absent
- User override: `browser_check: false` in ROADMAP.yaml

## Per-phase block (in wave bundle)

When enabled, the bundle's per-phase section includes a `**Browser-check:**` block that Codex reads. Format:

```markdown
**Browser-check:** enabled

User journey to verify:
1. Start the app: `pnpm dev` (or detected dev command)
2. Navigate to `/{{route}}` in browser
3. {{Action 1 — e.g. "Click 'New workflow' button"}}
4. {{Action 2 — e.g. "Fill form: title='Test V2', add condition step"}}
5. {{Action 3 — e.g. "Click Save"}}
6. {{Observable outcome — e.g. "Workflow appears in list with status: active"}}

Logs to read on failure:
- Server: terminal where `pnpm dev` runs
- Browser console: open devtools
- DB (if relevant): `{{convex dev / drizzle studio / supabase logs}}`

Stop conditions for this phase:
- All observable outcomes match → mark browser-check PASS in RESULT.md
- Bug found → fix, retest, repeat until pass
- After 3 fix-retest cycles still failing → log blocker, mark FAIL in RESULT.md, continue to next phase
```

The planner (or Opus during bundle construction) writes this block by reading PLAN.md acceptance criteria and translating each criterion into a user action.

## Driver options

Codex / Claude has two ways to actually drive the browser:

### Option 1: Built-in browser (Apex `-v` native path)

Codex CLI and Claude Code both have built-in browser tools (Claude in Chrome MCP, Codex browser subagent). Apex `-v` uses these by default. No setup, works out of the box.

**Trade-off:** the browser is visible (Chrome window opens), slower than headless, requires a graphical session.

### Option 2: Lightpanda headless (framework CLI)

The same Lightpanda binary used by `references/BROWSER-VERIFICATION.md`. Headless, sub-100ms cold start, AFK-compatible.

**Trade-off:** the agent must write a JS interaction script (the user journey above) and run `lightpanda run-script`. More setup, but no visible browser, works in CI.

### Routing

| Context | Default driver | Why |
|---|---|---|
| Interactive `/riff:wave` (user is at the machine) | Built-in (Option 1) | User wants to see what's happening, debug visually |
| Out-of-process Codex session (AFK, user not watching) | Built-in (Option 1) | Codex runs in its own terminal, can open a browser; user comes back later |
| In `/riff:loop` AFK mode | Lightpanda (Option 2) | No visible session, must be headless |
| Sandbox-HITL provider flow | Lightpanda (Option 2, via BROWSER-VERIFICATION.md) | Existing protocol, do not duplicate |

When Lightpanda is required but absent, fall back to the existing `references/BROWSER-VERIFICATION.md` § Skip behavior — never silently skip.

## Output to RESULT.md

Codex writes per-phase to `.planning/waves/W{N}.RESULT.md`:

```markdown
### Phase P{X} — {{slug}}
- Browser-check: PASS
  - Journey completed in {{N}} steps, all observable outcomes matched
  - Fix-retest cycles: 0
- OR
- Browser-check: FAIL
  - Journey failed at step {{N}}: {{description of the observable outcome that did not match}}
  - Fix-retest cycles: 3 (cap reached)
  - Last error: {{log excerpt}}
  - Suggested next action: {{Codex's recommendation}}
```

Reconcile step in `/riff:wave` Step 6 reads these blocks and decides next action.

## Why this matters specifically for Codex waves

Apex / Codex agents are extremely good at making code compile and pass unit tests. They are also extremely good at declaring "done" when the feature does not actually work end-to-end. Without browser-check, the wave returns "5 phases complete" and 2 of them silently ship broken UI.

Browser-check is the only gate cheap enough to run on every UI phase that catches "compiles but broken". Smoke test catches "404 / 500". Tests catch logic bugs in isolated units. Browser-check catches "the buttons don't wire to the right handler" / "the form submits but nothing happens" / "the new feature is invisible behind a hidden flag".

For Codex specifically: it has a tendency to optimize the code path that already exists rather than the one the user needs. Browser-check forces it to confront the actual user journey, find the gap, and close it.

## Cross-references

- `/riff:wave` Step 3 auto-enables this protocol per phase
- `protocols/WAVE-BUNDLE.md` defines where the per-phase block lives in the bundle
- `protocols/CODEX-DELEGATION.md` § Template A references this protocol from the Codex prompt
- `references/BROWSER-VERIFICATION.md` is the CLI driver layer for Lightpanda — reused here, not replaced
- `references/SMOKE-TEST.md` is the narrower "page loads" gate — not replaced

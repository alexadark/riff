# Browser-Backed Smoke Test

The runtime smoke-test contract Codex (or Claude) must honor during `/riff:next` Step 5e and wave / solo execution when a phase opts in with `smoke_test: true`.

**Not the same as sandbox-HITL.** Sandbox-HITL = a specific protocol for sandbox provider flows (test Stripe, Auth0 dev). The browser-backed smoke test is broader: any UI feature, any flow.

## The contract

When a phase has `smoke_test: true`, the executing agent (Codex or Claude) accepts this contract:

> You do not stop until the feature provably works in the browser. "Compiled" is not "works". "Tests pass" is not "works". "Looks right in the diff" is not "works".
>
> You launch the app. You navigate to the route. You perform the user actions listed in the phase's browser-check block. You observe the outcome. If the outcome does not match the acceptance criterion, you read the relevant logs (browser console, server logs, DB query output), find the cause, fix the code, retest. You loop until the criterion is green or you log a blocker.

This is the Melvyn pattern: "Frérot, tu dois toi-même me prouver que ça fonctionne. Du moment que c'est pas le cas, tu t'arrêtes pas."

## Auto-enable rule

`/riff:wave` Step 3 (bundle construction) may propose `smoke_test: true` on a phase when ANY:

- Phase touches `app/`, `src/`, `routes/`, `pages/`, or any path under a route directory
- Phase tags include `ui`, `frontend`, `ux`, `e2e`
- `taste/frontend.md` exists AND diff includes a `.tsx`, `.jsx`, `.svelte`, `.vue`, `.astro`, or framework-route file
- Phase has `provider_mode: sandbox` (sandbox provider flow always needs end-to-end proof)

Skip when:

- Phase is pure backend (no UI surface, no public route) — `smoke_test: false` explicit, or auto-detect from diff (no client files)
- Phase is pure CLI / skill / content / automation project — `taste/frontend.md` absent
- User override: `smoke_test: false` in ROADMAP.yaml

## Per-phase block (in wave bundle)

When enabled, the bundle's per-phase section includes a `**Runtime smoke:**` block that Codex reads. Format:

```markdown
**Runtime smoke:** enabled

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
- All observable outcomes match → mark runtime smoke PASS in RESULT.md
- Bug found → fix, retest, repeat until pass
- After 3 fix-retest cycles still failing → log blocker, mark FAIL in RESULT.md, continue to next phase
```

The planner (or Opus during bundle construction) writes this block by reading PLAN.md acceptance criteria and translating each criterion into a user action.

## Driver options

Codex / Claude has two ways to actually drive the browser:

### Option 1: Built-in browser (native path)

Codex CLI and Claude Code both have built-in browser tools (Claude in Chrome MCP, Codex browser subagent). The `-v` flag uses these by default. No setup, works out of the box.

**Trade-off:** the browser is visible (Chrome window opens), slower than headless, requires a graphical session.

### Option 2: Lightpanda headless (framework CLI)

The same Lightpanda binary used by `references/BROWSER-VERIFICATION.md`. Headless, sub-100ms cold start, AFK-compatible.

**Trade-off:** the agent must write a JS interaction script (the user journey above) and run `lightpanda run-script`. More setup, but no visible browser, works in CI.

### Routing

| Context | Default driver | Why |
|---|---|---|
| Interactive `/riff:wave` (user is at the machine) | Built-in (Option 1) | User wants to see what's happening, debug visually |
| Out-of-process Codex session (AFK, user not watching) | Built-in (Option 1) | Codex runs in its own terminal, can open a browser; user comes back later |
| Sandbox-HITL provider flow inside `/riff:next` | Lightpanda (Option 2, via BROWSER-VERIFICATION.md) | Existing protocol, do not duplicate |

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

Codex agents are extremely good at making code compile and pass unit tests. They are also extremely good at declaring "done" when the feature does not actually work end-to-end. Without browser-check, the wave returns "5 phases complete" and 2 of them silently ship broken UI.

Browser-check is the only gate cheap enough to run on every UI phase that catches "compiles but broken". Smoke test catches "404 / 500". Tests catch logic bugs in isolated units. Browser-check catches "the buttons don't wire to the right handler" / "the form submits but nothing happens" / "the new feature is invisible behind a hidden flag".

For Codex specifically: it has a tendency to optimize the code path that already exists rather than the one the user needs. Browser-check forces it to confront the actual user journey, find the gap, and close it.

## Cross-references

- `/riff:wave` Step 3 auto-enables this protocol per phase
- `protocols/WAVE-BUNDLE.md` defines where the per-phase block lives in the bundle
- The Codex prompt references this protocol from `protocols/CODEX-DELEGATION.md` § Template A
- `references/BROWSER-VERIFICATION.md` is the CLI driver layer for Lightpanda — reused here, not replaced
- Runtime Smoke Test is the narrower "page loads" gate — not replaced

## Runtime Smoke Test (Step 5e)

Runtime smoke test on the phase diff. Not an agent — a deterministic shell pipeline the orchestrator runs inline: boot the project's dev server, load every route touched by the phase diff in a headless browser, capture console errors and HTTP status codes. Fast, no LLM, opt-in.

Catches the "compiles green but blows up at boot" class of regressions that Step 5d (fallow) and Step 6 (adversarial) miss — type-clean code with a busted import path, a hydration error, a 500 in a route handler, a missing env var the bundler doesn't see.

---

### What it checks

For every route touched by the branch diff (`main...HEAD`), Step 5e loads the URL in a headless browser against the freshly booted dev server and records:

| Signal | What it means |
| ------ | ------------- |
| **HTTP status** | Non-200 (404, 500, 503) = the route handler is broken or the dev server returned an error page |
| **Console errors** | JS errors surfaced at runtime: undefined references, unhandled promise rejections, framework-thrown hydration mismatches |
| **Console warnings** | Soft signals: deprecated APIs, slow renders, framework hints. Not blocking, but surfaced in the report |

The orchestrator does NOT inspect the rendered DOM or run interaction scripts — that's clickOps territory and lives in the browser verification protocol (`references/BROWSER-VERIFICATION.md`); the smoke test uses only the navigate-and-capture subset, not the interactive subset.

---

### How it runs

Invoked inline by the orchestrator (no sub-agent). End-to-end pipeline:

1. **Detect dev command** from `package.json` `scripts` — prefer `dev`, fallback to `start`.
2. **Detect package manager runner** from lockfile (`pnpm-lock.yaml` → `pnpm`, `bun.lock` → `bun`, `yarn.lock` → `yarn`, otherwise `npm`).
3. **Start dev server in background** on a free port (`3000`, then `3001`–`3010` if busy). Wait up to 30s for it to respond on `/`.
4. **Extract touched routes** from `git diff --name-only main...HEAD`. Keep paths matching `routes/**`, `pages/**`, `app/**`. Derive a URL for each, stubbing dynamic segments (`[id]` → `sample-id`, `$slug` → `sample-slug`).
5. **Load each URL in Lightpanda** (or `chrome-devtools-mcp` as fallback). Capture HTTP status, console errors, console warnings. Cap per-URL wallclock at 10s.
6. **Stop the dev server** (`kill <PID>`, escalate to `kill -9` after 5s if needed).
7. **Write findings** to `.planning/phases/N-slug/SMOKE.json`.

Output: `.planning/phases/N-slug/SMOKE.json` (full structured output) + one-line entry in `GATES.md`.

---

### Verdicts and behavior

| Verdict | GATES.md entry | What happens |
| ------- | -------------- | ------------ |
| `pass` | `Step 5e: pass` | Continue to Step 5f. All routes returned 200, no console errors. |
| `warn` | `Step 5e: warn — N findings` | Continue. 200s only, but at least one console warning. Count surfaced in Step 10 report. |
| `fail` | `Step 5e: fail → …` | STOP. User chooses: fix-in-place / accepted-exception / one-time override. |

**Fix in place:** re-run the executor with SMOKE.json as additional input, then re-run Step 5e. Max 2 cycles, then escalate.

**Accepted exception:** write a one-line rationale to GATES.md (`Step 5e: accepted-exception — <reason>`) and continue.

**One-time override:** log `Step 5e: override` to GATES.md and continue.

**Runtime error** (dev server won't boot, port conflict on every candidate, browser binary crashes mid-run): surface stderr, AskUserQuestion `skip and continue | halt`. Default skip on no answer. The dev server PID is always killed before the step exits, even on the skip path.

---

### Skip conditions

Step 5e is skipped automatically in these cases:

| Condition | GATES.md entry |
| --------- | -------------- |
| `scope: scratch` in `.planning/config.json` | _(implicit skip, gate not reached)_ |
| No `package.json` at project root | `Step 5e: skipped — not TS/JS` |
| `smoke_test: true` not set on the phase entry in ROADMAP.yaml | `Step 5e: skipped — smoke_test not enabled` |
| Neither Lightpanda nor `chrome-devtools-mcp` binary on PATH | `Step 5e: skipped — lightpanda not installed` |
| No `dev` or `start` script in `package.json` | `Step 5e: skipped — no dev/start script` |
| Zero routes derivable from the diff | `Step 5e: skipped — no routes in diff` |
| Non-zero exit for reasons other than findings | User prompted to skip or halt |

The gate is **opt-in per phase**, not opt-out. Default behavior across the framework is unchanged: phases without `smoke_test: true` never trigger Step 5e.

---

### Installation

[Lightpanda](https://lightpanda.io) is the preferred backend — single Zig binary, headless-only, sub-100ms cold start, lower memory footprint than headless Chrome.

```bash
# macOS
brew install lightpanda

# Linux (download binary from GitHub releases)
curl -L https://github.com/lightpanda-io/browser/releases/latest/download/lightpanda-linux-x86_64 -o /usr/local/bin/lightpanda
chmod +x /usr/local/bin/lightpanda
```

Verify:

```bash
lightpanda --version
```

If Lightpanda is unavailable on the platform, the gate falls back to `chrome-devtools-mcp` if it's on PATH — same shell contract, slower cold start.

If neither binary is available at Step 5e runtime, the step skips silently. It does not break existing projects.

---

### Configuration

The gate is **opt-in** per phase via ROADMAP.yaml:

```yaml
- id: 12
  title: Refactor auth module
  smoke_test: true       # opt in to Step 5e for this phase
```

Defaults to `false` (skipped) when the key is absent. Pair this with phases that ship user-facing routes — auth flows, marketing pages, admin dashboards — where a runtime regression bypasses unit tests entirely.

For phases that touch only backend routes or pure utilities, leave `smoke_test` unset and let the standard verification pipeline (5d fallow + 6 adversarial + 7 security) carry the weight.

To force-skip even when opted in (e.g. debugging the gate itself), set `smoke_test: false` — the gate respects the explicit override.

---

### Relationship to other steps

- **Fallow audit (Step 5d):** fallow is static analysis on the diff — dead code, duplication, complexity. It reads the source; it doesn't run it. Step 5e complements fallow by running the code in a real browser session. Fallow catches `unused import`, smoke catches `import succeeds but the module throws at evaluation time`.
- **Adversarial reviewer (Step 6):** Codex reads the diff for logic bugs and missing edge cases by reasoning about the code. Step 5e runs the code. They cover different failure modes — Codex won't notice that route `/users/$id` 500s on dev because the env var is missing, the smoke gate will. Conversely, smoke won't notice a subtle off-by-one that doesn't blow up on the stub `sample-id`.
- **Security reviewer (Step 7):** OWASP scan on the diff — input validation, auth checks, IDOR. Step 5e doesn't replace it; a route can return 200 with clean console output and still be wide open to auth bypass. Security runs in parallel with adversarial review after the smoke gate.
- **Post-mortem (Step 5f):** the Haiku post-mortem reads the standard phase artifacts (SUMMARY.md, PLAN-REVIEW.md, REFACTOR.md, VERIFICATION.md). When the smoke gate ran and produced findings, they show up in GATES.md, which the metadata script surfaces in the PR body — no special routing needed in 5f.

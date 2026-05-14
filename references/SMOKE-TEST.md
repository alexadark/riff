# Smoke Test Browser (Step 5e)

Runtime smoke test on the phase diff. Not an agent — a deterministic shell pipeline the orchestrator runs inline: boot the project's dev server, load every route touched by the phase diff in a headless browser, capture console errors and HTTP status codes. Fast, no LLM, opt-in.

Catches the "compiles green but blows up at boot" class of regressions that Step 5d (fallow) and Step 6 (adversarial) miss — type-clean code with a busted import path, a hydration error, a 500 in a route handler, a missing env var the bundler doesn't see.

---

## What it checks

For every route touched by the branch diff (`main...HEAD`), Step 5e loads the URL in a headless browser against the freshly booted dev server and records:

| Signal | What it means |
| ------ | ------------- |
| **HTTP status** | Non-200 (404, 500, 503) = the route handler is broken or the dev server returned an error page |
| **Console errors** | JS errors surfaced at runtime: undefined references, unhandled promise rejections, framework-thrown hydration mismatches |
| **Console warnings** | Soft signals: deprecated APIs, slow renders, framework hints. Not blocking, but surfaced in the report |

The orchestrator does NOT inspect the rendered DOM or run interaction scripts — that's clickOps territory and lives in dedicated browser-automation skills, not in a hot-path gate.

---

## How it runs

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

## Verdicts and behavior

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

## Skip conditions

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

## Installation

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

## Configuration

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

## Relationship to other steps

- **Fallow audit (Step 5d):** fallow is static analysis on the diff — dead code, duplication, complexity. It reads the source; it doesn't run it. Step 5e complements fallow by running the code in a real browser session. Fallow catches `unused import`, smoke catches `import succeeds but the module throws at evaluation time`.
- **Adversarial reviewer (Step 6):** Codex reads the diff for logic bugs and missing edge cases by reasoning about the code. Step 5e runs the code. They cover different failure modes — Codex won't notice that route `/users/$id` 500s on dev because the env var is missing, the smoke gate will. Conversely, smoke won't notice a subtle off-by-one that doesn't blow up on the stub `sample-id`.
- **Security reviewer (Step 7):** OWASP scan on the diff — input validation, auth checks, IDOR. Step 5e doesn't replace it; a route can return 200 with clean console output and still be wide open to auth bypass. Security runs in parallel with adversarial review after the smoke gate.
- **Post-mortem (Step 5f):** the Haiku post-mortem reads the standard phase artifacts (SUMMARY.md, PLAN-REVIEW.md, REFACTOR.md, VERIFICATION.md). When the smoke gate ran and produced findings, they show up in GATES.md, which the metadata script surfaces in the PR body — no special routing needed in 5f.

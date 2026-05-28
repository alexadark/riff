# Browser Verification Protocol

Programmatic browser-driven verification used by three callers: the Step 5e smoke gate, sandbox-HITL routing in `/riff:next`, and the debugger agent's frontend reproduction step. Not an agent and not an external skill — a CLI contract the orchestrator and agents follow inline.

Framework-native by design: every RIFF user gets the same behavior out of the box from a Lightpanda CLI + chrome-devtools-mcp pair, with no dependency on any user's personal Claude Code skills.

---

## What it does

Three call sites share the same driver-detection logic and the same evidence-capture contract:

| Caller                                  | Purpose                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Step 5e smoke test** (`commands/next.md`) | Load every route touched by the diff, capture HTTP status + console errors. Hot-path gate, fast.     |
| **Sandbox-HITL routing** (`commands/next.md`) | Drive a sandbox provider flow (test Stripe checkout, dev-tenant OAuth callback, magic-link click, etc.) so `/riff:next` does not pause for a human. |
| **Debugger frontend reproduction** (`agents/debugger.md`) | Open the failing route, replay user interactions, capture console + network + screenshot to feed DEBUG.md. |

Each caller decides which subset of the protocol it needs (navigate-and-capture for smoke; full interactive script for sandbox-HITL and debugger). Driver detection, output paths, and skip behavior are shared.

---

## Driver detection

Order of preference, evaluated at call time:

1. **`lightpanda` binary on PATH** — fast Zig-based headless browser, sub-100ms cold start, no visible session required. Preferred for every caller. Install: see https://lightpanda.io.
2. **`chrome-devtools-mcp` registered in the Claude Code MCP config** — visible Chromium driven via the Chrome DevTools Protocol. Slower cold start, richer devtools surface, good for HITL interactive sessions where the user wants to watch.
3. **Neither available** → caller follows § Skip behavior below.

The smoke gate (Step 5e) accepts chrome-devtools-mcp as a fallback. Sandbox-HITL routing prefers Lightpanda for speed but accepts chrome-devtools-mcp when the user is at the machine.

---

## Standard operations

The CLI flag names below describe the contract — adapt to the current Lightpanda CLI surface if flag spelling has shifted.

### Navigate + capture (smoke test, debugger initial load)

```bash
# Pseudocode shape — <adapt to current Lightpanda CLI>
lightpanda fetch "$URL" \
  --screenshot ".planning/phases/$N-$SLUG/screenshots/${CONTEXT}-${TIMESTAMP}.png" \
  --capture-console ".planning/phases/$N-$SLUG/${CONTEXT}.console.log" \
  --json-status > ".planning/phases/$N-$SLUG/${CONTEXT}.json" \
  --timeout 10s
```

Captures: HTTP status, network requests with non-2xx responses, console errors and warnings, final-frame screenshot.

### Interact via a JS script (sandbox-HITL flows, debugger reproductions)

For flows that require user actions (filling a Stripe test card form, clicking an OAuth consent button, opening a magic link):

```bash
# Pseudocode shape — <adapt to current Lightpanda CLI>
lightpanda run-script ./scripts/sandbox-stripe.js \
  --base-url "$DEV_SERVER_URL" \
  --screenshot ".planning/phases/$N-$SLUG/screenshots/${CONTEXT}-${TIMESTAMP}.png" \
  --capture-console ".planning/phases/$N-$SLUG/${CONTEXT}.console.log" \
  --capture-network ".planning/phases/$N-$SLUG/${CONTEXT}.network.json" \
  --timeout 30s
```

The script file is short Playwright-style JS — fill inputs, click buttons, wait for selectors. The caller authors the script (it's phase-specific); the protocol just standardizes how it's executed and where outputs land.

When Lightpanda is unavailable and chrome-devtools-mcp is the active driver, the same shape is expressed via MCP tool calls (`navigate`, `evaluate`, `screenshot`, `read_console_messages`, `read_network_requests`). Same output paths.

---

## Output contract

Every caller writes artifacts to the active phase directory using a `<context>` discriminator:

| Artifact            | Path                                                                              |
| ------------------- | --------------------------------------------------------------------------------- |
| Screenshots         | `.planning/phases/N-slug/screenshots/<context>-<timestamp>.png`                   |
| Console transcript  | `.planning/phases/N-slug/<context>.console.log`                                   |
| Network transcript  | `.planning/phases/N-slug/<context>.network.json` (when captured)                  |
| Structured findings | `.planning/phases/N-slug/<context>.json`                                          |

`<context>` is one of:

- `smoke` — Step 5e smoke gate
- `sandbox` — sandbox-HITL provider verification
- `debug` — debugger agent frontend reproduction

Standalone debug invocations without a phase use `.planning/debug/screenshots/<slug>-<timestamp>.png` for screenshots and `.planning/debug/<slug>.console.log` for the console transcript.

`<timestamp>` is ISO-8601 (e.g. `2026-05-13T14-22-09Z`) so artifacts sort chronologically and never collide.

---

## Skip behavior per caller

When driver detection returns "neither available," each caller has its own degradation path. None of them silently skip the verification.

| Caller                                            | Skip behavior                                                                                                                            |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Step 5e smoke test**                            | Log `Step 5e: skipped — no browser driver` to GATES.md, continue the pipeline.                                                          |
| **Sandbox-HITL routing in `/riff:next`**          | `AskUserQuestion`: `verify manually now (open the URL yourself) | install lightpanda and retry | halt`. Default `verify manually now` on no answer. |
| **Debugger frontend reproduction**                | Append `Visual evidence: skipped — no browser driver` to DEBUG.md. The debugger proceeds without screenshots/console capture.            |

A driver that's installed but crashes mid-run is a runtime error, not a skip — surface stderr, AskUserQuestion `skip and continue | halt`, default skip on no answer. The dev server PID (when the caller booted one) is always killed before exit.

---

## Installation

**Lightpanda is NOT auto-installed at `/riff:start`.** The binary install path is still evolving across platforms; auto-install creates more breakage than it prevents. Document the manual install for users instead.

Visit https://lightpanda.io for the latest install instructions. Recommended approach: install once globally per machine (`/usr/local/bin/lightpanda` on macOS/Linux, or via `brew install lightpanda` if the formula is current), not per project.

Verify:

```bash
lightpanda --version
```

**chrome-devtools-mcp** is installed via the Claude Code MCP configuration — see the Claude Code docs for adding an MCP server. Once registered, the orchestrator detects it automatically; no per-project setup.

When neither driver is available, the protocol degrades per § Skip behavior. The framework does not break on missing drivers.

---

## Why this protocol, not a skill

Personal Claude Code skills live in a single user's `~/.claude/skills/` and never propagate to other RIFF users. A RIFF feature gated on one user's private browser-driving skill silently no-ops for everyone else.

CLI specs shipped inside the framework (`references/BROWSER-VERIFICATION.md`, `references/FALLOW.md`, `protocols/BROWSER-CHECK.md` § Runtime Smoke Test) work for every clone of the repo, every fresh `/riff:init`, every CI runner. The agents follow the spec inline, the orchestrator runs the CLI, and the driver detection block is the only piece that's environment-dependent.

Same design principle as the Fallow gate: ship the contract, let the user install the binary, degrade cleanly when it's missing.

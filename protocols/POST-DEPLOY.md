# POST-DEPLOY

How RIFF sets up production monitoring after a successful promotion. Read by the agent at the end of `protocols/PROMOTE.md` (Step 10). Single pass, in-process via the `codex:codex-rescue` skill.

---

## When to read this protocol

Automatically, after PROMOTE.md Step 9 completes. Not a conversational trigger — always machine-invoked.

**Skip entirely** if `scope` is still `scratch` (should never happen, but guard).

---

## Inputs

- **Production URL** — from PROMOTE.md context or `.planning/config.json`. If unknown, ask the user once.
- **Stack** — detect from `package.json` (JS/TS), `requirements.txt` / `pyproject.toml` (Python), `go.mod` (Go). Falls back to manual ask if ambiguous.
- **ROADMAP.yaml** — read for per-category opt-outs (`error_tracking`, `uptime_monitor`, `scheduled_smoke`).
- **Route config** — detect from framework router (React Router, Next.js, SvelteKit, FastAPI, Gin, etc.) for smoke test route selection.

---

## Opt-outs

In `ROADMAP.yaml` top-level or in the promoting phase config:

```yaml
error_tracking: none      # skip Category 1
uptime_monitor: none      # skip Category 2
scheduled_smoke: none     # skip Category 3
```

Default for all three: ON. Absence = enabled.

---

## Execution

Single `codex:codex-rescue` call, in-process. Codex reads this protocol and executes the three categories sequentially. On failure of any category after 2 attempts, log as WARNING (not blocker) and continue to the next category.

---

## Category 1: Error tracking (Sentry)

1. **Detect stack.** Read `package.json` / `requirements.txt` / `go.mod`.
2. **Install SDK.**
   - JS/TS: `npm install @sentry/node` (or `@sentry/nextjs`, `@sentry/remix`, `@sentry/react` — match the framework).
   - Python: `pip install sentry-sdk`.
   - Go: `go get github.com/getsentry/sentry-go`.
3. **Configure.** Add initialization code at the app entry point. DSN from `process.env.SENTRY_DSN` / `os.environ["SENTRY_DSN"]` / `os.Getenv("SENTRY_DSN")`. Never hardcode the DSN.
4. **Source maps** (JS/TS only). Add `@sentry/cli` or framework plugin for source map upload. Wire into the build script.
5. **Verify.** Trigger a test error (e.g. `Sentry.captureException(new Error("RIFF post-deploy test"))`). Confirm the event appears in the Sentry dashboard (Codex browser check). Remove the test error after confirmation.
6. **Record.** Write result to `POST-DEPLOY-RESULT.md` (see § Output).

**On opt-out** (`error_tracking: none`): skip, record SKIP.

---

## Category 2: Uptime monitoring

1. **Check for health endpoint.** Look for `/health`, `/api/health`, `/healthz`, or `/ping` in the route config.
2. **Create if missing.** Add a minimal health endpoint that returns `200 OK` with `{ "status": "ok" }`. Place it in the idiomatic location for the stack (e.g. `app/routes/health.ts`, `api/health.py`, `handlers/health.go`).
3. **Document the monitoring setup.** Write a `MONITORING.md` at project root with:
   - The health endpoint path.
   - Recommended external ping service (UptimeRobot free tier as default suggestion, but keep provider-neutral — any cron ping works).
   - Suggested check interval (5 min).
   - Alert channel recommendation (match `notifications.channel` from `profile.yaml`).
4. **Verify.** Hit the health endpoint locally (`curl http://localhost:<port>/health`), confirm 200 response.
5. **Record.** Write result to `POST-DEPLOY-RESULT.md`.

**On opt-out** (`uptime_monitor: none`): skip, record SKIP.

---

## Category 3: Smoke test (scheduled)

1. **Detect critical routes.** Read the project's route config and ROADMAP.yaml (completed phases). Pick the 3 most critical routes:
   - Priority: auth-protected pages > payment pages > main dashboard/index > public landing.
   - If fewer than 3 routes exist, use what's available.
2. **Generate Playwright script.** Write `e2e/smoke.spec.ts` (or `e2e/smoke.spec.js` for non-TS projects):
   - Install Playwright if not present (`npm init playwright@latest` or add to existing config).
   - Each route: navigate, assert no 5xx, assert key element visible (detect from route component).
   - Keep it minimal — smoke, not regression.
3. **Wire scheduling.** Pick one:
   - **GitHub Actions** (preferred if `.github/` exists): create `.github/workflows/smoke.yml` with `schedule: cron: '0 6 * * *'` (daily 6 AM UTC). Job: checkout, install, run smoke script against the prod URL.
   - **Local cron** (fallback): document the cron entry in `MONITORING.md`.
4. **Verify.** Run the smoke script once locally against the dev server. Confirm green.
5. **Record.** Write result to `POST-DEPLOY-RESULT.md`.

**On opt-out** (`scheduled_smoke: none`): skip, record SKIP.

---

## Output

Write `.planning/POST-DEPLOY-RESULT.md`:

```markdown
# Post-deploy monitoring — YYYY-MM-DD

## Error tracking (Sentry)
- Status: PASS | SKIP | FAIL
- SDK: @sentry/nextjs@x.y.z (or equivalent)
- DSN source: SENTRY_DSN env var
- Source maps: configured | n/a
- Notes: (any warnings)

## Uptime monitoring
- Status: PASS | SKIP | FAIL
- Health endpoint: /health (created | already existed)
- Monitoring doc: MONITORING.md
- Notes: (any warnings)

## Smoke test
- Status: PASS | SKIP | FAIL
- Script: e2e/smoke.spec.ts
- Routes covered: /, /dashboard, /settings
- Schedule: GitHub Actions nightly | local cron | manual
- Notes: (any warnings)
```

---

## Failure handling

- Each category gets 2 attempts. On second failure: log WARNING in `POST-DEPLOY-RESULT.md`, continue to next category.
- A failed category does NOT block promotion. Promotion already succeeded at this point.
- Surface all warnings to the user at the end: "Post-deploy monitoring partially set up. See `.planning/POST-DEPLOY-RESULT.md` for details."

---

## Anti-patterns

- Don't hardcode the Sentry DSN. Always read from env.
- Don't install monitoring tools in `devDependencies` — they run in production.
- Don't write a full E2E regression suite. The smoke test is 3 routes, not the whole app.
- Don't block promotion on monitoring failures. This protocol runs AFTER scope is already flipped.
- Don't skip silently. Every category gets an explicit PASS, SKIP, or FAIL in the result file.

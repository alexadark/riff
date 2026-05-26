# DASHBOARD-REGISTER — Ping the running dashboard

Called by `/riff:start` Stage 5 after bootstrap files exist. Pings the dashboard so the new project shows up immediately without the user re-running `/riff:dashboard`.

No-op if the dashboard is not running. No prompt. Errors swallowed. Best-effort by design.

## Ping

```bash
if curl -fsS http://localhost:4000/api/projects >/dev/null 2>&1; then
  curl -fsS -X POST http://localhost:4000/api/projects \
    -H "Content-Type: application/json" \
    --data "{\"path\":\"$(pwd)\"}" >/dev/null 2>&1 || true
fi
```

## Fallback

If the dashboard is started later from inside this project, `/riff:dashboard` will auto-register it then.

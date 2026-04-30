# RIFF Dashboard

Local web dashboard for the RIFF framework. Reads `ROADMAP.yaml`, `STATE.md`, and `.planning/phases/**` from the current working directory and serves a kanban + phase detail view.

## Run

```bash
cd <your-project-root>
cd /path/to/riff/dashboard
bun install
bun run start
```

Default port: `4000`. Override with `PORT=5000 bun run start`.

The server reads the project from the `PROJECT_ROOT` env var (falling back to `process.cwd()`), so launch it via `/riff:dashboard` from inside your project.

## Endpoints

- `GET /api/project` — project metadata + dashboard config
- `GET /api/phases` — phase list
- `GET /api/phase/:id` — phase detail + parsed metadata
- `POST /api/phase/:id/generate?level=&kind=pre|post` — SSE stream of `claude --print` chunks
- `GET /api/events` — SSE stream of file-change events
- `GET /api/bootstrap-status` — background generation progress
- `GET /` and `*` — static frontend served from `./public/`

## Requirements

- [Bun](https://bun.sh) ≥ 1.1
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) on `PATH` for explanation generation (optional; dashboard still renders without it).

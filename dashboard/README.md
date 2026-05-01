# RIFF Dashboard

Local web dashboard for the RIFF framework. Reads `ROADMAP.yaml`, `STATE.md`, and `.planning/phases/**` from every registered project, and serves a kanban + phase-detail view in a browser. Read-only — driving still happens in the terminal via `/riff:next`.

```
┌─────────────────────────────────────────────────┐
│ RIFF Dashboard — http://localhost:4000          │
├─────────────────────────────────────────────────┤
│ Project: my-saas        [scratch ▢] [production ■] │
│                                                 │
│  Backlog        In Progress      Done           │
│  ───────        ───────────      ────           │
│  Phase 4        Phase 3           Phase 1       │
│  Phase 5        ▶ executor        Phase 2       │
│  Phase 6                                         │
│                                                 │
│ ─ Phase 3 detail ────────────────────────────── │
│ Pre-explanation (haiku, simple, fr)             │
│ Cette phase ajoute la route de connexion ...    │
│                                                 │
│ Post-explanation (after Step 5e)                │
│ ...                                              │
│                                                 │
│ Generation metadata                              │
│ Duration: 12m | Files: 8 chg, +234 -56          │
│ Gates: 4b ✓ | 5b skipped | 5d ✓ | 6 ✓ | 7 ✓     │
└─────────────────────────────────────────────────┘
```

## Run

The recommended way is the slash command from inside any RIFF project:

```bash
cd ~/my-project
# inside Claude Code:
/riff:dashboard
```

It auto-installs dependencies on first run, registers the project, opens the browser, and is idempotent (re-running attaches to the existing server instead of restarting it).

To run the server manually for development:

```bash
cd ~/DEV/frameworks/riff/dashboard
bun install
bun run start
```

Default port: `4000`. Override with `PORT=5000 bun run start`.

## Multi-project registry

The dashboard supports many RIFF projects from a single server. The registry lives at `~/.riff/projects.json` and is populated by `/riff:dashboard` (which auto-registers `cwd` on every run) and by `/riff:start` (which posts to `/api/projects` if the dashboard is already up).

Each registry entry stores: project root path, slug (derived from the directory name), human-readable label, and a `realpath` for symlink-safe matching.

Projects can be removed via `DELETE /api/projects/:slug` or directly by editing `~/.riff/projects.json`. Each project card has a hover-revealed `×` button that triggers the same delete (with confirmation).

### Adding from the UI (macOS)

The topbar `+` button reveals an Add Project form. Clicking it auto-opens the native macOS folder picker (via `POST /api/pick-folder`); selecting a folder fills the path field and submits. A `Browse…` button on the form re-opens the picker if the user cancels or wants to switch folder. Pasting an absolute path manually still works the same way.

On non-macOS platforms, the picker endpoint returns `501` and the user falls back to typing the path. The form remains functional in either case.

## Endpoints

| Method | Path                                              | Purpose                                                                 |
| ------ | ------------------------------------------------- | ----------------------------------------------------------------------- |
| GET    | `/api/projects`                                   | List registered projects + active dashboard config                      |
| POST   | `/api/projects`                                   | Register a project (`{ "path": "/abs/path/to/project" }`)              |
| DELETE | `/api/projects/:slug`                             | Remove a project from the registry                                      |
| POST   | `/api/pick-folder`                                | Open a native macOS folder picker (via `osascript`). Returns `{ path }`, `{ cancelled: true }`, or `501` on non-darwin |
| GET    | `/api/projects/:slug`                             | Project metadata + parsed `ROADMAP.yaml` shape                          |
| GET    | `/api/projects/:slug/phase/:id`                   | Phase detail: PLAN.md, SUMMARY.md, gates, explanations, metadata        |
| GET    | `/api/projects/:slug/phase/:id/generate`          | SSE stream of `claude --print` chunks (lazy explanation generation)     |
| GET    | `/api/projects/:slug/bootstrap-status`            | Background bootstrap progress (per-project)                             |
| GET    | `/api/events`                                     | SSE stream of file-change events (cross-project)                        |
| GET    | `/`                                               | Static frontend served from `./public/`                                 |

## Architecture

```
dashboard/
├─ server.ts          Bun HTTP server, REST + SSE endpoints, file watcher
├─ services/
│  ├─ claude.ts       Spawns `claude --print` for explanations
│  ├─ bootstrap.ts    Lazy generation runner (per-project)
│  ├─ git.ts          Diff-stat helper (real durations and file counts)
│  └─ watcher.ts      Chokidar watcher on .planning/ and STATE.md
├─ parsers/
│  ├─ phase.ts        Artifact files → JSON (PLAN.md, SUMMARY.md, GATES.md)
│  ├─ profile.ts      profile.yaml resolution + registry I/O
│  └─ roadmap.ts      ROADMAP.yaml → kanban shape
└─ public/
   ├─ index.html
   ├─ app.js          Vanilla JS, no build step
   └─ style.css
```

The frontend is intentionally build-free (vanilla JS + CSS) so the dashboard can ship with the framework and be edited in place. Hash-based routing (`/#/projects/<slug>`) keeps the SPA URL stable across reloads.

## Configuration

### Environment

| Variable     | Default                | Purpose                                                |
| ------------ | ---------------------- | ------------------------------------------------------ |
| `PORT`       | `4000`                 | Server port                                            |
| `PROJECT_ROOT` | `process.cwd()`     | Fallback project root if the registry is empty         |

### profile.yaml (at the framework root)

```yaml
style:
  explanation_level: simple   # technical | simple | eli5
  terminal_explanation_level: simple   # optional override for terminal output only

dashboard:
  language: fr                # fr | en | es | ... — falls back to user.conversational_language, then en
  level: simple               # legacy field, equivalent to style.explanation_level
```

The dashboard caches its profile on startup. Edit `profile.yaml`, then restart with:

```bash
/riff:dashboard --stop && /riff:dashboard
```

Existing per-phase explanations regenerate on next visit (lazy bootstrap detects the level/language drift).

## Live updates

The server keeps a chokidar watcher on `.planning/phases/**` and `STATE.md` for every registered project. File changes (a new SUMMARY.md, an updated VERIFICATION.md, etc.) emit SSE events on `GET /api/events`. The frontend re-fetches and re-renders without manual refresh.

This makes the dashboard a live mirror of `/riff:next` runs: while a phase is executing in the terminal, you can watch the kanban tile move and the metadata block fill in.

## Stop / restart

```bash
/riff:dashboard --stop      # via slash command
```

The slash command kills the process via the PID file at `~/.riff/dashboard.pid`. If the PID file is missing or stale, it falls back to a port-level kill on `:4000`.

For manual control: the server runs in the foreground (or detached when started by `/riff:dashboard`), so `Ctrl-C` stops a foreground run.

## Bootstrap (lazy explanation generation)

Plain-language explanations (`EXPLAIN.{level}.md`, `EXPLAIN-POST.{level}.md`) are not committed to the project. They are generated on demand:

- **At `/riff:next`:** Step 4c writes the pre-execution explanation, Step 5e writes the post-execution one. Both at the level + language declared in `profile.yaml`.
- **On first dashboard visit per project:** missing files trigger a background bootstrap that calls `claude --print` for each phase. Progress shows in the UI. Takes 30s to 3min depending on phase count.

If `claude` is not on `PATH`, generation fails gracefully and the UI shows a placeholder. The rest of the dashboard (kanban, metadata, gate summary) still works.

## Requirements

- [Bun](https://bun.sh) ≥ 1.1
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) on `PATH` for explanation generation (optional — dashboard still renders without it)
- Modern browser (Chrome, Firefox, Safari, Edge — uses native ES modules, no IE)

## Troubleshooting

**Browser shows "Project not found"** — the slug in the URL does not match any registered project. Check `~/.riff/projects.json` and re-register with `POST /api/projects` or `/riff:dashboard` from the project directory.

**Explanations are stuck at "generating..."** — likely a `claude` CLI failure. Check `dashboard/.last-run.log` for stderr from the `claude --print` subprocess. Common cause: API rate limit, missing auth, or stale auth token.

**Port 4000 already in use** — set `PORT=5000` (or another free port) before starting. The slash command does not currently surface a custom port; for non-default ports, run `bun run start` directly.

**File-change events not firing** — the watcher targets `.planning/phases/**` and `STATE.md`. If you are editing files outside those paths (e.g. PROJECT.md, taste.md), the dashboard will not refresh automatically. Refresh manually.

**"could not locate RIFF framework root" warning at startup** — the server walks up from `dashboard/` looking for `profile.yaml.example`. If you have moved the `dashboard/` directory outside the framework, this fails and falls back to the parent. Move it back or symlink it.

# BOOTSTRAP-FILES — Stage 5 file creation

Called by `/riff:start` Stage 5 after Stages 1-4.5 have locked discovery decisions. Creates the project's persistent artifacts so `/riff:next` has somewhere to read state from.

Two paths, gated on `scope` in `.planning/config.json`:

- **`scope: scratch`** — minimal set, just enough to start building.
- **`scope: production`** — full discipline (taste rules, incident ledger, README, CONTEXT).

---

## scratch scope (light)

Only create what's needed to start building. Don't seed `taste.md`, `CONTEXT.md`, `INCIDENTS.md`, or stack-specific configs. This is part of the legacy Claude command workflow; native worker boundaries are defined by the validated plan and `protocols/RIFF-NEXT.md`.

Files to create:

- `STATE.md` — phase 1, status: Initialized
- `README.md` — short stub: project name + "WIP, not for production" + a one-line dev command. If a starter clone shipped its own README, overwrite — the content describes the starter, not your project.
- `mkdir -p .planning/{phases,sessions}` (no `design/` — no design modules ran)

Skip the Stack detection subsection (below) entirely. Jump to Stage 5 Output.

---

## production scope (full)

### Files to create

- `CONTEXT.md` — locked decisions from discovery
- `taste.md` (index + always-apply) and `taste/` topic files — start from `templates/taste.md`. The template is an index with an "always-apply architecture" section inline and a "Load on-demand" table pointing to `taste/*.md`. Create the topic files:
  - `taste/frontend.md` — seeded from `references/taste/stacks/{slug}.md` (framework conventions) + project-specific UI patterns surfaced in discovery.
  - `taste/backend.md` — seeded from `references/taste/backend.md` + project-specific service/provider patterns.
  - `taste/security.md` — seeded from `references/taste/security.md` + project-specific auth/tenant rules.
  - `taste/testing.md` — seeded from `references/taste/testing.md`.
  - Populate the main `taste.md` "always-apply architecture" section from `references/taste/architecture.md` + project-specific architectural decisions (hexagonal, JSONB-first, etc.).
  - If no reference exists for the stack, seed `taste/frontend.md` as an empty stub marked "to fill after tracer bullet."
  - Keep each topic file under ~50 lines. Split further if it grows (e.g. `taste/database.md` spun out of backend).
  - Verify version-specific rules via `ref_search_documentation` or Context7 MCP before writing.
- `STATE.md` — phase 1, status: Initialized
- `INCIDENTS.md` — copy from `templates/INCIDENTS.md` (regression ledger, append-only)
- `README.md` — write a project-specific README seeded from PROJECT.md. Sections: project name + one-paragraph context (what it does, who for), Stack (bullet list from PROJECT.md), Local dev (prerequisites + the actual `pnpm install` / `pnpm dev` / test commands the bootstrap settled on), Workflow (one-liner pointing to RIFF + `.riff/commands/INDEX.md`), Repo layout (a few key dirs), Status (one line about phase 1). Keep it to ~50-100 lines. If a starter clone shipped its own README (saas-starter, web-starter, etc.), OVERWRITE it — the content describes the template, not your project. Cross-check that the dev commands match `package.json` `scripts:` so you don't ship a README that lies about how to run the app.
- `mkdir -p .planning/{phases,sessions,design}`

### Stack detection

Stack is captured in Stage 1 (Constraints axis). Map to slug:

| Stack mention in PROJECT.md         | Slug                                 |
| ----------------------------------- | ------------------------------------ |
| React Router 7, RR7, framework mode | `react-router-7`                     |
| Next.js (app router, pages router)  | `nextjs` (add when first used)       |
| Astro                               | `astro` (add when first used)        |
| Python / FastAPI / Django           | `python-{framework}` (add when used) |
| Go                                  | `go` (add when used)                 |

When a new stack is used for the first time, create `references/taste/stacks/{slug}.md` in RIFF itself (not just the project). Pattern after `react-router-7.md`: Core Rules → Component conventions → Framework-specific topics → UX & Accessibility → Anti-Pattern Checklist.

## Dashboard Registration

Called by `/riff:start` Stage 5 after bootstrap files exist. Pings the dashboard so the new project shows up immediately without the user re-running `/riff:dashboard`.

No-op if the dashboard is not running. No prompt. Errors swallowed. Best-effort by design.

### Ping

```bash
if curl -fsS http://localhost:4000/api/projects >/dev/null 2>&1; then
  curl -fsS -X POST http://localhost:4000/api/projects \
    -H "Content-Type: application/json" \
    --data "{\"path\":\"$(pwd)\"}" >/dev/null 2>&1 || true
fi
```

### Fallback

If the dashboard is started later from inside this project, `/riff:dashboard` will auto-register it then.

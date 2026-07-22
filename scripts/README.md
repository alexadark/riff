# scripts/

Standalone shell scripts used by the RIFF pipeline. These are called directly from `commands/next.md` steps — not hooks, not agents.

---

## riff-pr-metadata.sh

**Usage:** `scripts/riff-pr-metadata.sh <phase-id>`

Generates the optional `## Generation metadata (RIFF)` section appended to RIFF PR descriptions. Called at `/riff:next` Step 8b when `metadata.pr_body` is `standard` or `full`.

**Inputs:** reads from the project root. All paths are relative to `cwd`.

| Source | What it reads |
| ------ | ------------- |
| `.planning/phases/<id>-*/PLAN.md` | Phase artifact paths |
| `.planning/phases/<id>-*/SUMMARY.md` | Phase artifact paths |
| `.planning/phases/<id>-*/GATES.md` | Gate log entries |
| `.planning/phases/<id>-*/USAGE.md` | Token usage table (`metadata.pr_body: full` only) |
| `.planning/phases/<id>-*/PROMPTS.md` | Sub-agent prompts (`metadata.pr_body: full` only) |
| `.planning/codex-usage.csv` | Codex call count + duration for this phase |
| `ROADMAP.yaml` | Slug, executor_model, codex_model, codex_effort, debug_model |
| `git log main..HEAD` | Commit count, file diff, duration (first→last commit timestamp) |
| Commit trailers `Agent:` / `Model:` | Which agents fired, per commit |

**Output:** markdown section to stdout. Append to the PR body:

```bash
body=$(cat .planning/phases/N-slug/SUMMARY.md)
body+=$'\n'$(scripts/riff-pr-metadata.sh N)
gh pr create --body "$body" ...
```

**Metadata modes:** resolved from profile `metadata.pr_body`:
- `off` → emits nothing and exits 0
- `standard` → models, duration, gates, Codex usage, commit trailers
- `full` → standard plus USAGE.md token table and PROMPTS.md captured prompts

**Error conditions:**
- Missing `<phase-id>` argument → exits 2 with usage message.
- Phase folder not found → exits 1 with a clear message.
- `metadata.pr_body: full` and `PROMPTS.md` still contains `{{prompt verbatim}}` placeholder → exits 1 with instructions for which sections need filling. This prevents template tokens from leaking into the PR body.

**Slug resolution:** reads `slug` from `ROADMAP.yaml` for the given phase id. Falls back to the folder name if YAML has no `slug` field (legacy roadmap). Logs a warning to stderr on fallback.

**macOS / Linux:** uses `date -j -f` (BSD date) on Darwin, `date -d` elsewhere for timestamp math.

---

## dashboard.sh

**Usage:** `riff dashboard [--stop]`, `bash .riff/scripts/dashboard.sh [--stop]`, or `/riff:dashboard [--stop]`

Single source of truth for the local Bun dashboard lifecycle. Starts (or attaches to) the server on `http://localhost:4000`, auto-registers the current project into the registry, and opens the browser at the project's kanban view. `--stop` terminates the running server.

Called three ways, all identical: the `riff dashboard` CLI command, the `/riff:dashboard` slash command (thin wrapper over `.riff/scripts/dashboard.sh`), and directly.

**Behavior:**
- Idempotent start: if `GET /api/projects` already responds, it registers cwd and opens the browser without touching the running process.
- Framework root resolution order: `RIFF_FRAMEWORK_ROOT` env (set by the CLI) → project `.riff/` symlink → `framework_path:` in `~/.config/riff/config.yaml` → legacy `~/DEV/frameworks/riff`.
- PID file at `~/.riff/dashboard.pid`; a stale PID (process gone) is treated as not-running and cleaned up.
- Guards: requires `.planning/` in cwd (RIFF project) and `bun` on PATH.

---

## csv-append.sh

**Usage:** `bash .riff/scripts/csv-append.sh <csv-file> <row>`

Atomic CSV row append with flock-based locking. Used by `/riff:next` to write to `.planning/codex-usage.csv` without clobbering concurrent writes (two terminals, two phases running in parallel).

**Locking behavior:**
- If `flock` is available (Linux, macOS with `brew install util-linux`): acquires an exclusive lock on `<file>.lock` before appending. Concurrent calls serialize cleanly.
- If `flock` is unavailable (macOS stock): best-effort append. Concurrent APFS writes may interleave; acceptable for the usage-log use case.

**Note:** this script uses bash fd-redirection syntax. Must be called with `bash`, not `sh` — the shebang handles this when invoked via `bash .riff/scripts/csv-append.sh`, but `sh scripts/csv-append.sh` will fail.

**CSV schema** (`.planning/codex-usage.csv`):

```
timestamp,phase,step,model,effort,outcome,duration_sec
2026-05-08T14:23:00Z,96.7,4b,gpt-5.5,medium,proceed,47
```

| Column | Values |
| ------ | ------ |
| `timestamp` | ISO-8601 UTC |
| `phase` | matches ROADMAP.yaml `id` |
| `step` | `4b` (plan adversarial) or `6` (code adversarial) |
| `model` | resolved Codex model |
| `effort` | `low` / `medium` / `high` / `xhigh` |
| `outcome` | `proceed` / `revise` / `error` |
| `duration_sec` | integer seconds |

---

## scope-check.mjs

**Usage:** `node .riff/scripts/scope-check.mjs --phase .planning/phases/N-slug`

Mechanical Step 5c checker. Reads `PLAN.md` and `SUMMARY.md`, writes `SCOPE-CHECK.json`, and exits `0` only for `MATCH`.

Source of truth: `protocols/SCOPE-CHECK.md`.

---

## riff-codex.mjs

**Usage:** `node scripts/riff-codex.mjs <command> [options]`

Generates compact Codex context packs and, with `--run`, runs one Codex capability through `codex exec --full-auto`. This is a Codex executor runtime path, not a project adapter or install target. It is step-oriented and does not run unattended loops.

Start a project:

```bash
node scripts/riff-codex.mjs start --project-root /path/to/project --brief "Production SaaS for..." --print
```

`start` writes or preserves:

- `PROJECT.md`
- `.planning/config.json`
- `.planning/design/*.md` when design decisions materially affect the roadmap
- `ROADMAP.yaml`
- `STATE.md`

Phase capabilities still require `--phase`:

```bash
node scripts/riff-codex.mjs plan --phase 2-codex-adapter --print
```

Project-level commands:

```bash
node scripts/riff-codex.mjs status --run
node scripts/riff-codex.mjs add-phase --input "Add billing setup phase" --run
```

`--project-root`, `--brief`, and `--refresh` apply only to `start`. `--input` applies to project-level commands such as `add-phase`. Existing start artifacts are preserved unless `--refresh` is supplied. Manual Opus escalation may create `.planning/OPUS-START-PROMPT.md`, but Opus output is draft input only and does not bypass normal RIFF gates.

---

## riff-init.mjs

**Usage:** `riff init [options]` or `node scripts/riff-init.mjs [options]`

Installs RIFF into a project from the terminal. It installs Claude Code runtime files only; Codex stays available as an opt-in executor via skill/CLI (the default executor is Sonnet) and requires no project harness.

```bash
riff init
riff init --scope scratch
riff init --project-root /path/to/project
riff init --profile alex
```

`riff init` creates or preserves:

- `.riff` symlink to the RIFF framework repo
- `.planning/` skeleton and `.planning/config.json`
- `.claude/commands/riff`, `.claude/agents/riff`, `.claude/hooks/riff`, `.claude/settings.json`, and git hooks
- `.gitignore` entries and a RIFF section in project `CLAUDE.md`

When the terminal is interactive, `riff init` continues into profile onboarding and writes `.planning/profile.yaml`. Use `--profile default`, `--profile custom`, or `--no-onboard` to control this explicitly.

Installed Claude files are symlinked through the project-local `.riff/` link so the RIFF framework clone remains the source of truth.

`riff init` does not create `PROJECT.md`, `.planning/design/*`, `ROADMAP.yaml`, or `STATE.md`; those are `start` artifacts.

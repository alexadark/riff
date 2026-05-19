# scripts/

Standalone shell scripts used by the RIFF pipeline. These are called directly from `commands/next.md` steps — not hooks, not agents.

---

## riff-pr-metadata.sh

**Usage:** `scripts/riff-pr-metadata.sh <phase-id>`

Generates the `## Generation metadata (RIFF)` section appended to every RIFF PR description. Called at `/riff:next` Step 8c.

**Inputs:** reads from the project root. All paths are relative to `cwd`.

| Source | What it reads |
| ------ | ------------- |
| `.planning/phases/<id>-*/PLAN.md` | Phase artifact paths |
| `.planning/phases/<id>-*/SUMMARY.md` | Phase artifact paths |
| `.planning/phases/<id>-*/GATES.md` | Gate log entries |
| `.planning/phases/<id>-*/USAGE.md` | Token usage table |
| `.planning/phases/<id>-*/PROMPTS.md` | Sub-agent prompts |
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

**Error conditions:**
- Missing `<phase-id>` argument → exits 2 with usage message.
- Phase folder not found → exits 1 with a clear message.
- `PROMPTS.md` still contains `{{prompt verbatim}}` placeholder → exits 1 with instructions for which sections need filling. This prevents template tokens from leaking into the PR body.

**Slug resolution:** reads `slug` from `ROADMAP.yaml` for the given phase id. Falls back to the folder name if YAML has no `slug` field (legacy roadmap). Logs a warning to stderr on fallback.

**macOS / Linux:** uses `date -j -f` (BSD date) on Darwin, `date -d` elsewhere for timestamp math.

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

## riff-codex.mjs

**Usage:** `node scripts/riff-codex.mjs <command> [options]`

Generates compact Codex context packs and, with `--run`, runs one Codex capability. It is step-oriented and does not run unattended loops.

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

`--project-root`, `--brief`, and `--refresh` apply only to `start`. Existing start artifacts are preserved unless `--refresh` is supplied. Manual Opus escalation may create `.planning/OPUS-START-PROMPT.md`, but Opus output is draft input only and does not bypass normal RIFF gates.

---

## riff-init.mjs

**Usage:** `riff init [options]` or `node scripts/riff-init.mjs [options]`

Installs RIFF into a project from the terminal. This is the harness-neutral setup path used before `start`.

```bash
riff init --harness all
riff init --harness codex --scope scratch
riff init --harness commandcode --project-root /path/to/project
```

`riff init` creates or preserves:

- `.riff` symlink to the RIFF framework repo
- `.planning/` skeleton and `.planning/config.json`
- harness files for `claude`, `codex`, `commandcode`, or `all`

Harness install behavior:

- `claude` wires `.claude/commands/riff`, `.claude/agents/riff`, `.claude/hooks/riff`, and git hooks.
- `claude-code` and `codeable` are accepted aliases for `claude`.
- `codex` wires `.codex/riff` docs and uses `.riff/scripts/riff-codex.mjs` for commands.
- `commandcode` wires `.commandcode/commands/riff`, `.commandcode/hooks`, and `.commandcode/settings.json`.

Installed harness files are symlinked through the project-local `.riff/` link so the RIFF framework clone remains the source of truth.

`riff init` does not create `PROJECT.md`, `.planning/design/*`, `ROADMAP.yaml`, or `STATE.md`; those are `start` artifacts.

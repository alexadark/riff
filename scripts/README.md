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

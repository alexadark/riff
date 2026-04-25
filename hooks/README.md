# RIFF Hooks

## Buckets

Hooks are organized in three buckets. `/riff:init` picks the right set based on `risk.sensitive_task_preference` in `profile.yaml`.

| Bucket | Content | Wired when |
| ------ | ------- | ---------- |
| **A** — Universal discipline | destructive-guard, boundary-check, typecheck-gate, lint-gate, test-gate | Always, regardless of profile. |
| **B** — Security-adaptable | route-auth-guard, idor-detector, input-validation-guard, todo-orphan-guard | `cautious` → all of B; `balanced` → route-auth-guard + idor-detector; `fast` → none. |
| **C** — Stack/convention | registry-reminder, migration-gate (Drizzle/Prisma), notify-human | Installed per-project at `/riff:init` based on detected stack. |

Templates: `templates/settings.json` (fast / Bucket A only), `templates/settings-balanced.json`, `templates/settings-cautious.json`. `/riff:init` copies the right one into `.claude/settings.json`.

Git hooks (pre-commit / commit-msg) are separate: installed once by `/riff:init` into `.git/hooks/`, not profile-driven.

## Warning Accumulator

All hooks log warnings to `.planning/warnings.log` via `log-warning.sh`. This file:

- **Accumulates** throughout a phase (every hook appends, nothing is lost)
- **Reviewed by the verifier** at end of phase (step 3 of verification process)
- **Cleared at phase start** by `/riff:next` (`> .planning/warnings.log`)

Flow: hook fires → warning printed to stdout + logged to file → agent may or may not fix it → verifier reviews ALL warnings at end of phase → unfixed warnings = verification findings.

## Git Hooks (deterministic, run on every commit)

### security-scan.sh (pre-commit)

Blocks commits containing: hardcoded secrets, .env files, console.log (warning), any types (warning).
Also runs: commit scope check (warns if >15 files), orphan file check (warns if new files aren't imported).

**Install:** `/riff:init` copies this to `.git/hooks/pre-commit`

### commit-msg.sh (commit-msg)

No-op placeholder. RIFF does NOT enforce a commit message format — commits should describe the feature or bug like normal conventional commits (`feat:`, `fix:`, `chore:`, etc.). Phase/task numbers belong in SUMMARY.md and ROADMAP.yaml, not in commit messages.

**Install:** `/riff:init` copies this to `.git/hooks/commit-msg`

### orphan-file-check.sh (called by security-scan)

Detects newly added source files that aren't imported anywhere. Catches the #1 silent failure: orphaned code that exists but is never used.

### registry-reminder.sh (called by security-scan)

Warns and blocks if a commit touches the public surface (`app/routes/`, `app/components/`, `app/lib/`, `schema.*`, `.env*`) without also staging `REGISTRY.md`. Escape hatch: `RIFF_SKIP_REGISTRY=1`.

### migration-gate.sh (called by security-scan)

Detects staged migration files (`drizzle/*.sql`, `prisma/migrations/*.sql`) and automatically applies pending migrations before the commit completes. Prevents the #1 ORM pitfall: committing migration files without actually running them against the database.

**Safety guarantees:**

- Only runs forward migrations (`drizzle-kit migrate` / `prisma migrate deploy`) — never `push`, `drop`, or `reset`
- Scans migration SQL for destructive statements (`DROP TABLE`, `TRUNCATE`, `DELETE FROM`, `DROP COLUMN`) and **blocks the commit** if found
- Destructive migrations require manual review: run the migration yourself, then commit with `RIFF_SKIP_MIGRATION_GATE=1`
- Idempotent — running when no migrations are pending is a no-op
- Logs to `.planning/warnings.log` when migrations are auto-applied

**Supported ORMs:** Drizzle, Prisma. Extensible — add a new block in the script for other ORMs.

**Escape hatch:** `RIFF_SKIP_MIGRATION_GATE=1 git commit ...`

## Claude Code Hooks (configured in project .claude/settings.json)

### Destructive Command Guard (PreToolUse: Bash)

Blocks dangerous commands without confirmation: `rm -rf`, `git reset --hard`, `git push --force`, `git checkout .`, `git clean`, `git add .`, `git add -A`.

### Boundary Check (PostToolUse: Edit, Write)

After any file edit, check if the modified file is in the current task's boundary list. If not, warn the agent.

### Typecheck Gate (PostToolUse: Edit, Write)

After editing .ts/.tsx files, run `tsc --noEmit` if available. Catch type errors before they accumulate.

### Lint Gate (PostToolUse: Edit, Write)

After editing .ts/.tsx/.js/.jsx files, run the project's linter if configured. Auto-detects Biome or ESLint from project config. Skips test/config files. Informational only (does not block).

### TODO Orphan Guard (PostToolUse: Edit, Write)

Checks that `// TODO` comments include a seed or issue reference. Rule: "No TODO without a matching seed or issue."

### Route Auth Guard (PostToolUse: Edit, Write)

When a route/API handler file is modified, checks for auth patterns (requireUserId, getSession, etc.). Warns if no auth check found. Skips known public routes (login, register, health). Escape hatch: `// public route` comment.

### Input Validation Guard (PostToolUse: Edit, Write)

When an API handler reads request body, checks for schema validation (Zod .parse, Valibot, Joi, etc.). Warns if body is consumed without validation.

### IDOR Pattern Detector (PostToolUse: Edit, Write)

Detects database queries using params.id without user scoping (userId, user.id, etc.). The #1 vulnerability in solo-dev projects.

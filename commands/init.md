---
description: Install RIFF framework into the current project
allowed-tools: Bash, Read, Write, Glob, Grep, Edit
---

# /riff:init

Install RIFF into the current project via symlink to the local framework repo.

## How it works

`.riff/` is a symlink to your local RIFF clone (single source of truth). Commands, agents, and hooks in `.claude/` are symlinks to `.riff/`. Update the framework once, every project sees the change instantly.

The clone path is resolved from `~/.config/riff/config.yaml` (`framework_path`), written by `/riff:onboard` on first run. If the registry is missing, falls back to `~/DEV/frameworks/riff` for backwards compat.

```
<framework_path>/              ← source (resolved from ~/.config/riff/config.yaml)
        ↑
.riff/ → symlink
        ↓
.claude/commands/riff/next.md → ../../../.riff/commands/next.md
```

## Steps

1. **Prerequisites:** confirm git repo exists. If `.riff/` or `.planning/` exist, ask before overwriting.

2. **Resolve framework path and link RIFF:**

   ```bash
   if [ -f ~/.config/riff/config.yaml ]; then
     RIFF_PATH=$(awk '/^framework_path:/ {print $2}' ~/.config/riff/config.yaml)
   fi
   if [ -z "${RIFF_PATH:-}" ] || [ ! -d "$RIFF_PATH" ]; then
     RIFF_PATH=~/DEV/frameworks/riff
   fi
   if [ ! -d "$RIFF_PATH" ]; then
     echo "ERROR: RIFF not found. Run /riff:onboard from your RIFF clone first." >&2
     exit 1
   fi
   ln -s "$RIFF_PATH" .riff
   ```

   Verify: `ls .riff/commands/` shows the RIFF commands.

3. **Create directories:**

   ```
   .planning/{phases,expertise,seeds,debug,quick,specs}
   .claude/{commands/riff,agents/riff,hooks/riff}
   ```

3b. **Project scope.** If `.planning/config.json` already has `scope`, skip this prompt (re-running init keeps the existing scope). Otherwise AskUserQuestion:

   > **Project scope?**
   > - **production** — others will use it, deployed, has auth/payments/PII, or is destined to. Full RIFF discipline. (Recommended)
   > - **scratch** — personal/local, no auth, no public exposure. Light discovery, no security gates.

   Write to `.planning/config.json` (create or merge):

   ```json
   { "scope": "production" }
   ```

   `/riff:start` Stage 1 detects this value and skips its own scope gate, so the user is not asked twice.

3c. **Profile choice.** AskUserQuestion:

   > **Profile for this project?**
   > - **use my default profile (recommended)** — agents read the framework `profile.yaml`. Same persona, strictness, and language as your other projects.
   > - **customize for this project** — write a project-local profile at `.planning/profile.yaml`. Useful for stricter client work, a different language, or a workshop demo. Replaces the global default in this project only (full override, no merge).

   On `customize`: invoke `/riff:onboard` inline. It detects the project context (because `.planning/` now exists) and writes `.planning/profile.yaml`. The user runs through the standard preset/custom flow.

   On `use my default profile`: do nothing. Agents fall through to the framework default per `references/PROFILE-RESOLUTION.md`.

4. **Create symlinks** (relative paths, 3 levels up from `.claude/*/riff/`):

   ```bash
   for f in .riff/commands/*.md; do
     ln -sf "../../../.riff/commands/$(basename $f)" ".claude/commands/riff/$(basename $f)"
   done
   for f in .riff/agents/*.md; do
     ln -sf "../../../.riff/agents/$(basename $f)" ".claude/agents/riff/$(basename $f)"
   done
   for f in .riff/hooks/*.sh; do
     name=$(basename "$f")
     [ "$name" = "security-scan.sh" ] || [ "$name" = "commit-msg.sh" ] && continue
     ln -sf "../../../.riff/hooks/$name" ".claude/hooks/riff/$name"
   done
   # riff-loop.sh stays inside .riff/ — run with .riff/riff-loop.sh
   chmod +x .riff/riff-loop.sh
   ```

5. **Local copies** (project-specific, NOT symlinked):
   - `.claude/agents/riff/CLAUDE.md` — copy from `.riff/CLAUDE.md`
   - `.claude/hooks/riff/banner.sh` — copy from `.riff/templates/banner.sh`, chmod +x

6. **Git hooks:** copy `security-scan.sh` → `.git/hooks/pre-commit`, `commit-msg.sh` → `.git/hooks/commit-msg`. chmod +x. If hooks exist, append.

7. **Claude Code hooks:** pick the hook bucket from `profile.yaml`, then merge into `.claude/settings.json` (or copy if missing).

   Read `.riff/profile.yaml` and extract `risk.sensitive_task_preference`. Pick the template:

   | Profile value | Template | Hooks wired |
   | ------------- | -------- | ----------- |
   | `cautious` | `.riff/templates/settings-cautious.json` | Bucket A + all of Bucket B |
   | `balanced` | `.riff/templates/settings-balanced.json` | Bucket A + route-auth-guard + idor-detector |
   | `fast` or missing profile | `.riff/templates/settings.json` | Bucket A only |

   **Bucket A** (universal): destructive-guard, boundary-check, typecheck-gate, lint-gate, test-gate.
   **Bucket B** (security-adaptable): route-auth-guard, idor-detector, input-validation-guard, todo-orphan-guard.

   If profile changes later (edit `profile.yaml` directly, or ask Claude to update it), re-run this step manually or re-run `/riff:init` to rewire.

8. **Project files:** create `STATE.md` from template, replace `{{PROJECT_NAME}}` with dir name.

9. **Gitignore:** add `.riff/` and `.planning/debug/`.

10. **Update CLAUDE.md:** append RIFF section with commands reference, execution rules, pointer to `.riff/protocols/`.

11. **GitHub workflows:** if `.github/workflows/` does NOT exist, copy the RIFF defaults. If it DOES exist, leave it and run the drift audit described in `.riff/templates/github-workflows/README.md` (warn if lint is gating or if `e2e.yml` auto-triggers on push/PR — do not rewrite without confirmation).

    ```bash
    if [ ! -d .github/workflows ]; then
      mkdir -p .github/workflows
      cp .riff/templates/github-workflows/ci.yml  .github/workflows/ci.yml
      cp .riff/templates/github-workflows/e2e.yml .github/workflows/e2e.yml
      # If the project uses pnpm, swap the package manager references:
      # sed -i.bak -E 's|actions/setup-node@v4|pnpm/action-setup@v4|;s|npm ci|pnpm install --frozen-lockfile|;s|npm run|pnpm run|' .github/workflows/ci.yml .github/workflows/e2e.yml
      echo "Installed default RIFF workflows. Review .github/workflows/ before pushing."
    else
      echo "Existing .github/workflows/ detected — skipped. Check against .riff/templates/github-workflows/README.md for drift."
    fi
    ```

11.5. **Tooling config:** copy canonical tooling configs from `templates/` into project root if absent. Mirrors the Step 11 pattern (per-file conditional copy, no overwrite).

    ```bash
    for f in biome.json vitest.config.ts vitest.setup.ts drizzle.config.ts playwright.config.ts tsconfig.json components.json vite.config.ts .semgrep.yml .gitleaks.toml; do
      if [ ! -f "$f" ] && [ -f ".riff/templates/$f" ]; then
        cp ".riff/templates/$f" "./$f"
        echo "Installed $f from RIFF templates."
      fi
    done
    if [ -f vitest.config.ts ] && ! grep -q '@vitest/coverage-v8' package.json 2>/dev/null; then
      echo "  hint: vitest coverage thresholds require @vitest/coverage-v8."
      echo "        run: npm install --save-dev @vitest/coverage-v8"
    fi
    ```

12. **Show banner:** `bash .riff/templates/banner.sh`

```
RIFF installed. Next:
  New project:      /riff:start
  Existing project: /riff:map
  Quick task:       /riff:quick
```

## Notes

- Updating RIFF: no action needed — `.riff/` is a symlink to your local repo.
- Do NOT create PROJECT.md, ROADMAP.yaml, CONTEXT.md, taste.md — those come from `/riff:start`.
- `.riff/` is gitignored (local symlink, not portable). Symlinks in `.claude/` ARE committed (relative paths).
- `.claude/agents/riff/CLAUDE.md` is a COPY — project-specific, may diverge.

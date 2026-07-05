---
description: Install RIFF framework into the current project
allowed-tools: Bash, Read, Write, Glob, Grep, Edit
---

# /riff:init

Install RIFF into the current project via symlink to the local framework repo.

## How it works

`.riff/` is a symlink to your local RIFF clone (single source of truth). Commands, agents, and hooks in `.claude/` are symlinks to `.riff/`. Update the framework once, every project sees the change instantly.

The terminal entrypoint is:

```bash
riff init
```

`/riff:init` is the Claude Code wrapper for the same install model. Prefer the terminal CLI from shell scripts or any environment that can execute project setup directly.

The clone path is resolved from `~/.config/riff/config.yaml` (`framework_path`), written by `/riff:onboard` on first run. If the registry is missing, falls back to `~/DEV/frameworks/riff` for backwards compat.

```
<framework_path>/              ← source (resolved from ~/.config/riff/config.yaml)
        ↑
.riff/ → symlink
        ↓
.claude/commands/riff/next.md → ../../../.riff/commands/next.md
```

## Steps

1. **Prerequisites:** if no git repo exists in the current directory (`! -d .git`), `riff init` runs `git init -q` and proceeds. A git repo is a non-negotiable RIFF requirement. Existing `.riff/` and `.planning/` content is preserved unless `--force` is explicitly used for a mismatched `.riff` symlink.

2. **Resolve framework path and link RIFF:**

   If the global `riff` CLI is available, run:

   ```bash
   riff init
   ```

   Then verify `.riff/commands/` exists and skip the rest of the mechanical install steps below. The remaining steps are the fallback/reference implementation for environments where the CLI is not on `PATH`.

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
   .claude/{commands/riff,agents/riff,hooks/riff,skills}
   ```

3b. **Project scope.** If `.planning/config.json` already has `scope`, skip this prompt (re-running init keeps the existing scope). Otherwise AskUserQuestion:

   > 📦 **Project scope?**
   >
   > - 🟢 **production** — others will use it, deployed, has auth/payments/PII, or is destined to. Full RIFF discipline. (Recommended)
   > - 🟡 **scratch** — personal/local, no auth, no public exposure. Light discovery, no security gates.

   Write to `.planning/config.json` (create or merge):

   ```json
   { "scope": "production" }
   ```

   `/riff:start` Stage 1 detects this value and skips its own scope gate, so the user is not asked twice.

3c. **Profile choice.** AskUserQuestion:

   > 👤 **Profile for this project?**
   >
   > - 🟢 **use my default profile** — agents read the framework `profile.yaml`. Same persona, strictness, and language as your other projects. (Recommended)
   > - 🔵 **customize for this project** — write a project-local profile at `.planning/profile.yaml`. Useful for stricter client work, a different language, or a workshop demo. Replaces the global default in this project only (full override, no merge).

   On `customize`: invoke `/riff:onboard` inline. It detects the project context (because `.planning/` now exists) and writes `.planning/profile.yaml`. The user runs through the standard default/custom flow.

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
   mkdir -p .claude/skills
   for d in .riff/skills/*/; do
     name=$(basename "$d")
     ln -sfn "../../.riff/skills/$name" ".claude/skills/$name"
   done
   ```

5. **Framework-owned special links** (still symlinked through `.riff/`):
   - `.claude/agents/riff/CLAUDE.md` → `../../../.riff/CLAUDE.md`
   - `.claude/hooks/riff/banner.sh` → `../../../.riff/templates/banner.sh`

6. **Git hooks:** symlink `.git/hooks/pre-commit` → `.riff/hooks/security-scan.sh` and `.git/hooks/commit-msg` → `.riff/hooks/commit-msg.sh`. If hooks already exist and are not RIFF symlinks, stop unless the user explicitly asks to replace them.

7. **Claude Code hooks:** pick the hook bucket from the resolved profile, then copy the selected template into `.claude/settings.json` when that file is absent. Preserve existing project settings.

   Read the resolved profile and extract `risk.sensitive_task_preference`. Pick the template:

   | Profile value | Template | Hooks wired |
   | ------------- | -------- | ----------- |
   | `cautious` | `.riff/templates/settings-cautious.json` | Bucket A + all of Bucket B |
   | `balanced` | `.riff/templates/settings-balanced.json` | Bucket A + route-auth-guard + idor-detector |
   | `fast` or missing profile | `.riff/templates/settings.json` | Bucket A only |
   | unknown value | `.riff/templates/settings-cautious.json` | Fail closed and warn |

   **Bucket A** (universal): destructive-guard, boundary-check, typecheck-gate, test-gate.
   **Bucket B** (security-adaptable): route-auth-guard, idor-detector, input-validation-guard, todo-orphan-guard.

   If profile changes later (edit `.planning/profile.yaml` or the framework fallback `profile.yaml`, or ask Claude to update it), re-run this step manually or re-run `/riff:init` after removing or editing `.claude/settings.json`.

8. **Project files:** do not create `PROJECT.md`, `ROADMAP.yaml`, `STATE.md`, `CONTEXT.md`, or `taste.md` during init. Those are start/map artifacts.

9. **Gitignore:** add `.riff/` and `.planning/debug/`.

10. **Update CLAUDE.md:** append RIFF section with commands reference, execution rules, pointer to `.riff/protocols/`.

11. **GitHub workflows:** do not install workflows during init. `.riff/templates/github-workflows/` contains optional reference workflows for projects that deliberately adopt them later.

12. **Tooling config:** do not copy lint/format/tooling configs during init. Stack-specific tooling belongs to `/riff:start` or explicit project decisions, not the RIFF install step.

13. **Show summary:** report project path, framework path, installed runtime files, executor default, git status, scope/profile/settings status, and the next command.

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
- RIFF-owned installed files are symlinks through `.riff/`. Project-specific overrides belong in project artifacts, not in copied framework files.

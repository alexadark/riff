# Profile resolution

Single rule for every RIFF agent and command that needs to read the user profile.

## Resolution order

1. `<project_root>/.planning/profile.yaml` — per-project override, if it exists
2. `<framework_root>/profile.yaml` — global default
3. `<framework_root>/templates/profile.default.yaml` — canonical baseline (mirrors the default profile in `commands/onboard.md`)

The first existing file wins. No field-by-field merge — if the project file exists, it fully replaces the framework file for that project.

If you write a project override, supply every field you care about: missing keys do NOT inherit from the framework profile. Partial overrides fall through to the literal safety net in code (`simple` / `en`), which is rarely what you want.

## Resolvers

Two helpers implement this chain. Both produce identical output for identical inputs.

- **Shell:** `lib/resolve-profile.sh <project_root> [framework_root]` — outputs the resolved YAML to stdout. Source path echoed to stderr.
- **TypeScript:** `dashboard/lib/resolveProfile.ts` — exports `resolveProfile({ projectRoot?, frameworkRoot })` returning `{ profile, source, path }`.

Hooks call the shell helper. The dashboard calls the TS helper (directly via `resolveProjectConfig` in `dashboard/parsers/profile.ts` for per-project rendering).

## How to find `<framework_root>`

1. From inside a project: `<project_root>/.riff/` is a symlink to the framework root.
2. From outside a project (e.g. running a global tool): read `framework_path` from `~/.config/riff/config.yaml` (written by `/riff:onboard`).
3. Last-resort fallback for older installs: `~/DEV/frameworks/riff`.

## When project override is the right choice

- Client work with stricter risk posture than your default (`risk.sensitive_task_preference: cautious`)
- Workshop / demo: same agents, different "user" persona side by side
- Project where artifact language differs (e.g. global `en` artifacts, this project documents in `fr`)

When in doubt: keep the global default. The override is for genuinely divergent setups, not minor tweaks.

## How to create a project override

- During `/riff:init`: pick `customize for this project`
- After init: run `/riff:onboard` from the project root — it detects the project context and writes to `.planning/profile.yaml`

## How to remove a project override

Delete `.planning/profile.yaml`. The next agent run falls through to the framework default.

## Merge strategy values

`git.merge_strategy` controls what `/riff:next` Step 8 does after the PR is open. Two valid values:

- **`github_button`** (default): print the PR URL, STOP. The user clicks Merge on GitHub. Step 0 of the next run reconciles ROADMAP/STATE.
- **`local_no_ff`**: print the PR URL and stay alive. When the user says "merge", run a local `--no-ff` merge, push, update bookkeeping in the same session.

## Cross-references

- Project scope (independent of profile): `protocols/EXECUTION.md` § Project Scope
- Onboard flow: `commands/onboard.md`
- Init flow: `commands/init.md`

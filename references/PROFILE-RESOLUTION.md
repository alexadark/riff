# Profile resolution

Single rule for every RIFF agent and command that needs to read the user profile.

## Resolution order

1. `<project_root>/.planning/profile.yaml` — per-project override, if it exists
2. `<framework_root>/profile.yaml` — global default
3. Missing both → fall back to `neutre` preset (see `commands/onboard.md` § Presets)

The first existing file wins. No field-by-field merge — if the project file exists, it fully replaces the framework file for that project.

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

## Cross-references

- Project scope (independent of profile): `references/PROJECT-SCOPE.md`
- Onboard flow: `commands/onboard.md`
- Init flow: `commands/init.md`

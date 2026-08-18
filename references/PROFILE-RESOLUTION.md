# Profile resolution

Use one profile source for an invocation:

1. `<project-root>/.planning/profile.yaml`, when present.
2. `<framework-root>/profile.yaml`, when present.
3. `<framework-root>/templates/profile.default.yaml`.

The first existing file wins. This is replacement, not a field-by-field merge. A project override should therefore contain every preference it relies on; missing values use implementation safety defaults rather than inheriting from a lower source.

Resolve the framework root from `<project-root>/.riff` in an installed project. Outside a project, supply the framework root explicitly to the calling tool. Do not rely on a developer-specific filesystem path.

Profiles calibrate language, explanation depth, risk posture, notifications, and other operator preferences. `runtime.provider` also selects the installed native adapter family for the whole stage. Model and effort selection remains inside that provider's adapters.

The first profile in the resolution chain is authoritative. A missing `runtime.provider` uses the safe `codex` default. An invalid value fails before any model dispatch. A one-run `--provider codex|claude` CLI option may override the profile explicitly; RIFF records that override in the routing receipt and never falls back automatically.

Create or update a profile through the installation flow documented in `docs/RIFF-MANUAL.md`. To remove a project override, delete only `<project-root>/.planning/profile.yaml`; the next invocation will use the next source in the order above.

## Legacy Claude command workflow

Legacy command installers may expose additional profile fields or a separate onboarding command. Those fields are compatibility data and don't replace `runtime.provider` for the native stage runner.

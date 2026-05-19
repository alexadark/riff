Initialize RIFF artifacts for this project: $ARGUMENTS.

Use focused context. Create provider-neutral RIFF artifacts only.

Assume `riff init --harness commandcode` has already installed `.riff/` and the CommandCode command templates. If `.riff/` is missing, stop and ask the user to run `riff init --harness commandcode` or `riff init --harness all` from the terminal.

Read first:

- `core/schemas/phase-artifacts.md` if available
- `core/protocols/planning.md` if available
- existing `README.md`, package files, app entrypoints, and docs index

Ask or infer only what is necessary to write:

- `.planning/config.json`
- `PROJECT.md`
- `.planning/design/*.md` when architecture, data, user experience, security, or integration decisions materially affect the roadmap
- `ROADMAP.yaml`
- `STATE.md`

Required choices:

1. scope: `scratch` or `production`
2. current project stage: greenfield, starter, or brownfield
3. first useful vertical slice or first cleanup phase

Production initialization:

- include enough roadmap metadata for gates
- keep first phase small and observable
- create design docs for material architecture or risk decisions
- record security and documentation expectations

Scratch initialization:

- keep artifacts short
- omit design docs only when `PROJECT.md`, `ROADMAP.yaml`, and `STATE.md` are enough
- preserve R1-R4, no-secrets, smoke, summary, and state expectations

Do not create provider-specific core rules. Project-specific preferences belong in project docs or adapter-local notes.
Do not overwrite existing RIFF start artifacts unless the user explicitly asked for a refresh or update.

Final report:

- artifacts created or updated
- selected scope
- first phase id and title
- recommended next command

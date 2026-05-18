Initialize RIFF artifacts for this project: $ARGUMENTS.

Use focused context. Create provider-neutral RIFF artifacts only.

Read first:

- `core/schemas/phase-artifacts.md` if available
- `core/protocols/planning.md` if available
- existing `README.md`, package files, app entrypoints, and docs index

Ask or infer only what is necessary to write:

- `.planning/config.json`
- `PROJECT.md` when the repository has no equivalent project brief
- `ROADMAP.yaml`
- `STATE.md`

Required choices:

1. scope: `scratch` or `production`
2. current project stage: greenfield, starter, or brownfield
3. first useful vertical slice or first cleanup phase

Production initialization:

- include enough roadmap metadata for gates
- keep first phase small and observable
- record security and documentation expectations

Scratch initialization:

- keep artifacts short
- preserve R1-R4, no-secrets, smoke, summary, and state expectations

Do not create provider-specific core rules. Project-specific preferences belong in project docs or adapter-local notes.

Final report:

- artifacts created or updated
- selected scope
- first phase id and title
- recommended next command


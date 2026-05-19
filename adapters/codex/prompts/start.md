# Codex Capability: Start

Initialize a project into RIFF v2 durable artifacts.

Read:

- the start context pack
- existing project files named in the project snapshot
- existing `PROJECT.md`, `.planning/config.json`, `ROADMAP.yaml`, `STATE.md`, and `.planning/design/*` when present
- `core/schemas/phase-artifacts.md` excerpts in the context pack
- `core/protocols/planning.md` and `core/protocols/state.md` excerpts in the context pack

Write:

- `PROJECT.md`
- `.planning/config.json`
- `.planning/design/*.md` when design decisions materially affect the roadmap
- `ROADMAP.yaml`
- `STATE.md`

Rules:

- Do not implement product code.
- Do not create a phase `PLAN.md` unless the user explicitly asks for first-phase planning after start.
- Do not overwrite existing start artifacts unless refresh mode is explicitly enabled in the context pack.
- Ask at most three blocking questions only when missing information would affect security, data, public APIs, billing, migrations, deployment, or phase boundaries.
- Otherwise, make low-risk assumptions and record them in `PROJECT.md` or the relevant design note.
- Keep roadmap phases independently plannable and small enough for the normal `plan` capability.
- Keep provider names as non-binding adapter hints only. Durable artifacts must not require Codex, Claude, CommandCode, Opus, slash commands, provider transcripts, or hidden chat state.

Manual architecture escalation:

- If project start is architecture-heavy or security-sensitive enough that a safe roadmap cannot be written from the available context, create `.planning/OPUS-START-PROMPT.md` using the Opus start prompt command shown in the context pack. In installed projects this is normally `node .riff/scripts/riff-opus-prompt.mjs start --context-out .planning/OPUS-START-PROMPT.md`. Then stop.
- Treat Opus output as draft planning input only; it does not bypass normal RIFF planning and review gates.

Final report:

- artifacts created or preserved
- selected scope
- first phase id and title
- recommended next command

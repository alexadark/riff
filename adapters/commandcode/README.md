# CommandCode Adapter

This adapter maps RIFF core contracts to CommandCode command templates for OSS and local-model workflows.

CommandCode is an adapter target only. The source of truth remains:

- `core/protocols/adapter-contract.md`
- `core/protocols/context-budget.md`
- `core/protocols/hooks.md`
- `core/schemas/phase-artifacts.md`

The templates are intentionally short and step-oriented. Local models should receive compact context packs, concrete output paths, and conservative stop rules instead of long orchestration prompts.

## Install Into A Project

From the RIFF repository root:

```bash
mkdir -p /path/to/project/.commandcode/commands/riff
cp adapters/commandcode/commands/riff/*.md /path/to/project/.commandcode/commands/riff/
cp adapters/commandcode/settings.template.json /path/to/project/.commandcode/settings.json
```

Then edit the target project's `.commandcode/settings.json` so hook command paths match scripts that exist in that project.

Recommended target layout:

```text
.commandcode/
  commands/
    riff/
      next.md
      quick.md
      start.md
      status.md
  hooks/
    destructive-guard.sh
    boundary-check.sh
    no-secrets.sh
    smoke.sh
    docs-check.sh
  settings.json
```

The hook scripts are project-owned deterministic scripts. They should implement the environment and exit-code contract in `core/protocols/hooks.md`.

## Command Mapping

| Command template | Primary use | Core capabilities |
| --- | --- | --- |
| `riff/status` | Inspect current state and gate health | minimal context, dashboard/status evidence |
| `riff/quick` | Small bounded task | execute, smoke, no-secrets, summary note |
| `riff/start` | Initialize a project into RIFF artifacts | plan/start artifacts, state |
| `riff/next` | Run one phase through explicit gates | plan, plan-review, execute, scope-check, review gates, finalize |

`status` and `quick` are expected to be reliable before `next`. `next` should be run one gate at a time when the model is weak, the phase is production scoped, or the touched surface is security-sensitive.

## Artifact Discipline

The adapter writes the same durable files as the Codex adapter:

- `.planning/config.json`
- `ROADMAP.yaml`
- `STATE.md`
- `.planning/phases/<N-slug>/PLAN.md`
- `.planning/phases/<N-slug>/PLAN-REVIEW.md`
- `.planning/phases/<N-slug>/SUMMARY.md`
- `.planning/phases/<N-slug>/SCOPE-CHECK.json`
- `.planning/phases/<N-slug>/REVIEW.md`
- `.planning/phases/<N-slug>/SECURITY.md`
- `.planning/phases/<N-slug>/DOCS-CHECK.md`
- `.planning/phases/<N-slug>/GATES.md`
- `.planning/phases/<N-slug>/HANDOFF.md`
- `.planning/phases/<N-slug>/dashboard-metadata.json`
- `.planning/phases/<N-slug>/dashboard-explanation.json` when `dashboard-explain` is used, or an explicit `none` explanation result

Provider conversation state is not RIFF state. If CommandCode cannot complete a capability safely, it must stop with a clear handoff and leave the relevant gate pending or failed.

## Context Packs

Use the context pack layout from `core/protocols/context-budget.md`:

```text
context-pack/
  mission.md
  artifact-contract.md
  phase-snapshot.md
  relevant-files.md
  loaded-rules.md
  evidence.md
```

For CommandCode, prefer generated or hand-written packs under the active phase directory:

```text
.planning/phases/<N-slug>/context-packs/
  status.md
  quick.md
  next-plan.md
  next-execute.md
  next-review.md
```

Keep pack contents compact:

- include exact output path and blocking rules
- list full files to read instead of pasting large files
- paste short excerpts only when they are decisive
- split planning, execution, and review into separate runs for production work

## Gates

Production gates stay conservative:

1. `plan-review`
2. `execute`
3. `scope-check`
4. `code-review`
5. `security-review`
6. `docs-check`
7. `hooks`
8. `dashboard-metadata`
9. `finalize`

Scratch work may skip heavy review gates, but R1-R4, no-secrets, smoke, summary, and state evidence still apply.

## Reference Adaptations

A project-specific CommandCode setup can be explained as an instance of this adapter when it:

- installs compatible `.commandcode/commands/riff/*.md` templates
- points hooks at deterministic project scripts
- writes the standard RIFF artifacts
- keeps project-specific policy outside core contracts
- does not copy or redefine RIFF rules inside the project command templates

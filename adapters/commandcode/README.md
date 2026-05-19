# CommandCode Adapter

This adapter maps RIFF core contracts to CommandCode command templates for OSS and local-model workflows.

CommandCode is an adapter target only. The source of truth remains:

- `core/protocols/adapter-contract.md`
- `core/protocols/context-budget.md`
- `core/protocols/hooks.md`
- `core/schemas/phase-artifacts.md`

The templates are intentionally short and step-oriented. Local models should receive compact context packs, concrete output paths, and conservative stop rules instead of long orchestration prompts.

## Install Into A Project

From the target project root, prefer the harness-neutral RIFF installer:

```bash
riff init --harness commandcode
```

This creates `.riff` as the source-of-truth symlink and wires `.commandcode/commands/riff/*`, `.commandcode/hooks/*`, and `.commandcode/settings.json` through project-local symlinks.

Manual fallback from the target project root after `.riff` exists:

```bash
mkdir -p .commandcode/commands/riff .commandcode/hooks
for file in .riff/adapters/commandcode/commands/riff/*.md; do
  ln -s "../../../.riff/adapters/commandcode/commands/riff/$(basename "$file")" ".commandcode/commands/riff/$(basename "$file")"
done
ln -s "../.riff/adapters/commandcode/settings.template.json" .commandcode/settings.json
ln -s "../../.riff/hooks/destructive-guard.sh" .commandcode/hooks/destructive-guard.sh
ln -s "../../.riff/hooks/boundary-check.sh" .commandcode/hooks/boundary-check.sh
ln -s "../../.riff/hooks/examples/no-secrets.sh" .commandcode/hooks/no-secrets.sh
ln -s "../../.riff/hooks/examples/smoke.sh" .commandcode/hooks/smoke.sh
ln -s "../../.riff/hooks/examples/docs-check.sh" .commandcode/hooks/docs-check.sh
```

Then link or provide `.commandcode/hooks/*` scripts that match `.commandcode/settings.json`.

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

The installed hook scripts are deterministic RIFF scripts or examples linked through `.riff/`. A project may replace those links with project-owned scripts when it needs custom behavior; they should still implement the environment and exit-code contract in `core/protocols/hooks.md`.

## Command Mapping

| Command template | Primary use | Core capabilities |
| --- | --- | --- |
| `riff/status` | Inspect current state and gate health | minimal context, dashboard/status evidence |
| `riff/quick` | Small bounded task | execute, smoke, no-secrets, summary note |
| `riff/start` | Initialize a project into RIFF artifacts | start artifacts, roadmap, state |
| `riff/next` | Run one phase through explicit gates | plan, plan-review, execute, scope-check, review gates, finalize |

`status` and `quick` are expected to be reliable before `next`. `next` should be run one gate at a time when the model is weak, the phase is production scoped, or the touched surface is security-sensitive.

## Artifact Discipline

The adapter writes the same durable files as the Codex adapter:

- `.planning/config.json`
- `PROJECT.md`
- `.planning/design/*.md` when design decisions materially affect the roadmap
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

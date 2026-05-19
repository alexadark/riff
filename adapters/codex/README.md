# Codex Adapter MVP

This adapter maps RIFF core contracts to separate Codex-driven commands. It is intentionally manual-step oriented: one invocation prepares or runs one capability for one project start or one phase.

The adapter does not provide an unattended loop or provider-neutral core changes.

For real-project dogfood, use the operator checklist in [`docs/OPERATOR.md`](../../docs/OPERATOR.md).

## Capabilities

The adapter exposes one command per capability. Each invocation prepares or runs exactly one step; it does not chain gates into an unattended loop.

| Command | Core capability | Primary artifact |
| --- | --- | --- |
| `start` | `start` | `PROJECT.md`, `.planning/design/*` when needed, `ROADMAP.yaml`, `.planning/config.json`, and `STATE.md` |
| `plan` | `plan` | `.planning/phases/<phase>/PLAN.md` |
| `execute` | `execute` | implementation changes and `.planning/phases/<phase>/SUMMARY.md` |
| `plan-review` | `plan-review` | `.planning/phases/<phase>/PLAN-REVIEW.md` |
| `scope-check` | `scope-check` | `.planning/phases/<phase>/SCOPE-CHECK.json` |
| `review` | `code-review` alias | `.planning/phases/<phase>/REVIEW.md` |
| `code-review` | `code-review` | `.planning/phases/<phase>/REVIEW.md` |
| `security-review` | `security-review` | `.planning/phases/<phase>/SECURITY.md` |
| `docs-check` | `docs-check` | `.planning/phases/<phase>/DOCS-CHECK.md` and docs updates when needed |
| `hooks` | `hooks` | hook output and `.planning/phases/<phase>/GATES.md` |
| `dashboard-metadata` | `dashboard-metadata` | `.planning/phases/<phase>/dashboard-metadata.json` |
| `dashboard-explain` | `dashboard-explain` | dashboard explanation metadata |
| `finalize` | `finalize` | `STATE.md`, `HANDOFF.md` when needed, and final gate records |
| `status` | `status` | read-only project status and next command |
| `add-phase` | `add-phase` | `ROADMAP.yaml`, `STATE.md` when needed, and a phase directory |
| `improver` | `improver` | `.planning/expertise/.pending/*.md` proposal files + sentinel |
| `debug` | `debug` | `.planning/debug/<dated-slug>.md` (or `.planning/phases/<N-slug>/DEBUG.md` with phase context) |
| `learn-stack` | `learn-stack` | `references/taste/stacks/<stack>.md` |
| `dashboard` | `dashboard` | none (side-effect: browser opens at project kanban) |
| `quick` | `quick` | `.planning/quick/quick-NNNN.md` |
| `map` | `map` | `.planning/architecture.md`, `taste.md`, `.planning/risks.md`, `.planning/specs/*.md` |
| `loop` | `loop` | none (side-effect: runs N AFK phases autonomously via `riff-loop-codex.sh`) |

Project start happens before phase gates. Production phase path order remains `plan-review`, `execute`, `scope-check`, `code-review`, `security-review`, `docs-check`, `hooks`, `dashboard-metadata`, `dashboard-explain` when desired, then `finalize`.

Scratch path keeps R1-R4, no-secrets, smoke, summary, and state evidence while allowing heavy review gates to be marked `skipped` by scope in `GATES.md`.

## Opus Escalation

During `start`, Codex may stop before writing project artifacts when the project is architecture-heavy or sensitive. In that case it should generate an Opus prompt pack with:

```bash
node .riff/scripts/riff-opus-prompt.mjs start --context-out .planning/OPUS-START-PROMPT.md
```

During `plan`, Codex may stop before writing `PLAN.md` when the phase is architecture-heavy or sensitive. In that case it should generate an Opus prompt pack with:

```bash
node .riff/scripts/riff-opus-prompt.mjs phase-plan --phase <phase> --context-out .planning/phases/<phase>/OPUS-PHASE-PLAN-PROMPT.md
```

Then Codex asks the human to choose a path:

- Manual: paste the generated file into Opus and return the response for `PLAN.md` integration.
- Programmatic: use the Opus adapter programmatic path documented in `adapters/opus/README.md`.

The programmatic path is opt-in for that escalation. The response is draft planning input; it must be integrated into `PLAN.md` and reviewed through the normal plan-review gate before execution.

The Opus adapter enforces explicit confirmation for programmatic runs.

## Usage

Install RIFF into the target project first:

```bash
cd /path/to/project
riff init --harness codex
```

`riff init --harness codex` installs:

- `.codex/riff/README.md` and `.codex/riff/context-pack.md`
- `.agents/skills/riff-*` repo-local skills with names such as `riff:start`

Skills are discovered by Codex via the documented CWD scope (`.agents/skills`). Restart Codex after init so the active session reloads them.

The supported Codex invocation paths (from the OpenAI Agent Skills spec) are:

- Type `$riff:start` in the composer (dollar mention)
- Run `/skills` and pick `riff:start` from the picker

Codex does not document a `/<plugin>:<command>` slash syntax for user-defined plugins, so RIFF does not promise one.

Available RIFF capabilities (skill names):

```text
riff:start             <project brief>
riff:status
riff:add-phase         <phase title and goal>
riff:plan              <phase-id>
riff:plan-review       <phase-id>
riff:execute           <phase-id>
riff:scope-check       <phase-id>
riff:code-review       <phase-id>
riff:security-review   <phase-id>
riff:docs-check        <phase-id>
riff:hooks             <phase-id>
riff:dashboard-metadata <phase-id>
riff:dashboard-explain <phase-id>
riff:finalize          <phase-id>
riff:improver          [N | --all]
riff:debug             <bug description>
riff:learn-stack       <stack> [focus]
riff:dashboard         [--stop]
riff:quick             <task description>
riff:map               [directory] [--focus=area] [--quick]
riff:loop              [N]
```

### Opus Escalation — improver

The improver supports a cross-model adversarial pass via Opus. When Codex finishes the standard improver run, it may generate an Opus prompt pack for deeper synthesis:

```bash
node .riff/scripts/riff-opus-prompt.mjs improver --context-out .planning/expertise/.pending/OPUS-IMPROVER-PROMPT.md
```

Paste the generated file into Opus. The Opus response uses the same proposal format and lands in `.planning/expertise/.pending/` for human review.

Generate a prompt/context pack without running Codex:

```bash
node .riff/scripts/riff-codex.mjs start --brief "Build a production SaaS for..." --print
node .riff/scripts/riff-codex.mjs plan --phase 2-codex-adapter --print
```

Write the generated context pack to a file:

```bash
node .riff/scripts/riff-codex.mjs start --brief "..." --context-out /tmp/riff-start.md
node .riff/scripts/riff-codex.mjs execute --phase 2-codex-adapter --context-out .planning/phases/2-codex-adapter/CODEX-EXECUTE.md
```

Run one Codex command:

```bash
node .riff/scripts/riff-codex.mjs review --phase 2-codex-adapter --run
```

`--run` executes exactly one `codex exec --full-auto` call for the selected capability. It uses Codex workspace-write sandboxing so generated artifacts can be written, and it does not chain into the next gate.

Run deterministic hooks:

```bash
node .riff/scripts/riff-codex.mjs hooks --phase 2-codex-adapter --run
```

Generate deterministic dashboard metadata:

```bash
node .riff/scripts/riff-codex.mjs dashboard-metadata --phase 2-codex-adapter --run
```

## Options

| Option | Meaning |
| --- | --- |
| `--phase <id-or-path>` | Required except for `start`. Accepts `2-codex-adapter` or `.planning/phases/2-codex-adapter`. |
| `--project-root <path>` | Target project root for `start`. Defaults to the current directory. |
| `--brief <text>` | Short project-start brief included in the generated `start` context pack. |
| `--input <text>` | Free-form input for project-level commands such as `add-phase`. |
| `--scope <production|scratch>` | Overrides detected scope. Defaults to `.planning/config.json`, then `production`. |
| `--refresh` | Allows `start` to update existing start artifacts. Without this, existing artifacts are preserved by default. |
| `--print` | Print the generated context pack. This is the default when neither `--run` nor `--context-out` is set. |
| `--context-out <path>` | Write the generated context pack to a file. |
| `--run` | Run one Codex execution using the generated context pack. |
| `--codex-bin <name>` | Override the Codex executable. Defaults to `CODEX_BIN`, then `codex`. |

When running from the RIFF framework repo for adapter development, use `node scripts/riff-codex.mjs ...`. In target projects, prefer `node .riff/scripts/riff-codex.mjs ...` so the project root remains the command cwd.

## Artifact Discipline

The adapter prompts require normal RIFF artifacts from `core/schemas/phase-artifacts.md`. Provider-specific conversation state is not durable state.

For production phases, treat missing required gates as pending until they are explicitly run or documented as skipped in `GATES.md`.

Dashboard rendering reads `dashboard-metadata.json` and `GATES.md`; it does not require `claude --print`, provider transcripts, or optional explanation text.

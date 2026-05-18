# Codex Adapter MVP

This adapter maps RIFF core contracts to separate Codex-driven commands. It is intentionally manual-step oriented: one invocation prepares or runs one capability for one phase.

The adapter does not provide an unattended loop, finalizer, or provider-neutral core changes.

## Capabilities

Phase 2 includes:

| Command | Core capability | Primary artifact |
| --- | --- | --- |
| `plan` | `plan` | `.planning/phases/<phase>/PLAN.md` |
| `execute` | `execute` | implementation changes and `.planning/phases/<phase>/SUMMARY.md` |
| `plan-review` | `plan-review` | `.planning/phases/<phase>/PLAN-REVIEW.md` |
| `review` | `code-review` alias | `.planning/phases/<phase>/REVIEW.md` |
| `code-review` | `code-review` | `.planning/phases/<phase>/REVIEW.md` |
| `security-review` | `security-review` | `.planning/phases/<phase>/SECURITY.md` |
| `docs-check` | `docs-check` | docs updates or a docs gate entry |
| `dashboard-explain` | `dashboard-explain` | dashboard explanation metadata |

Scope check and finalization remain separate later capabilities. This MVP can still mention those gates in generated context so the user can run them manually when required.

## Usage

Generate a prompt/context pack without running Codex:

```bash
node scripts/riff-codex.mjs plan --phase 2-codex-adapter --print
```

Write the generated context pack to a file:

```bash
node scripts/riff-codex.mjs execute --phase 2-codex-adapter --context-out .planning/phases/2-codex-adapter/CODEX-EXECUTE.md
```

Run one Codex command:

```bash
node scripts/riff-codex.mjs review --phase 2-codex-adapter --run
```

`--run` executes exactly one `codex exec` call for the selected capability. It does not chain into the next gate.

## Options

| Option | Meaning |
| --- | --- |
| `--phase <id-or-path>` | Required. Accepts `2-codex-adapter` or `.planning/phases/2-codex-adapter`. |
| `--scope <production|scratch>` | Overrides detected scope. Defaults to `.planning/config.json`, then `production`. |
| `--print` | Print the generated context pack. This is the default when neither `--run` nor `--context-out` is set. |
| `--context-out <path>` | Write the generated context pack to a file. |
| `--run` | Run one Codex execution using the generated context pack. |
| `--codex-bin <name>` | Override the Codex executable. Defaults to `CODEX_BIN`, then `codex`. |

## Artifact Discipline

The adapter prompts require normal RIFF artifacts from `core/schemas/phase-artifacts.md`. Provider-specific conversation state is not durable state.

For production phases, treat missing required gates as pending until they are explicitly run or documented as skipped in `GATES.md`.


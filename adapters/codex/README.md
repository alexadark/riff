# Codex Adapter MVP

This adapter maps RIFF core contracts to separate Codex-driven commands. It is intentionally manual-step oriented: one invocation prepares or runs one capability for one phase.

The adapter does not provide an unattended loop, finalizer, or provider-neutral core changes.

## Capabilities

The adapter exposes one command per capability. Each invocation prepares or runs exactly one step; it does not chain gates into an unattended loop.

| Command | Core capability | Primary artifact |
| --- | --- | --- |
| `plan` | `plan` | `.planning/phases/<phase>/PLAN.md` |
| `execute` | `execute` | implementation changes and `.planning/phases/<phase>/SUMMARY.md` |
| `plan-review` | `plan-review` | `.planning/phases/<phase>/PLAN-REVIEW.md` |
| `scope-check` | `scope-check` | `.planning/phases/<phase>/SCOPE-CHECK.json` |
| `review` | `code-review` alias | `.planning/phases/<phase>/REVIEW.md` |
| `code-review` | `code-review` | `.planning/phases/<phase>/REVIEW.md` |
| `security-review` | `security-review` | `.planning/phases/<phase>/SECURITY.md` |
| `docs-check` | `docs-check` | docs updates or a docs gate entry |
| `hooks` | `hooks` | hook output and `.planning/phases/<phase>/GATES.md` |
| `dashboard-metadata` | `dashboard-metadata` | `.planning/phases/<phase>/dashboard-metadata.json` |
| `dashboard-explain` | `dashboard-explain` | dashboard explanation metadata |
| `finalize` | `finalize` | `STATE.md`, `HANDOFF.md` when needed, and final gate records |

Production path order: `plan-review`, `execute`, `scope-check`, `code-review`, `security-review`, `docs-check`, `hooks`, `dashboard-metadata`, `dashboard-explain` when desired, then `finalize`.

Scratch path keeps R1-R4, no-secrets, smoke, summary, and state evidence while allowing heavy review gates to be marked `skipped` by scope in `GATES.md`.

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

Run deterministic hooks:

```bash
node scripts/riff-codex.mjs hooks --phase 2-codex-adapter --run
```

Generate deterministic dashboard metadata:

```bash
node scripts/riff-codex.mjs dashboard-metadata --phase 2-codex-adapter --run
```

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

Dashboard rendering reads `dashboard-metadata.json` and `GATES.md`; it does not require `claude --print`, provider transcripts, or optional explanation text.

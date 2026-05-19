# Adapter Contract

An adapter maps RIFF core contracts onto a specific tool, model, script, or manual workflow. Core defines required artifacts and gate semantics; adapters define how to produce them.

Adapters must not fork the core rules. If a provider cannot support a full gate directly, the adapter must document the limitation and provide a manual or scripted fallback.

## Required Capabilities

Project initialization adapters may expose `start` to create the initial RIFF project artifacts before phase execution begins.

Full execution adapters should expose these capabilities:

| Capability | Required output |
| --- | --- |
| `start` | `PROJECT.md`, `.planning/design/*` when needed, `ROADMAP.yaml`, `.planning/config.json`, and `STATE.md` |
| `plan` | `.planning/phases/<N-slug>/PLAN.md` |
| `plan-review` | `.planning/phases/<N-slug>/PLAN-REVIEW.md` |
| `execute` | implementation changes and `.planning/phases/<N-slug>/SUMMARY.md` |
| `scope-check` | `.planning/phases/<N-slug>/SCOPE-CHECK.json` in production |
| `code-review` | `.planning/phases/<N-slug>/REVIEW.md` |
| `security-review` | `.planning/phases/<N-slug>/SECURITY.md` |
| `docs-check` | docs updates or documented docs gate result |
| `hooks` | hook result entries in `.planning/phases/<N-slug>/GATES.md` |
| `dashboard-metadata` | `.planning/phases/<N-slug>/dashboard-metadata.json` |
| `dashboard-explain` | optional dashboard explanation metadata, or explicit `none` |
| `finalize` | updated `STATE.md`, gate records, and final readiness status |
| `escalation-prompt` | paste-ready prompt or handoff for a stronger/manual reviewer |

Adapters may name the escalation capability `opus-prompt` when the target workflow is specifically an Opus prompt pack. Core treats it as an escalation prompt, not as a required executor.

## Capability Semantics

`start`:

- discovers or accepts the project brief and scope
- writes provider-neutral start artifacts that satisfy `core/schemas/phase-artifacts.md`
- creates a roadmap with independently plannable phases
- creates state that names the first safe next action
- may request an escalation prompt for high-risk architecture discovery, but does not require any provider-specific workflow in durable artifacts

`plan`:

- selects or accepts a phase
- reads the planning context pack
- writes a plan that satisfies `core/protocols/planning.md`

`plan-review`:

- reads the plan and relevant context
- writes a verdict using the review contract
- blocks execution on unresolved blockers

`execute`:

- follows the plan boundaries
- applies R1-R4
- runs smoke commands
- writes truthful summary evidence

`scope-check`:

- compares plan, diff, and summary
- detects dropped scope and boundary violations
- writes structured JSON in production

`code-review`:

- checks the diff for behavioral defects
- writes ordered findings and a verdict

`security-review`:

- checks sensitive surfaces and no-secrets requirements
- applies blocking severity rules from the review protocol

`docs-check`:

- decides whether docs changed or should change
- updates docs or records a blocking/stale/skip result

`hooks`:

- executes configured provider-neutral hook scripts
- records hook command, status, exit code, and output artifacts in `GATES.md`
- blocks only according to the hook and scope contracts

`dashboard-metadata`:

- builds structured dashboard data from durable artifacts
- does not require an LLM or provider renderer
- records metadata freshness in `GATES.md`

`dashboard-explain`:

- reads structured artifacts
- writes concise explanation metadata
- does not become the source of truth for phase state

`finalize`:

- verifies required gates are resolved
- updates state artifacts
- reports whether the phase is ready to merge, continue, or stop

`escalation-prompt`:

- packages compact context for manual or higher-capability review
- names the expected output path and artifact contract
- does not bypass core gates

## Adapter Types

Default scriptable adapters can implement the full capability set.

Future CommandCode adapters should implement the same capability names with compact prompts and aggressive context packs suitable for OSS or local models. CommandCode is an adapter target, not a core requirement.

Manual escalation adapters may implement only `escalation-prompt` or `opus-prompt`. They are valid for planning and review assistance but are not full executors unless they also satisfy the execution, gate, and state capabilities.

Legacy adapters may document an existing provider-specific workflow. They must reference the core contracts instead of duplicating them.

## Provider Neutrality Rules

Core artifacts must not require provider command syntax, provider-only tools, or provider-specific conversation features.

Adapters may include provider-specific command examples inside their own directories. If an adapter needs a provider-only feature, it must translate the result back into the standard RIFF artifacts.

## Context Pack Requirement

Every adapter capability should accept or create a context pack matching `core/protocols/context-budget.md`.

The adapter must state:

- loading tier used
- source artifacts included
- files read in full
- rules loaded
- output path

This keeps work resumable across tools and reviewable by humans.

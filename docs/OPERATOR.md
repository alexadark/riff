# RIFF Operator Guide

This guide is for dogfooding the current RIFF v2 bootstrap and Codex adapter before the loop work is stable.

## Current Status

Use the Phase 8 branch for real-project testing:

```bash
cd /Users/webstantly/DEV/frameworks/riff
git switch codex/riff-v2-phase-8-codex-commands
```

The branch is usable for:

- installing RIFF into a project with the terminal `riff init` command
- starting a scratch or production project with Codex
- running RIFF from Codex slash commands or one Codex capability at a time
- validating docs, hooks, dashboard metadata, and finalization artifacts manually

The branch is not the right target for:

- unattended `/riff:loop`
- assuming the Codex adapter will chain gates automatically
- treating provider-specific chat history as durable RIFF state

## Testing A Project With Codex

From the target project:

```bash
cd /path/to/project
/Users/webstantly/DEV/frameworks/riff/riff init --harness codex --scope production
```

Plain `riff init` installs all harnesses. Use `riff init codex` or `--harness codex` when you only want `.codex/riff` and do not want `.claude` commands or agents.

Terminal init continues into profile onboarding when the terminal is interactive. Use `--profile alex`, `--profile custom`, or `--no-onboard` for scripted runs.

Codex init installs repo-local RIFF skills under the documented Codex discovery path:

- `.agents/skills/riff-*` skills with names such as `riff:start`

Restart Codex after init so the active session reloads the skills. Invoke them via the documented Codex paths (the OpenAI Agent Skills spec does not define a `/<plugin>:<command>` syntax, so RIFF does not use one):

- Type `$riff:start` in the composer to mention the skill
- Or run `/skills` and pick `riff:start` from the picker

```text
$riff:start            <project brief>
$riff:status
$riff:plan             <phase-id>
$riff:plan-review      <phase-id>
$riff:execute          <phase-id>
$riff:scope-check      <phase-id>
$riff:code-review      <phase-id>
$riff:security-review  <phase-id>
$riff:docs-check       <phase-id>
$riff:hooks            <phase-id>
$riff:dashboard-metadata <phase-id>
$riff:dashboard-explain <phase-id>
$riff:finalize         <phase-id>
$riff:add-phase        <phase title and goal>
```

For a disposable prototype:

```bash
/Users/webstantly/DEV/frameworks/riff/riff init --harness codex --scope scratch
```

After init, the slash command wrapper is preferred. The underlying terminal path remains available for debugging:

```bash
node .riff/scripts/riff-codex.mjs start --run --brief "Describe the project goal, users, stack, and constraints."
```

For an existing RIFF project that already has start artifacts, generate context first:

```bash
node .riff/scripts/riff-codex.mjs start --brief "Refresh planning context only." --print
```

Use `--refresh` only when existing `PROJECT.md`, `ROADMAP.yaml`, `STATE.md`, or `.planning/config.json` should be updated.

## Production Vs Scratch

Production scope should preserve enough artifact quality for later maintenance:

- `PROJECT.md`
- `.planning/config.json`
- `.planning/design/*.md` when architecture, data, user experience, security, or integration choices materially affect the roadmap
- `ROADMAP.yaml`
- `STATE.md`

Scratch scope can be lighter:

- design docs may be omitted when core artifacts are enough
- heavy review gates may be skipped by scope with a recorded reason
- R1-R4, no-secrets, smoke, summary, and state evidence still matter

## Running One Phase Manually

Pick the next phase from `ROADMAP.yaml`, then run one capability at a time:

```bash
node .riff/scripts/riff-codex.mjs plan --phase <phase-id> --run
node .riff/scripts/riff-codex.mjs plan-review --phase <phase-id> --run
node .riff/scripts/riff-codex.mjs execute --phase <phase-id> --run
node .riff/scripts/riff-codex.mjs scope-check --phase <phase-id> --run
node .riff/scripts/riff-codex.mjs code-review --phase <phase-id> --run
node .riff/scripts/riff-codex.mjs security-review --phase <phase-id> --run
node .riff/scripts/riff-codex.mjs docs-check --phase <phase-id> --run
node .riff/scripts/riff-codex.mjs hooks --phase <phase-id> --run
node .riff/scripts/riff-codex.mjs dashboard-metadata --phase <phase-id> --run
node .riff/scripts/riff-codex.mjs finalize --phase <phase-id> --run
```

In Codex, prefer the equivalent `riff:<command>` skill through `/riff:<command> <phase-id>` when available, or `/skills` / `$riff:<command>` when direct custom slash entries are not exposed by the installed Codex build.

Do not run these as a blind script during dogfood. The point of Phase 8 is to find where the manual Codex path is unclear, brittle, or missing documentation.

## What To Record During Dogfood

For every project tested, record:

- project path and scope
- init command used
- start command used
- artifacts created
- any missing or confusing docs
- any command that failed
- any place where Codex needed context that RIFF did not provide
- whether the next command was obvious from the final report

Use a local note, issue, or PR comment. Do not commit generated target-project artifacts back into the RIFF framework repo.

## Phase 8 Scope

Phase 8 should be a dogfood and documentation stabilization phase, not loop implementation.

Recommended Phase 8 work:

- run `riff init --harness codex` and `start --run` on at least one scratch project and one production-style project
- verify `riff:start` and the phase wrappers appear in Codex after restart, either as `/riff:*` slash entries or through `/skills` / `$riff:*`
- tighten this operator guide based on real failures
- improve quickstart docs when commands are unclear
- add troubleshooting for common init, symlink, Codex binary, scope, and artifact validation failures
- confirm `outputs/` and other generated local artifacts stay outside framework commits
- collect open issues for the later loop phase

Out of scope for Phase 8:

- unattended loop behavior
- CommandCode timeout work
- new provider-specific durable artifacts
- Phase 5.1 changes

## Troubleshooting

If `riff` is not found, call it by absolute path from the framework checkout:

```bash
/Users/webstantly/DEV/frameworks/riff/riff init --harness codex
```

If `codex` is not the executable name:

```bash
node .riff/scripts/riff-codex.mjs start --run --codex-bin /path/to/codex
```

If start fails after Codex exits successfully, check for the core artifacts:

```bash
ls PROJECT.md ROADMAP.yaml STATE.md .planning/config.json
```

Missing `.planning/design/*.md` should not fail start by itself. Design docs are required only when material design decisions affect the roadmap.

If a target project produces bulky generated outputs, keep them in the target project or a local ignored directory. Do not add generated outputs to the RIFF framework repo unless they are deliberate fixtures.

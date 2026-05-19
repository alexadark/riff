# Opus Escalation Adapter

This adapter provides paste-ready prompts for rare, high-leverage planning work. It defaults to manual paste, with an explicit opt-in path for sending the generated prompt through the local Claude Code CLI using `claude -p --model opus`.

## Capabilities

| Command | Core capability | Expected result |
| --- | --- | --- |
| `start` | `opus-prompt` / `escalation-prompt` | project-start architecture and roadmap guidance, plus a `PLAN.md`-compatible first phase when requested |
| `phase-plan` | `opus-prompt` / `escalation-prompt` | `.planning/phases/<phase>/PLAN.md`-compatible plan content |
| `architecture-review` | `opus-prompt` / `escalation-prompt` | `.planning/phases/<phase>/ARCHITECTURE-REVIEW.md` manual review content and `PLAN.md`-compatible revision guidance |

Use this adapter when a phase is unusually consequential: greenfield product architecture, cross-module contracts, auth, payments, public APIs, data model changes, migrations, security-critical planning, P0 work, a module with no prior `SUMMARY.md`, at least two `REVISE` or `FAIL` plan-review verdicts on the same phase, or a resolved R3 architecture decision.

## Usage

Generate a project-start prompt:

```bash
node .riff/scripts/riff-opus-prompt.mjs start --print
```

Generate a prompt for one critical phase:

```bash
node .riff/scripts/riff-opus-prompt.mjs phase-plan --phase 6-opus-planning-prompts --print
```

Write a prompt pack to a file for manual paste:

```bash
node .riff/scripts/riff-opus-prompt.mjs architecture-review --phase 6-opus-planning-prompts --context-out .planning/phases/6-opus-planning-prompts/OPUS-ARCHITECTURE-PROMPT.md
```

Generate and run through local Claude Code Opus:

```bash
node .riff/scripts/riff-opus-prompt.mjs phase-plan --phase 6-opus-planning-prompts --context-out .planning/phases/6-opus-planning-prompts/OPUS-PHASE-PLAN-PROMPT.md --run-claude --yes --response-out .planning/phases/6-opus-planning-prompts/OPUS-PHASE-PLAN-RESPONSE.md
```

## Workflow

1. Generate the prompt pack.
2. Choose manual paste or explicit programmatic run.
3. Save the Opus result as draft planning or review input.
4. Integrate the draft into the expected RIFF artifact, such as `PLAN.md` or `ARCHITECTURE-REVIEW.md`.
5. Run the normal RIFF gates. Opus output does not bypass plan review, scope check, code review, security review, docs check, hooks, dashboard metadata, or finalization.

Generated prompt and response files may be kept as phase evidence when useful, but they are not durable source-of-truth artifacts unless the phase plan explicitly lists them.

`scripts/riff-opus-prompt.mjs` stays at the repo-level `scripts/` path and is normally reached from installed projects through `.riff/scripts/riff-opus-prompt.mjs`. It reads RIFF core contracts from the framework root and reads/writes project artifacts from the project root. Use `--project-root <path>` when invoking it from outside the target project. The Opus adapter owns the provider-specific programmatic path and documents it here.

The programmatic path requires explicit confirmation with `--yes` or `RIFF_OPUS_ALLOW_PROGRAMMATIC=1`.

## Context Discipline

The generated prompt packs include compact excerpts from durable RIFF artifacts and point to the core contracts they follow. They do not include provider transcripts, hidden conversation state, or broad repository dumps.

Opus may be named as a non-binding adapter hint in a plan. Core contracts and durable artifacts must remain provider-neutral.

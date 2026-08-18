---
name: next
description: >-
  Bootstrap and run the next RIFF stage from a project Git root. Use when the
  user asks to run RIFF next, continue the RIFF roadmap, or build the next phase.
---

# RIFF Next

Run the deterministic RIFF stage runner from the project that invoked this skill. The active RIFF profile selects the native provider.

## Inputs

Resolve the runner inputs before invoking it.

1. Accept explicit `--phase <id>` and `--task <description>` values from the invocation.
2. If `--phase` is absent, derive the phase only from an explicit phase identifier or path in the user request or current invocation context.
3. If `--task` is absent, use the user's exact bounded request text, without summarizing, expanding, or inventing it.
4. Ask the user for any missing or ambiguous phase or task value. Do not invoke the runner until both values are explicit.

Never infer a phase from the roadmap, repository state, or an unstated meaning of the request.

Read no provider from conversation unless the user explicitly supplies `--provider codex` or `--provider claude`. Normal invocations use `runtime.provider` from the active RIFF profile.

## Bootstrap

1. Resolve the Git root once with `git rev-parse --show-toplevel`. Stop when the command fails.
2. Require the `<git-root>/.riff` symlink. Resolve its realpath once.
   Stop when it is missing, non-absolute, or not an existing framework directory.
   Stop when Git `HEAD` cannot be resolved.
3. Resolve `<framework-root>/riff` once.
   Stop when it is missing, not executable, or outside the framework root.
4. Invoke `<framework-root>/riff next --project-root <git-root> --phase <phase-id> --task <exact-bounded-request>`.
   Pass these explicit arguments even when they came from the current invocation context.
   Pass `--provider` only when the user supplied that explicit one-run override.
5. Return the runner result without changing its stage, model, or skill selection.

The framework CLI delegates this operation to `scripts/riff-next.mjs`; never
invoke a consumer-project copy or a legacy command implementation instead.

The runner owns stage ordering and transition gates. This skill never substitutes a model or skill.
The framework root may be external to the consumer Git root.
Every writable project or artifact target must resolve beneath the consumer Git root.
Planned smoke commands run through the isolated mechanical sandbox helper inside writable disposable clones. They never run in the canonical staged workspace. In the current slice, both model providers require the Codex CLI for this mechanical sandbox helper; selecting Claude doesn't dispatch Codex models.

User confirmation remains required before promotion.

## Native stage boundary

The stage runs `controller -> direct Codex plan or explicit provider planning -> planning evidence -> ordered worker waves -> mechanical gates -> fresh code reviewer`.
The direct path is available only when the roadmap wave supplies a strict
execution contract and routine Codex control accepts it without constraints.
Claude always retains planner and fresh plan-review dispatches. Inside each
validated wave, path-disjoint tasks use separate isolated workers concurrently
up to `wave.parallel_workers`; waves themselves remain ordered.
Workers don't execute PLAN smoke entries in the canonical staged workspace. The runner executes them after all normal waves in disposable clones. Normal wave retries are absent. One bounded full-plan worker repair is allowed only after the first final smoke failure.
PR/merge, promotion, and deep audit remain outside this slice.

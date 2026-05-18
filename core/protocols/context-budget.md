# Context Budget Protocol

This protocol keeps RIFF usable across providers with different context windows and interaction styles.

## Principle

Load the smallest context that can satisfy the current step safely. Large context is a risk when it hides the important files, increases cost, or encourages stale assumptions.

Core contracts define what must be known. Adapters decide how to package and deliver that context.

## Context Pack Layout

Each major step should be able to run from a compact context pack:

```text
context-pack/
  mission.md
  artifact-contract.md
  phase-snapshot.md
  relevant-files.md
  loaded-rules.md
  evidence.md
```

`mission.md` states the step goal and stopping rules.

`artifact-contract.md` names the output file and required sections.

`phase-snapshot.md` contains the relevant roadmap entry, active `STATE.md` excerpt, and scope.

`relevant-files.md` lists files to read and why. It may include summaries, but full file contents should be loaded only when needed.

`loaded-rules.md` lists core, stack, and project rules selected for the step.

`evidence.md` contains command outputs, diff summaries, or prior gate results when the step evaluates evidence.

## Loading Tiers

| Tier | Contents | Use |
| --- | --- | --- |
| Minimal | mission, artifact contract, phase snapshot | status, dashboard metadata, simple finalization |
| Focused | minimal plus relevant rules and file summaries | normal planning, execution, documentation checks |
| Expanded | focused plus selected full files and prior artifacts | architecture, security, migrations, complex debugging |

No step should load every protocol, role, prior summary, and source file by default.

## Step Budgets

Planning:

- focused by default
- expanded for architecture, security-critical, migration, or cross-module work
- must include files the planner expects to place in task boundaries

Execution:

- focused plus full contents of task boundary files
- include exact rules for touched surfaces
- include prior handoff only when the plan depends on it

Plan review:

- focused on `PLAN.md`, roadmap entry, and relevant architecture or security rules
- expanded only when the plan makes architecture claims

Code review:

- focused on diff, `PLAN.md`, `SUMMARY.md`, smoke results, and touched-surface rules
- expanded for shared helpers, public APIs, data access, or concurrency

Security review:

- expanded for sensitive surfaces
- include auth, authorization, data model, secret handling, migration, or external boundary files as relevant

Documentation check:

- focused on changed file list, `SUMMARY.md`, docs index, and public interfaces

Dashboard explanation:

- minimal by default
- use phase metadata, plan summary, gate status, and final summary
- do not load implementation files unless the dashboard must explain a specific risk

## Rule Loading

Rules should be selected by relevance:

- always load small core invariants
- load path-specific rules only when matching files are touched
- load stack rules only for the active stack
- load adapter rules only inside that adapter
- load project taste or conventions only when they affect the current files

When no path pattern exists for a behavioral preference, store detailed guidance in docs and keep the always-loaded rule as a short pointer.

## Context Failure Handling

If a step cannot fit necessary context:

- reduce summaries first
- split the step by task or gate
- ask for a human decision if safety depends on missing context
- record the limitation in the output artifact

Do not proceed by guessing about unread security-sensitive or architecture-sensitive files.


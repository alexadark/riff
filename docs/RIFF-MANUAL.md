# RIFF manual

RIFF is a provider-native stage runner for one bounded change at a time. It runs the same stage contract through native Codex or Claude Code adapters selected by the active profile.

This manual describes the active native slice. Historical commands and protocols may still exist in the repository. They aren't part of `$riff:next` unless an active skill or protocol names them.

## Start here

Install RIFF into a normal Git checkout. The checkout must have a resolvable `HEAD`.

```bash
cd /path/to/project
/path/to/riff/riff init --no-onboard
```

This creates or preserves:

- `.riff`, a symlink to the framework root.
- `.planning/`, including the native phase artifact directories.
- Claude runtime links under `.claude/`.
- Codex project-local skills under `.agents/skills/`.
- Materialized Codex runtime adapters under `.codex/agents/`.

Run `riff resync` after RIFF adds or removes active skills or adapters. It reconciles RIFF-owned links and preserves unowned collisions. The same operation is exposed as `$resync` in a project-local Codex installation, `$riff:resync` in the namespaced plugin, and `/riff:resync` in Claude Code.

`riff init` does not support Git linked worktrees. Use a normal checkout for installation. Production model and smoke dispatches require Darwin. The runner fails closed elsewhere because its required read-deny sandbox enforcement isn't trusted there.

Choose the native model provider in the first active profile from the normal project, framework, and default resolution chain:

```yaml
runtime:
  provider: codex # or claude
```

A project `.planning/profile.yaml` overrides the framework profile as a whole. Missing `runtime.provider` defaults to `codex`; an unsupported value fails before dispatch. RIFF records the selection and never switches or falls back during a stage.

## Start, map, and manage a project

After `riff init`, restart the agent session if it needs to discover new local
skills. Invoke skills explicitly.

| Intent | Project skill | Result |
| --- | --- | --- |
| Greenfield discovery | `$start` or `$riff:start` | `PROJECT.md`, applicable design records, a validated `ROADMAP.yaml`, and bootstrap state. |
| Brownfield onboarding | `$map` or `$riff:map` | Architecture, risks, project facts, conventions, module specifications, and optional UX flows without product edits. |
| Roadmap management | `$phase` or `$riff:phase` | Lists, adds, or updates phases through the validated CLI. |
| Authoritative progress | `$status` or `$riff:status` | Roadmap progress, active wave, latest native stage, human boundaries, and next action. |
| Local dashboard | `$dashboard` or `$riff:dashboard` | Starts or attaches to the read-only project dashboard. |

Claude Code retains `/riff:start`, `/riff:map`, `/riff:add-phase`,
`/riff:status`, and `/riff:dashboard`. Resync also exposes the shared skills to
Claude. Terminal equivalents for deterministic operations are:

```bash
./.riff/riff phase list
./.riff/riff phase add --title "Phase title" --goal "Observable goal" \
  --task "First bounded task" --depends-on 1
./.riff/riff phase set-status --id 2 --status blocked
./.riff/riff status
./.riff/riff status --json
./.riff/riff dashboard
```

`riff phase` validates the entire roadmap and rolls back an invalid edit. It
never renumbers phases. `riff status` treats `ROADMAP.yaml` and persisted runner
state as authoritative rather than relying on conversation history.

## Invoke a stage

Every native run needs two explicit values:

- A safe phase identifier.
- The exact bounded task request.

After project installation, use the project-local Codex skill when operating from Codex:

```text
$next --phase <id> --task "<bounded request>"
```

Use `$riff:next` when RIFF is installed as a namespaced Codex plugin. `$next` and `$riff:next` are the same capability exposed through different installation layouts. Don't assume one name works in the other's layout.

The provider-neutral terminal entry point is:

```bash
./.riff/riff next \
  --project-root "$(git rev-parse --show-toplevel)" \
  --phase <id> \
  --task "<bounded request>"
```

The task must name the intended product behavior, permitted files or surfaces, exclusions, and relevant checks. For a rebrand, first save the approved reference, tokens, assets, and preservation constraints in the project. Then ask for a bounded foundation phase rather than a whole-site rewrite.

RIFF doesn't infer phase or task values from a roadmap. It doesn't implicitly resume an interrupted stage. A state file is evidence of a prior attempt, not permission to continue it. Start a new invocation only with explicit inputs.

## Autonomous roadmap waves and loops

Roadmap waves sit above the single-stage runner. They aren't the numbered
worker waves inside one `PLAN.md`.

```bash
# Run the currently ready dependency frontier.
./.riff/riff wave --autonomous

# Keep recomputing ready work until the roadmap is dry or RIFF reaches a real stop.
./.riff/riff wave --autonomous --loop

# Resume the active persisted run after an interruption.
./.riff/riff wave --resume

# Inspect the active run without changing it.
./.riff/riff wave --status
```

Use `$wave` or `$riff:wave` in Codex. Use `/riff:wave --autonomous --loop` in
Claude Code. Both are thin adapters over the same CLI and the same
`runtime.provider` selection.

The engine reads `ROADMAP.yaml`, selects ready phases, respects `depends_on`,
and runs native `riff next` once per phase. It persists run, frontier, phase,
attempt, and resume state under `.planning/riff-wave/`. An interrupted phase is
reconciled when it completed before the interruption. A failed attempt is
replayed with a distinct native phase identifier only when it stopped before
product promotion. Post-promotion failures remain blocked for inspection.

Ordinary and security-sensitive implementation doesn't pause the loop.
Security hooks run once after product phases. Explicit visual or functional
human verification, destructive boundaries, promotion, a blocking failure, or
an operator cap stops execution. Waves never commit, merge, deploy, or promote.

## What `$riff:next` does

The runner owns the stage order:

1. **Preflight** validates the Git root, `.riff` symlink, framework path, `HEAD`, lock, and writable artifact boundaries.
2. **Controller** classifies the request and selects declared runtime route classes.
3. **Planner** returns an executable `PLAN.md` with task ownership, numbered waves, boundaries, and structured smoke commands.
4. **Plan validation** rejects malformed ownership, unsafe paths, invalid smoke commands, identity mismatches, and untrusted prompt-injection patterns.
5. **Fresh plan review** independently returns `PROCEED` or `REVISE` from a read-only evidence snapshot.
6. **Sequential worker waves** run autonomously in plan order. Each worker receives only its wave assignments and owned paths.
7. **Mechanical gates** run declared smokes, validate the summary, and scope-check actual changes.
8. **Fresh code review** independently returns `PASS` or `FAIL` from a separate read-only evidence snapshot.
9. **Repeated mechanics** confirm review didn't alter the project, then persist `completed` only after every preceding transition passed.

The runner stages product work outside the consumer workspace. It compares snapshots before and after every wave. A wave must modify a product file in its own boundary. It rejects incremental changes outside the wave boundary.

There are no normal worker retries. Workers don't execute PLAN smoke entries inside the canonical staged workspace. RIFF runs those commands after all normal waves in disposable clones, then permits one bounded full-plan repair only after the first final smoke failure. Plan review, mechanics, scope check, and code review happen once after normal waves, not once per wave.

## Roles and adapters

RIFF has seven semantic roles.

| Role | Shared responsibility | Native adapter behavior |
| --- | --- | --- |
| Planner | Creates bounded tasks, ownership, waves, and smokes. | Returns `PLAN.md` content from a read-only snapshot. |
| Worker | Implements `implement`, `fix`, or `simplify` assignments. | Receives a staged workspace and emits summary content. |
| Reviewer | Reviews plan, code, architecture, roadmap, incident, or milestone evidence. | Uses a fresh read-only snapshot. |
| Debugger | Diagnoses a failure and produces a bounded fix assignment. | Returns report content only. |
| Security reviewer | Evaluates reachable security defects. | Returns report content only. |
| Red teamer | Tests bounded attack proofs against approved non-production targets. | Is repository-read-only and report-only. |
| Load tester | Assesses scale behavior statically or against an approved non-production target. | Is repository-read-only and report-only. |

The controller is a native stage control adapter. It is not an eighth shared semantic role.

Shared role specifications are in [../agents/roles](../agents/roles). They don't contain provider, model, effort, tool, permission, or delegation selection. Codex adapters in [../agents/codex](../agents/codex) own the Codex settings. Native Claude variants declared by [../agents/claude.yaml](../agents/claude.yaml) own the Claude settings without redefining role behavior. The same file retains historical Claude aliases for compatibility.

`simplify` is a worker assignment. `improve` is a skill. `scope-checker` was removed as an agent because [../scripts/scope-check.mjs](../scripts/scope-check.mjs) performs the deterministic control.

## Provider selection and adaptive routing

`runtime.provider` selects one adapter family for the whole stage. An explicit `--provider codex|claude` option may override the profile for one run; the routing receipt records the override. RIFF never uses provider fallback.

The Codex route portfolio is:

| Class | Model and effort | When selected |
| --- | --- | --- |
| Routine controller, planner, reviewer | Sol, Medium | Default routine stage work. |
| Architecture controller and planner | Sol, XHigh | Canonical architecture classification. |
| Critical reviewer | Sol, XHigh | Architecture or critical classification. |
| Repeatable worker | Luna, XHigh, Fast | Default mutation work. |
| Bounded worker | Terra, High | Bounded multi-file execution selected by canonical classification. |
| Inventory worker | Luna, Low, Fast | Declared for future callers, unavailable to mutation-only next. |
| Escalation reviewer | Sol, Max | Reserved after a recorded XHigh technical or contract failure. |

The controller first runs as routine. If it classifies planning as architecture or review as critical, RIFF runs one fresh architecture-controller confirmation. That result is canonical. It selects the planner, worker, plan reviewer, and code reviewer classes.

Claude uses the same classes with explicit native adapters:

| Class | Claude model and effort |
| --- | --- |
| Routine controller | Sonnet, Medium |
| Architecture controller and planner | Opus, XHigh |
| Routine planner and reviewer | Sonnet, High |
| Repeatable or bounded worker | Sonnet, High |
| Inventory worker | Sonnet, Low |
| Critical reviewer and specialist roles | Opus, XHigh |
| Escalation reviewer | Opus, Max |
| Load tester | Sonnet, High |

Claude sessions are fresh and non-persistent. They ignore project customization, expose a closed tool list, never expose Bash or nested agents to workers, and use the same staged-workspace, delta, promotion, evidence, and fresh-review gates. Planned smoke commands remain runner-owned; in this release they use the Codex CLI only as the mechanical sandbox helper even when Claude is the selected model provider.

Every Luna runtime adapter uses the Fast service tier while preserving its declared reasoning effort. Fast reduces latency but consumes more plan usage than the standard tier. The native stage runner never selects a reserved escalation, inventory, fallback, or unlisted class.

## Waves

The planner emits every task exactly once under `## Waves`:

```text
- Wave 1: Task 1.
- Wave 2: Tasks 2, 3.
```

Waves are ordered. Tasks in a wave are declared independent, but this native slice dispatches workers sequentially and preserves the staged result for the next wave. The worker can't change another wave's owned path. It can't change runner-owned planning artifacts.

Use waves to structure a real dependency chain. For example, a public rebrand can use:

1. Design tokens and explicitly approved brand assets.
2. Shared public shell.
3. Homepage sections.

Keep admin, authenticated, expert, legacy, and behavior surfaces explicitly excluded when the request requires preservation.

## Fresh reviews and mechanical evidence

Reviewers work from separate fresh evidence snapshots. The plan reviewer sees the plan. The code reviewer sees the plan, worker summary, product files, and delta. It doesn't inherit the worker conversation or plan-review result.

The runner writes and validates:

| Artifact | Meaning |
| --- | --- |
| `.planning/phases/<id>/PLAN.md` | Immutable validated plan. |
| `.planning/phases/<id>/PLAN-REVIEW.md` | Independent plan-review result. |
| `.planning/phases/<id>/SUMMARY.md` | Worker completion criteria plus authoritative runner observations. |
| `.planning/phases/<id>/SCOPE-CHECK.json` | Mechanical boundary comparison. |
| `.planning/phases/<id>/REVIEW.md` | Independent code-review result with machine evidence injected by the runner. |
| `.planning/riff-next/<id>.json` | State transitions and evidence hashes. |
| `.planning/riff-next/<id>.routing.json` | Selected provider, route variants, override provenance, and routing evidence. |
| `.planning/riff-next/<id>.worker-delta.json` | Authoritative product delta produced by the staged workers. |

The final summary's path and smoke evidence comes from the runner, not untrusted worker claims. The reviewer report includes machine evidence only after the runner validates its structure.

Completion requires a valid plan, `PROCEED` plan review, completed worker results, passing mechanics and scope, `PASS` code review, repeated passing mechanics, and a persisted `completed` state.

Completion doesn't create a PR, merge a branch, publish, deploy, or promote a project. Promotion is a separate explicit skill and always requires user confirmation before changing project files.

## Skills and invocation policy

The active RIFF skills are:

- `$start` or `$riff:start`, greenfield discovery and roadmap creation.
- `$map` or `$riff:map`, brownfield architecture and risk mapping.
- `$phase` or `$riff:phase`, validated roadmap phase management.
- `$status` or `$riff:status`, authoritative project status.
- `$dashboard` or `$riff:dashboard`, local read-only dashboard lifecycle.
- `$next` or `$riff:next`, native stage runner.
- `$wave` or `$riff:wave`, autonomous single-project roadmap wave and loop.
- `$deep-audit` or `$riff:deep-audit`, milestone audit.
- `$improve` or `$riff:improve`, pending expertise proposals.
- `$incident` or `$riff:incident`, production incident logging.
- `$incident-review` or `$riff:incident-review`, advisory incident-ledger review.
- `$promote` or `$riff:promote`, scratch-to-production promotion.
- `$resync` or `$riff:resync`, safe runtime-link and adapter reconciliation through the canonical CLI.

Every active skill declares `policy.allow_implicit_invocation: false`. Invoke a sensitive action explicitly. An assistant must not turn ordinary conversation into promotion, incident logging, audit, or a RIFF stage without that explicit request.

## Claude Code native runtime

RIFF supports Claude projects through `.claude/` links and native route variants in `agents/claude.yaml`. Set `runtime.provider: claude` in the active profile, then invoke the same CLI stage contract. The selected provider is visible in the routing receipt.

Use `/riff:resync` in Claude Code to reconcile installed runtime files. It delegates to the same `riff resync` CLI as the Codex skill. For shared skills, explicitly name the RIFF workflow in the request. The `$...` forms above are Codex invocation syntax. `/riff:wave` is a thin adapter over the native roadmap wave engine. The discovery, mapping, status, dashboard, and add-phase commands remain Claude-compatible surfaces. Use `riff next` for the provider-native deterministic stage.

To launch the native stage from a Claude session, invoke the terminal form shown above. With `runtime.provider: claude`, the runner dispatches the declared Claude variants while enforcing the same route portfolio, sequential in-phase waves, and completion boundary.

Choose entry points by intent:

| Intent | Codex | Claude Code | Terminal |
| --- | --- | --- | --- |
| Start product discovery | `$start` or `$riff:start` | `/riff:start` | Interactive skill or command |
| Map an existing project | `$map` or `$riff:map` | `/riff:map` | Interactive skill or command |
| Manage phases | `$phase` or `$riff:phase` | `/riff:add-phase` | `./.riff/riff phase ...` |
| Inspect status | `$status` or `$riff:status` | `/riff:status` | `./.riff/riff status` |
| Open dashboard | `$dashboard` or `$riff:dashboard` | `/riff:dashboard` | `./.riff/riff dashboard` |
| Run one explicit native phase | `$next` or `$riff:next` | Invoke `riff next` explicitly | `./.riff/riff next ...` |
| Run or resume autonomous roadmap work | `$wave` or `$riff:wave` | `/riff:wave --autonomous [--loop]` | `./.riff/riff wave --autonomous [--loop]` |
| Reconcile RIFF installation | `$resync` or `$riff:resync` | `/riff:resync` | `./.riff/riff resync` |
| Confirmed promotion | `$promote` or `$riff:promote` | Explicit promotion workflow | Follow the promotion protocol |

Don't copy provider model names into shared instructions. Change runtime routing in adapters and validate it with:

```bash
node scripts/artifact-check.mjs
./riff doctor --ci
```

## Operating checklist

Before a stage:

1. Work from a normal Git checkout with a clean enough scope to identify RIFF changes.
2. Run `riff init` or `riff resync` when the local runtime needs installation updates.
3. Save external references, approved assets, and preservation constraints in project files.
4. State the phase id and bounded request explicitly.
5. Name intended checks that actually exist in the project.

After completion:

1. Read `SUMMARY.md`, `SCOPE-CHECK.json`, `REVIEW.md`, and the state file.
2. Perform any product-specific visual or manual verification outside the runner's scope.
3. Decide separately whether to commit, open a PR, merge, deploy, or promote.
4. Confirm promotion only when you intend to run it.

For scripts and direct commands, read [../scripts/README.md](../scripts/README.md). For the compact architecture view, read [../HOW-IT-WORKS.md](../HOW-IT-WORKS.md).

## Test a development branch without affecting stable projects

Use one repository with separate Git worktrees. Keep the development branch in
its own framework worktree. Point only pilot projects' `.riff` symlink at that
worktree and run `./.riff/riff resync` in those projects. Other projects can
continue pointing at the stable main worktree. To roll back a pilot, repoint
`.riff` to the stable worktree and resync. A separate fork is useful only when
the framework needs independent release history or access control.

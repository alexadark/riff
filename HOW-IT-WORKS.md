# How RIFF works

RIFF is a deterministic stage runner. It converts one explicit phase request into validated artifacts and a completed state. It does not infer a phase, silently resume a prior run, open a pull request, merge, or promote a project.

The detailed operator workflow is in [docs/RIFF-MANUAL.md](docs/RIFF-MANUAL.md).

## Architecture

```text
Shared role specification
          |
          +--> Codex adapter, model, effort, sandbox, permissions
          |
          +--> Claude adapter, model, effort, tools, permissions
```

The shared specification states the business procedure. Runtime adapters state provider details. This keeps model names and sandbox policy out of reusable role instructions.

`agents/openai.yaml` maps semantic roles to Codex adapter variants. `agents/claude.yaml` maps the same roles to Claude native variants and retains compatibility aliases. `scripts/artifact-check.mjs` validates both mappings.

## Seven roles

| Role | Responsibility |
| --- | --- |
| Planner | Produces a bounded plan, task ownership, waves, and smoke commands. |
| Worker | Implements one approved assignment within its owned paths. |
| Reviewer | Produces fresh, independent plan, code, architecture, roadmap, incident, or milestone findings. |
| Debugger | Diagnoses a failure and returns a bounded worker assignment. |
| Security reviewer | Reviews security posture without modifying the repository. |
| Red teamer | Produces bounded non-production attack proofs. |
| Load tester | Produces static or approved non-production scale evidence. |

`simplify` is a worker assignment. `improve` is a skill. `scope-checker` is mechanical code, not an agent. Historical Claude aliases remain compatibility adapters, not additional semantic roles.

## Provider selection

The first active profile in the normal resolution chain selects the provider:

```yaml
runtime:
  provider: codex # or claude
```

The project override wins over the framework profile. Missing selection defaults to Codex; invalid selection fails before dispatch. `--provider` is an explicit one-run override. The selection is recorded and cannot change during a stage.

## Runtime routing

`$riff:next` chooses only declared runtime classes:

| Need | Route |
| --- | --- |
| Routine control, planning, or review | Sol, Medium |
| Architecture confirmation, architecture planning, or critical review | Sol, XHigh |
| Repeatable execution | Luna, XHigh, Fast |
| Bounded multi-file execution | Terra, High |
| Mechanical inventory for future callers | Luna, Low, Fast |
| Exceptional reviewer escalation after a recorded XHigh failure | Sol, Max |

Every Luna adapter uses the Fast service tier while preserving its declared effort. Fast reduces latency and increases plan usage. The mutation-only next slice never selects inventory or escalation routes.
No Haiku route is active.

Claude maps the same route classes to explicit Sonnet or Opus adapters. Routine work uses Sonnet; architecture, critical review, and specialist judgment use Opus. Claude workers have no Bash or nested-agent tool. Planned smokes remain runner-owned mechanical commands.

## One stage

The native sequence is:

```text
controller
  -> planner and plan validation
  -> fresh plan reviewer
  -> sequential autonomous worker waves
  -> mechanics, summary validation, scope check
  -> fresh code reviewer
  -> repeated mechanics
  -> completed state
```

The controller begins routine. It requests one fresh architecture-controller confirmation only when it classifies planning as architecture or review as critical. That confirmation is canonical for route selection.

The planner gives every task exclusive owned paths. It groups every task into numbered waves. RIFF dispatches one worker per wave in order, without a user pause. It rejects changes outside the current wave's owned paths. Workers don't run PLAN smoke entries inside the canonical staged workspace; RIFF runs them after all waves in disposable clones. A final smoke failure can trigger exactly one bounded full-plan repair. Normal worker retries do not exist.

## Autonomous roadmap waves

`riff wave --autonomous` selects the currently ready dependency frontier from
`ROADMAP.yaml` and runs one native `riff next` stage per phase. `--loop`
recomputes readiness after every completed frontier and continues until the
roadmap is dry, no work is ready, a real blocker occurs, or explicit human
verification is required. This is cross-phase orchestration; it is distinct
from the worker waves inside one PLAN.

Wave state is persisted under `.planning/riff-wave/`. A phase marked for visual
or functional verification runs its implementation first, then records one
immutable per-run, per-phase request and waits in `awaiting_human` before
unlocking dependent phases. `riff wave --approve --run <id> --phase <id>
--evidence "<note>"` records a bound approval receipt and resumes that same run
without rerunning the completed implementation. Destructive actions and
promotion remain confirmed before action.

`riff wave --resume` reconciles a completed interrupted attempt and retries only
failures that stopped before product promotion, using a distinct native phase
identifier. In loop mode, safe pre-promotion failures retry with fresh attempts
up to `autonomy.debug_cycle_cap`. Once that cap is reached, RIFF dispatches one
fresh read-only debugger. Only a valid `DIAGNOSED` report permits exactly one
debugger-guided native attempt. An unresolved, invalid, interrupted,
post-promotion, or failed guided recovery remains blocked and is never retried
by another debugger dispatch. Security-sensitive work doesn't create an
in-loop pause. Security hooks run once after product phases. RIFF never deploys
or promotes implicitly; an approved boundary phase may do so explicitly.

Plan and code review use fresh isolated read-only contexts. Reviewers receive independent evidence snapshots. They cannot mutate the project or inherit the worker context.

## Artifacts and completion

For phase `<id>`, the runner persists:

```text
.planning/phases/<id>/PLAN.md
.planning/phases/<id>/PLAN-REVIEW.md
.planning/phases/<id>/SUMMARY.md
.planning/phases/<id>/SCOPE-CHECK.json
.planning/phases/<id>/REVIEW.md
.planning/riff-next/<id>.json
.planning/riff-wave/<run>.json
.planning/riff-wave/<run>--<phase>.DEBUG.md
.planning/riff-wave/<run>--<phase>.debugger.routing.json
.planning/riff-wave/<run>.security.json
.planning/riff-wave/<run>.security-review.md
.planning/riff-wave/<run>.security-review.routing.json
```

The wave state records attempts, resumes, and human verification receipts.
The DEBUG and debugger-routing artifacts bind the single debugger diagnosis.
The final security artifacts record the mechanical and semantic reviews run
once after product phases.

The state file records transitions and evidence hashes. It is evidence, not a resume instruction. A later invocation must again provide explicit phase and task inputs. RIFF does not implicitly resume an incomplete stage.

Completed means every required stage, mechanical gate, summary contract, scope check, and independent review passed. It does not mean a branch was merged, a PR was opened, or a project was promoted.

## Skills and entry points

RIFF's active single-project entry skills are `start`, `map`, `phase`, `status`,
`dashboard`, `next`, `wave`, `finish`, `deep-audit`, `improve`, `incident`,
`incident-review`, `promote`, and `resync`. Their Codex metadata sets
`policy.allow_implicit_invocation: false`; the shared policy is explicit
invocation on both providers.

`start` creates a greenfield product definition and validated roadmap. `map`
documents a brownfield codebase without changing product behavior. `phase`
delegates list, add, and status changes to the validated CLI. `status` reads the
roadmap and persisted wave/stage evidence. `dashboard` delegates to the shared
read-only dashboard lifecycle command.

`start` and `map` are intentionally interactive skills on Codex and Claude.
They have no native terminal CLI. Phase, status, dashboard, next, wave, finish,
and resync remain backed by the deterministic terminal surface.

Use `$next` for the project-local Codex skill installed under `.agents/skills`. Use `$riff:next` only when RIFF is installed as a namespaced plugin. The direct CLI entry point is `./.riff/riff next --project-root ... --phase ... --task ...` and reads `runtime.provider` from the active profile.

Use `$wave` or `$riff:wave` for Codex roadmap orchestration,
`/riff:wave --autonomous [--loop]` in Claude Code, or the shared CLI
`./.riff/riff wave --autonomous [--loop]`. Resume with `riff wave --resume`.

Use `$finish` or `$riff:finish` in Codex, invoke the installed RIFF finish
workflow explicitly in Claude Code, or start with
`./.riff/riff finish --check`. Review the exact paths, evidence hashes, merge
strategy, and confirmation token. Only after explicit user confirmation run
the displayed `./.riff/riff finish --confirm <token>` command.
`github_button` creates or reuses a pull request without merging. `local_no_ff`
performs the explicitly confirmed no-fast-forward merge. Neither strategy
deploys or promotes.

Use `$resync` project-locally, `$riff:resync` from the plugin, or `/riff:resync` in Claude Code. All three delegate to `riff resync`. Other Claude slash commands remain the separately documented legacy roadmap workflow, not aliases for native next.

## Runtime limits

- Production model and smoke dispatches require Darwin. The runner fails closed on other platforms because the required read-deny enforcement is not trusted there.
- The current Claude route requires the Codex CLI only as the mechanical sandbox helper for planned smokes; it doesn't use Codex models.
- `riff init` does not support Git linked worktrees. Install from a normal checkout.
- Promotion remains an explicit confirmed workflow. A completed phase never promotes automatically.
- Finish remains an explicit confirmed Git workflow. A completed wave never commits, opens a pull request, merges, deploys, or promotes automatically.

See [CLAUDE.md](CLAUDE.md) for Claude runtime boundaries and [scripts/README.md](scripts/README.md) for executable tools.

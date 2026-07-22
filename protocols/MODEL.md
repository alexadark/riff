# Model Selection

Which model, reasoning depth, and inline-vs-subagent for each pipeline step.

Design rationale: [`references/MODEL-RATIONALE.md`](../references/MODEL-RATIONALE.md) — read only when changing dispatch rules.

Defaults in the dispatch table below assume `balanced` budget. See § Budget and model resolution for how `frugal` and `max` shift these defaults.

## Dispatch table

Depth comes from the `effort:` frontmatter on `subagent_type`-dispatched agents, the session effort + `ultrathink` for inline steps, and `--effort` for Codex steps — not from prose keywords (inert on Opus 4.8 / Claude 4.x; see § Effort). The executor stays model-based (`executor_model: opus` / Codex `--effort`).

| Step                                                   | Where                  | Model                                | Depth lever                                                  |
| ------------------------------------------------------ | ---------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `/riff:next` orchestration (state read, pick, git, PR) | Inline (parent)        | **Reasoning model** (`models.reasoning`, default Opus; forced via frontmatter) | session effort (Opus default `high`)       |
| `/riff:start` Stage 2.5: Architecture adversarial      | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| `/riff:start` Stage 4.5: Roadmap adversarial           | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| Step 4: Planner                                        | **Inline** (parent)    | **Reasoning model** (parent)         | session effort; `ultrathink` for architecture/novel (works inline — see § Planner) |
| Step 4b: Plan adversarial review                       | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| Step 5: Executor                                       | Sub-agent              | **Sonnet** (default), Codex/Opus on opt-in | Claude path at model default, deepen via `executor_model: opus`; Codex opt-in via `--effort` (xhigh on `complex_execution:`) (not `subagent_type`-dispatched) |
| Step 5b: Simplifier                                    | `subagent_type: simplifier` | **Haiku**                       | `effort: medium` (frontmatter)                               |
| Step 6: Adversarial review                             | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| Step 7: Security review                                | `subagent_type: security-reviewer` | **Sonnet**               | `effort: high` (frontmatter); `security_model: opus` for the model |
| Step 7b: Improver                                      | `subagent_type: improver` (background) | **Haiku**            | `effort: low` (frontmatter)                                  |
| Step 8a: Doc updater                                   | Sub-agent              | **Haiku**                            | model default (inline prompt, no agent file)                 |
| Quarterly incident review adversarial pass             | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| Debugger (auto-trigger or `/riff:debug`)               | `subagent_type: debugger` (tiers `normal`/`high`) or `debugger-max` (tier `max`) | **Tiered**: reasoning model (`normal`), Fable (`high`, `max`); Sonnet on `debug_model:` | `effort: high` frontmatter (`normal`/`high`), `effort: max` via `debugger-max` variant; Codex second opinion for CRITICAL/flaky (see § Debugger) |

## Codex model + effort

The `codex:codex-rescue` skill accepts `--model` and `--effort` flags. RIFF resolves both at the call site and includes them in the rescue prompt. Accepted effort values: `minimal | medium | high | xhigh`. Mapping below replaces the generic "Codex (GPT)" rows in the dispatch table.

| Step                                       | Budget   | Model           | Effort    |
| ------------------------------------------ | -------- | --------------- | --------- |
| Step 5 executor (opt-in — default is Sonnet) | any    | `gpt-5.5`       | `high`    |
| Step 4b plan adversarial                   | any      | `gpt-5.5`       | `medium`  |
| Step 6 post-build adversarial              | frugal   | `gpt-5.4-mini`  | `minimal` |
| Step 6 post-build adversarial              | balanced | `gpt-5.4`       | `medium`  |
| Step 6 post-build adversarial              | max      | `gpt-5.5`       | `medium`  |
| Stage 2.5 architecture adversarial         | any      | `gpt-5.5`       | `high`    |
| Stage 4.5 roadmap adversarial              | any      | `gpt-5.4`       | `medium`  |
| Quarterly incident adversarial pass        | any      | `gpt-5.5`       | `high`    |

### § Codex model+effort rationale

- **Step 5 executor (opt-in path):** the default executor is now Sonnet (Claude-native, no context hand-off, no external CLI dependency). Codex remains the opt-in volume path — `executor_model: codex` per phase or `--executor codex` on `/riff:wave` — and when opted in, it runs the frontier model at high effort (`gpt-5.5 high`): Codex is strong at guided execution and the Codex quota is generous (Plus $100 plan, not rationed), so opting in preserves Claude quota on heavy roadmaps. The asymmetric-budget policy still applies to review: Codex stays the second opinion on adversarial passes regardless of the executor choice.
- **Step 4b:** the `auto` gate already filters for complex phases. Once it fires, you're in expensive-correction territory — `gpt-5.5 medium` is justified. Frequency is low (~1-2/day on a typical roadmap) so Plus quota is fine.
- **Step 6:** highest-frequency Codex call. Default `gpt-5.4 medium` is the sweet spot ($2.50/$15 MTok, 20-100 msg/5h). `frugal` drops to `gpt-5.4-mini minimal`, `max` bumps to `gpt-5.5 medium`.
- **Stage 2.5:** architecture findings cost ~100x to fix later — `high` effort is justified.
- **Stage 4.5:** sequencing and dependency analysis. No need for the frontier model — `gpt-5.4 medium` suffices.
- **Quarterly incident pass:** post-mortem on shipped bugs, you want the deepest possible analysis — `gpt-5.5 high`.

### Executor runtime resolution (Step 5)

The executor defaults to a **Sonnet sub-agent**. Codex is opt-in for volume work. Resolution chain (highest wins):

1. Per-phase `executor_model:` in ROADMAP.yaml (`codex` opts into Codex; `sonnet`/`opus` pins the Claude sub-agent model)
2. PLAN.md `## Model Recommendation` (ROADMAP override beats this)
3. `executors.available` in profile.yaml (if `codex` absent, `executor_model: codex` is invalid and falls back to Sonnet with a warning)
4. Default: `sonnet`

When Codex executes (opt-in): the orchestrator invokes `codex:codex-rescue` with the execution skill (resolved per `codex.execution_skill` in profile.yaml). The skill receives the PLAN.md path, branch name, and execution contract.

When Claude executes (default): standard sub-agent spawn with `model: sonnet` (or `opus`), same prompt as before.

This flip covers VOLUME work only. The adversarial-review path is untouched: Steps 4b and 6, Stages 2.5 and 4.5, and the incident pass stay on Codex — the cross-family second opinion is the point there.

### Resolution chain (Codex review)

Same precedence as everything else (highest wins):

1. Per-phase override (`codex_model:`, `codex_effort:` in the phase entry)
2. Step + budget mapping above
3. Hardcoded fallback: `gpt-5.4 medium`

If the Codex skill is missing or returns an error: log a warning, skip the step, never block the pipeline.

## Effort

Reasoning depth is the `effort` parameter on the API (`low | medium | high | xhigh | max`). On Opus 4.8 / Claude 4.x the text phrases "think hard" / "think harder" / "think" are ordinary prompt text and change nothing — only `ultrathink` is intercepted, and only on the **main thread**.

How this maps to RIFF's spawn mechanism:

- **Inline (parent)** — planner, orchestration. Depth = the session effort. Opus defaults to `high`. A one-off `ultrathink` in the inline prompt works (main thread).
- **Sub-agents dispatched by `subagent_type`** — security-reviewer, simplifier, improver, debugger (and the stress agents). RIFF spawns these with `subagent_type: <name>`, so the agent file is the system prompt and its **`effort:` frontmatter is the real depth lever**. The Agent tool has no per-call effort param, so the frontmatter value is fixed per agent; a `model:` override on the call still applies on top. To change a tier, edit the agent's `effort:` (or add a named variant). `ultrathink` in the spawn prompt still does nothing — use frontmatter.
- **Executor (Step 5)** — default path is a Sonnet sub-agent (and the multi-task wave workers), spawned with per-task context, depth via `executor_model: opus` / `complex_execution`. The Codex opt-in path gets depth via `--effort`. Not converted to `subagent_type` (the wave mechanism owns that spawn).
- **Codex steps** — adversarial reviewers, deep-auditor, Codex second opinions. Depth via the `--effort` flag RIFF passes into the rescue prompt.

Per-agent effort (frontmatter): security-reviewer `high`, debugger `high`, debugger-max `max` (the named-variant mechanism in action — see § Debugger selection), simplifier `medium`, improver `low`. Stress: red-teamer `high`, load-tester `medium`. A sub-agent with no `effort:` inherits the session effort.

| Want more depth on… | Lever |
| --- | --- |
| Planner / orchestration (inline) | session effort + `ultrathink` |
| Security review | edit `security-reviewer` `effort:`; `security_model: opus` for the model |
| Simplifier / improver | edit the agent's `effort:` frontmatter |
| Debugger | dispatch tier: `/riff:debug --tier high|max` or `debugger.default_tier` (see § Debugger selection) |
| Execution (Claude path) | `executor_model: opus`; (Codex path) `codex_effort` / `complex_execution` |
| Any Codex step | `--effort` (`minimal | medium | high | xhigh`) |

### Planner (Step 4) selection

Planner runs **inline** on the parent, so its depth is the session effort (Opus default `high`). Add `ultrathink` to the inline planner prompt when the phase is P0 **and** tagged `architecture` / `novel` / `security_critical`. The session `high` covers P0/P1 standard. The old `think harder`/`think hard` per-tier prose was inert on current models and is removed.

### planner_model resolution

1. Phase's `planner_model:` in ROADMAP.yaml if present.
2. Default: `profile.yaml` `models.reasoning` (ships as `opus`).

If `planner_model: codex` but `codex` is not in `executors.available`, fall back to the reasoning model and log a one-line warning. `opus` and the legacy alias `fable` both mean "run inline on the parent session model" (which the command frontmatter forces to the reasoning model). Per-phase override beats the default.

### Security (Step 7) selection

The security-reviewer is dispatched by `subagent_type: security-reviewer` at a fixed `effort: high` (frontmatter) — the cost of a missed vuln dwarfs the cost of thinking, so it stays high on every phase. There is no per-call auth-vs-other split (effort is fixed by the file). For phases touching auth / payment / public API / secrets (or tag `security_critical`), extra depth comes from the Step 6 Codex adversarial pass and `security_model: opus` (runs the review on the reasoning model, still at `effort: high`).

### Debugger selection

The debugger is dispatched at one of three explicit tiers, resolved by the dispatcher before spawn (canonical table: `agents/debugger.md` § Tiers). Priority: `/riff:debug --tier` flag → auto-mapping from failure type + triage signals → `profile.yaml` `debugger.default_tier` (default `normal`).

| Tier   | Model                                | Effort | Mechanism |
| ------ | ------------------------------------ | ------ | --------- |
| normal | `models.reasoning` (default `opus`)  | high   | `subagent_type: debugger` |
| high   | `fable`                              | high   | `subagent_type: debugger`, `model: fable` |
| max    | `fable`                              | max    | `subagent_type: debugger-max` (its `effort: max` frontmatter — the Agent tool has no per-call effort param) |

**Max is a viciousness signal, not a severity signal.** `normal` covers routine `executor_fail`, deterministic `test_fail`, and clear-scope `security_fail` regardless of severity; `high` covers `adversarial_fail` with 3+ distinct issues, multi-layer bugs spanning services, and `verification_fail`; `max` covers intermittent/flaky failures, "can't reproduce", race conditions, and 2+ failed fix attempts on the same issue. `debug_model: sonnet` still opts the model down for clearly-scoped failures. No `debugger:` profile block → `normal`, exactly the pre-tier behavior.

Regardless of tier, the debugger only diagnoses and verifies at its own model — mechanical fix application is delegated to `debugger.delegation.mechanical_worker` sub-agents (default `sonnet`), see `agents/debugger.md` Step 4.2.

The old per-triage-tier keyword range (`ultrathink`→none) was inert and is removed. For the hardest cases — `security_fail` CRITICAL, flaky/intermittent, 2+ failed fix attempts, or a context-dependent signature per `protocols/DEBUGGING.md` § Triage with a first attempt failed — escalate with a Codex second opinion (`codex:codex-rescue`, `gpt-5.6-sol high` <!-- TODO(model-id): confirm gpt-5.6-sol exists -->) alongside the Claude debugger: an independent diagnosis beats a deeper pass from the same model. Bench (2026-07-12): `sol-high` matched Opus-max on the hardest debug replay, 0.40 each. See `agents/debugger.md` Step 1.

## Budget and model resolution

### executors.available

Gates which executor models the planner may recommend.

- **Allowed values:** `[claude, codex]` (default) | `[claude]`
- **Default when missing:** treated as `[claude, codex]` — Codex is available as an opt-in executor (the default executor runtime is Sonnet).
- **Effect:** if `codex` is not present in the list, the planner must never emit `executor_model: codex` in PLAN.md's Model Recommendation. If only `[claude]`, the Codex opt-in is unavailable and execution always runs on the Sonnet sub-agent.
- **Cross-reference:** see `commands/onboard.md` § Questions for setup guidance; `.riff/scripts/riff-init.mjs` `PRESETS.default` for the baseline profile defaults.

Every decision (model choice, whether to run optional pipeline steps) resolves through this chain. Highest wins:

1. **Per-phase override** in ROADMAP.yaml (`executor_model:`, `simplify:`, `adversarial:`, `auto_debug:`, `debug_model:`, etc.)
2. **Per-project override** in ROADMAP.yaml top-level: `budget_quality: frugal | balanced | max`
3. **Profile default** from `profile.yaml`: `budget.default_quality`
4. **Hardcoded default**: `balanced`

### Budget implications

| Budget | Optional pipeline steps (defaults) | Model defaults |
| ------ | ---------------------------------- | -------------- |
| `frugal` | `simplify: false`, `arch_adversarial: false`, `plan_adversarial: false`, `roadmap_adversarial: false`, `adversarial: false`, improver off | Sonnet for execution (default; Codex on opt-in), Haiku/Sonnet for lightweight steps, never the reasoning model by default |
| `balanced` | `simplify: auto`, `arch_adversarial: auto`, `plan_adversarial: auto`, `roadmap_adversarial: auto`, `adversarial: auto`, improver per existing heuristic | Sonnet for execution (default; Codex on opt-in via `executor_model: codex`), reasoning model for planner (default) |
| `max` | `simplify: auto`, `arch_adversarial: auto` (bias toward running), `plan_adversarial: auto` (bias toward running), `roadmap_adversarial: auto` (bias toward running), `adversarial: auto` (bias toward running), improver per heuristic | Sonnet for execution (default; Codex on opt-in), reasoning model for planner and security-critical execution |

Per-phase flags always win over budget defaults.

### Example: mixing levels

```yaml
# ROADMAP.yaml
budget_quality: max         # project runs at max (overrides profile's `balanced`)

phases:
  - id: 42
    executor_model: sonnet  # per-phase override: this one phase stays on Sonnet
    simplify: false         # per-phase override: skip simplifier for this phase
```

### Per-phase override fields

```yaml
phases:
  - id: 42
    executor_model: opus        # execution model: sonnet (default) | opus (novel architecture only) | codex (opt-in volume path; `fable` accepted as legacy alias for opus)
    complex_execution: true     # Claude path (default): deepen via executor_model: opus (no per-call effort override). Codex opt-in path: bump codex_effort to xhigh
    security_critical: true     # security-reviewer is already fixed at effort: high; this adds the Step 6 Codex adversarial pass + `security_model: opus`
    security_model: sonnet      # sonnet (default) | opus — opt-in reasoning model for security-critical phases
    auto_debug: false           # disable auto-debug triggers for this phase
    debug_model: sonnet         # override the debugger's tier-resolved model (cost knob; see § Debugger selection)
    planner_model: codex        # codex | opus — which model plans this phase (default: profile.yaml models.reasoning; `fable` accepted as legacy alias)
    simplify: true              # force simplifier on (or false to skip)
    plan_adversarial: true      # force plan adversarial on (or false to skip)
    adversarial: true           # force adversarial on (or false to skip)
    codex_model: gpt-5.5        # override default Codex model for this phase
    codex_effort: high          # override default Codex effort for this phase
```

PLAN.md's `## Model Recommendation` section can recommend an executor model. ROADMAP.yaml takes precedence over PLAN.md.

### Sub-agent model precedence

Within the resolved budget (highest wins):

1. `CLAUDE_CODE_SUBAGENT_MODEL` env var
2. `model:` parameter on the Agent tool call ← RIFF uses this
3. `model:` in the sub-agent's frontmatter
4. Parent session model (default: `model: inherit`)

For `/riff:next` parent session: `model: opus` in the command frontmatter forces the reasoning model regardless of the user's current `/model`. Frontmatter is parsed before the command runs, so it cannot read `profile.yaml` — this value is a **static mirror** of `models.reasoning`. If you change `models.reasoning`, also update the `model:` line in the `next`/`start`/`wave` command frontmatter. The legacy value `fable` is still accepted.

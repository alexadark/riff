# Model Selection

Which model, reasoning depth, and inline-vs-subagent for each pipeline step.

Design rationale: [`references/MODEL-RATIONALE.md`](../references/MODEL-RATIONALE.md) — read only when changing dispatch rules.

Defaults in the dispatch table below assume `balanced` budget. See § Budget and model resolution for how `frugal` and `max` shift these defaults.

## Dispatch table

Depth is set by **model choice and the working effort levers**, not by prose keywords (see § Effort for why keywords are inert in RIFF's spawn path). "Model default" below means the chosen model's own default effort; the lever to go deeper is escalating the model (`*_model: opus`) or, for Codex steps, the `--effort` flag.

| Step                                                   | Where                  | Model                                | Depth lever                                                  |
| ------------------------------------------------------ | ---------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `/riff:next` orchestration (state read, pick, git, PR) | Inline (parent)        | **Reasoning model** (`models.reasoning`, default Opus; forced via frontmatter) | session effort (Opus default `high`)       |
| `/riff:start` Stage 2.5: Architecture adversarial      | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| `/riff:start` Stage 4.5: Roadmap adversarial           | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| Step 4: Planner                                        | **Inline** (parent)    | **Reasoning model** (parent)         | session effort; `ultrathink` for architecture/novel (works inline — see § Planner) |
| Step 4b: Plan adversarial review                       | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| Step 5: Executor                                       | Sub-agent              | **Codex** (default), Sonnet/Opus on opt-in | Codex `--effort` (xhigh on `complex_execution:`); Claude fallback runs at model default, deepen via `executor_model: opus` |
| Step 5b: Simplifier                                    | Sub-agent              | **Haiku**                            | model default                                                 |
| Step 6: Adversarial review                             | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| Step 7: Security review                                | Sub-agent              | **Sonnet**                           | model default; deepen via `security_model: opus`              |
| Step 7b: Improver                                      | Sub-agent (background) | **Haiku**                            | model default                                                 |
| Step 8a: Doc updater                                   | Sub-agent              | **Haiku**                            | model default                                                 |
| Quarterly incident review adversarial pass             | Sub-agent              | **Codex (GPT)**                      | `--effort` (see § Codex model + effort)                       |
| Debugger (auto-trigger or `/riff:debug`)               | Sub-agent              | **Reasoning model** (default), Sonnet opt-in | model default; Codex second opinion for CRITICAL/flaky (see § Debugger) |

## Codex model + effort

The `codex:codex-rescue` skill accepts `--model` and `--effort` flags. RIFF resolves both at the call site and includes them in the rescue prompt. Accepted effort values: `minimal | medium | high | xhigh`. Mapping below replaces the generic "Codex (GPT)" rows in the dispatch table.

| Step                                       | Budget   | Model           | Effort    |
| ------------------------------------------ | -------- | --------------- | --------- |
| Step 5 executor                            | any      | `gpt-5.5`       | `high`    |
| Step 4b plan adversarial                   | any      | `gpt-5.5`       | `medium`  |
| Step 6 post-build adversarial              | frugal   | `gpt-5.4-mini`  | `minimal` |
| Step 6 post-build adversarial              | balanced | `gpt-5.4`       | `medium`  |
| Step 6 post-build adversarial              | max      | `gpt-5.5`       | `medium`  |
| Stage 2.5 architecture adversarial         | any      | `gpt-5.5`       | `high`    |
| Stage 4.5 roadmap adversarial              | any      | `gpt-5.4`       | `medium`  |
| Quarterly incident adversarial pass        | any      | `gpt-5.5`       | `high`    |

### § Codex model+effort rationale

- **Step 5 executor:** Codex is strong at guided execution and the Codex quota is generous (Plus $100 plan, not rationed). Run the frontier model at high effort on every phase — `gpt-5.5 high`. This is the asymmetric-budget policy: spend freely on Codex, stay conservative on Claude (the reasoning model for the planner, Sonnet as the executor fallback, Haiku for mechanical steps). Per-phase `executor_model: sonnet|opus` still forces the Claude fallback when a phase needs Claude-specific tools.
- **Step 4b:** the `auto` gate already filters for complex phases. Once it fires, you're in expensive-correction territory — `gpt-5.5 medium` is justified. Frequency is low (~1-2/day on a typical roadmap) so Plus quota is fine.
- **Step 6:** highest-frequency Codex call. Default `gpt-5.4 medium` is the sweet spot ($2.50/$15 MTok, 20-100 msg/5h). `frugal` drops to `gpt-5.4-mini minimal`, `max` bumps to `gpt-5.5 medium`.
- **Stage 2.5:** architecture findings cost ~100x to fix later — `high` effort is justified.
- **Stage 4.5:** sequencing and dependency analysis. No need for the frontier model — `gpt-5.4 medium` suffices.
- **Quarterly incident pass:** post-mortem on shipped bugs, you want the deepest possible analysis — `gpt-5.5 high`.

### Executor runtime resolution (Step 5)

The executor defaults to Codex via the `codex:codex-rescue` skill (in-process, blocks until done). Fallback chain (highest wins):

1. Per-phase `executor_model:` in ROADMAP.yaml (`sonnet` or `opus` forces Claude sub-agent)
2. PLAN.md `## Model Recommendation` (ROADMAP override beats this)
3. `executors.available` in profile.yaml (if `codex` absent, fall back to Sonnet)
4. Default: `codex`

When Codex executes: the orchestrator invokes `codex:codex-rescue` with the execution skill (resolved per `codex.execution_skill` in profile.yaml). The skill receives the PLAN.md path, branch name, and execution contract.

When Claude executes: standard sub-agent spawn with `model: sonnet` (or `opus`), same prompt as today.

### Resolution chain (Codex review)

Same precedence as everything else (highest wins):

1. Per-phase override (`codex_model:`, `codex_effort:` in the phase entry)
2. Step + budget mapping above
3. Hardcoded fallback: `gpt-5.4 medium`

If the Codex skill is missing or returns an error: log a warning, skip the step, never block the pipeline.

## Effort

Reasoning depth is the `effort` parameter on the API (`low | medium | high | xhigh | max`). On Opus 4.8 / Claude 4.x the text phrases "think hard" / "think harder" / "think" are ordinary prompt text and change nothing — only `ultrathink` is intercepted, and only on the **main thread**.

How this maps to RIFF's spawn mechanism — the part that bites:

- **Inline (parent)** — planner, orchestration. Depth = the session effort. Opus defaults to `high`. A one-off `ultrathink` in the inline prompt works (main thread).
- **Sub-agents** — RIFF spawns every sub-agent by **prompt injection**: an Agent-tool call with a `model:` override and a prompt that says *"Read `agents/X.md`. …"*. It does **not** dispatch by `subagent_type`. Consequences:
  - The Agent tool has **no per-call effort parameter**, so RIFF cannot set a sub-agent's effort at spawn.
  - A sub-agent's `effort:` frontmatter is **not read** through this path (the file is loaded as prompt content, not as a subagent definition).
  - An `ultrathink` keyword injected into a sub-agent prompt does **nothing**.
  - Net: each sub-agent runs at **its model's default effort**. The only lever to go deeper is **choosing a stronger model** — `security_model: opus`, `executor_model: opus`, `debug_model` — or, for Codex steps, the `--effort` flag (which RIFF passes into the rescue prompt and does work).

The depth-by-model levers RIFF has today:

| Want more depth on… | Lever that works |
| --- | --- |
| Planner / orchestration (inline) | session effort + `ultrathink` |
| Security review | `security_model: opus` |
| Execution (Claude path) | `executor_model: opus`; (Codex path) `codex_effort` / `complex_execution` |
| Debugging | reasoning model default; Codex second opinion on the hardest tier |
| Any Codex step | `--effort` (`minimal | medium | high | xhigh`) |

> **Follow-up (not yet done):** to make a real per-step `effort` knob, RIFF would dispatch sub-agents by `subagent_type` (frontmatter `effort:` applies) instead of prompt injection. That touches every spawn call site in `QUALITY.md` / `EXECUTION.md` / `POST-PHASE.md`. Tracked as a future change; until then, model choice is the depth lever.

### Planner (Step 4) selection

Planner runs **inline** on the parent, so its depth is the session effort (Opus default `high`). Add `ultrathink` to the inline planner prompt when the phase is P0 **and** tagged `architecture` / `novel` / `security_critical`. The session `high` covers P0/P1 standard. The old `think harder`/`think hard` per-tier prose was inert on current models and is removed.

### planner_model resolution

1. Phase's `planner_model:` in ROADMAP.yaml if present.
2. Default: `profile.yaml` `models.reasoning` (ships as `opus`).

If `planner_model: codex` but `codex` is not in `executors.available`, fall back to the reasoning model and log a one-line warning. `opus` and the legacy alias `fable` both mean "run inline on the parent session model" (which the command frontmatter forces to the reasoning model). Per-phase override beats the default.

### Security (Step 7) selection

The security-reviewer runs on **Sonnet at its model default effort**. RIFF can't raise effort per-call (prompt-injection spawn, no effort param), so there is no auth-vs-other keyword split. Depth on the riskier phases comes from two levers that work: the Step 6 Codex adversarial pass (independent model), and `security_model: opus` for phases touching auth / payment / public API / secrets (or tag `security_critical`), which runs the review on the reasoning model.

### Debugger selection

The debugger runs on the reasoning model (default) at its model default effort; `debug_model: sonnet` opts down for clearly-scoped failures. The old per-triage-tier keyword range (`ultrathink`→none) was inert and is removed. For the top tier — `security_fail` CRITICAL, flaky/intermittent, or 2+ failed fix attempts — escalate with a Codex second opinion (`codex:codex-rescue`, `gpt-5.5 high`) alongside the Claude debugger, which adds a genuinely independent diagnosis instead of a deeper pass from the same model. See `agents/debugger.md` Step 1.

## Budget and model resolution

### executors.available

Gates which executor models the planner may recommend.

- **Allowed values:** `[claude, codex]` (default) | `[claude]`
- **Default when missing:** treated as `[claude, codex]` — Codex is the default executor runtime.
- **Effect:** if `codex` is not present in the list, the planner must never emit `executor_model: codex` in PLAN.md's Model Recommendation. If only `[claude]`, executor falls back to Sonnet sub-agent.
- **Cross-reference:** see `commands/onboard.md` § Questions for setup guidance; `.riff/scripts/riff-init.mjs` `PRESETS.default` for the baseline profile defaults.

Every decision (model choice, whether to run optional pipeline steps) resolves through this chain. Highest wins:

1. **Per-phase override** in ROADMAP.yaml (`executor_model:`, `simplify:`, `adversarial:`, `auto_debug:`, `debug_model:`, etc.)
2. **Per-project override** in ROADMAP.yaml top-level: `budget_quality: frugal | balanced | max`
3. **Profile default** from `profile.yaml`: `budget.default_quality`
4. **Hardcoded default**: `balanced`

### Budget implications

| Budget | Optional pipeline steps (defaults) | Model defaults |
| ------ | ---------------------------------- | -------------- |
| `frugal` | `simplify: false`, `arch_adversarial: false`, `plan_adversarial: false`, `roadmap_adversarial: false`, `adversarial: false`, improver off | Codex for execution (default), Haiku/Sonnet for lightweight steps, never the reasoning model by default |
| `balanced` | `simplify: auto`, `arch_adversarial: auto`, `plan_adversarial: auto`, `roadmap_adversarial: auto`, `adversarial: auto`, improver per existing heuristic | Codex for execution (default), Sonnet on `executor_model: sonnet` override, reasoning model for planner (default) |
| `max` | `simplify: auto`, `arch_adversarial: auto` (bias toward running), `plan_adversarial: auto` (bias toward running), `roadmap_adversarial: auto` (bias toward running), `adversarial: auto` (bias toward running), improver per heuristic | Codex for execution (default), reasoning model for planner and security-critical execution |

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
    executor_model: opus        # force the reasoning model for execution (novel architecture only; default: codex, fallback: sonnet; `fable` accepted as legacy alias)
    complex_execution: true     # Codex path: bump codex_effort to xhigh. Claude fallback: deepen via executor_model: opus (no per-call effort override)
    security_critical: true     # routes depth via Step 6 Codex adversarial + `security_model: opus` (no per-call effort override on the Sonnet review)
    security_model: sonnet      # sonnet (default) | opus — opt-in reasoning model for security-critical phases
    auto_debug: false           # disable auto-debug triggers for this phase
    debug_model: sonnet         # use Sonnet instead of Opus for the debugger
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

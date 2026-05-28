# Model Selection

Which model, thinking budget, and inline-vs-subagent for each pipeline step.

Rationale and background → [`MODEL.md § Rationale`](./MODEL.md#rationale).

Defaults in the dispatch table below assume `balanced` budget. See § Budget and model resolution for how `frugal` and `max` shift these defaults.

## Dispatch table

| Step                                                   | Where                  | Model                                | Thinking                                                      |
| ------------------------------------------------------ | ---------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `/riff:next` orchestration (state read, pick, git, PR) | Inline (parent)        | **Opus** (forced via frontmatter)    | none                                                          |
| `/riff:start` Stage 2.5: Architecture adversarial      | Sub-agent              | **Codex (GPT)**                      | see § Codex model + effort                                    |
| `/riff:start` Stage 4.5: Roadmap adversarial           | Sub-agent              | **Codex (GPT)**                      | see § Codex model + effort                                    |
| Step 4: Planner                                        | **Inline** (parent)    | **Opus** (parent)                    | Dynamic per phase                                             |
| Step 4b: Plan adversarial review                       | Sub-agent              | **Codex (GPT)**                      | see § Codex model + effort                                    |
| Step 5: Executor                                       | Sub-agent              | **Codex** (default), Sonnet/Opus on opt-in | none, `think hard` if `complex_execution:`               |
| Step 5b: Simplifier                                    | Sub-agent              | **Haiku**                            | none                                                          |
| Step 6: Adversarial review                             | Sub-agent              | **Codex (GPT)**                      | see § Codex model + effort                                    |
| Step 7: Security review                                | Sub-agent              | **Sonnet**                           | `think harder` for auth/payment/public-API, else `think hard` |
| Step 7b: Improver                                      | Sub-agent (background) | **Haiku**                            | none                                                          |
| Step 8a: Doc updater                                   | Sub-agent              | **Haiku**                            | none                                                          |
| Quarterly incident review adversarial pass             | Sub-agent              | **Codex (GPT)**                      | see § Codex model + effort                                    |
| Debugger (auto-trigger or `/riff:debug`)               | Sub-agent              | **Opus** (default), Sonnet opt-in    | Dynamic per triage tier                                       |

## Codex model + effort

The `codex:codex-rescue` skill accepts `--model` and `--effort` flags. RIFF resolves both at the call site and includes them in the rescue prompt. Mapping below replaces the generic "Codex (GPT)" rows in the dispatch table.

| Step                                       | Budget   | Model           | Effort    |
| ------------------------------------------ | -------- | --------------- | --------- |
| Step 4b plan adversarial                   | any      | `gpt-5.5`       | `medium`  |
| Step 6 post-build adversarial              | frugal   | `gpt-5.4-mini`  | `minimal` |
| Step 6 post-build adversarial              | balanced | `gpt-5.4`       | `medium`  |
| Step 6 post-build adversarial              | max      | `gpt-5.5`       | `medium`  |
| Stage 2.5 architecture adversarial         | any      | `gpt-5.5`       | `high`    |
| Stage 4.5 roadmap adversarial              | any      | `gpt-5.4`       | `medium`  |
| Quarterly incident adversarial pass        | any      | `gpt-5.5`       | `high`    |

### § Codex model+effort rationale

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

## Thinking keywords

Inject at the start of the agent's prompt.

| Keyword        | Budget | When                                   |
| -------------- | ------ | -------------------------------------- |
| `ultrathink`   | Max    | P0 + architecture / novel design       |
| `think harder` | High   | P0 standard, complex security review   |
| `think hard`   | Medium | P1 standard, normal security review    |
| `think`        | Low    | Edge cases during execution            |
| (none)         | None   | Mechanical work, low-stakes background |

### Planner (Step 4) selection

- P0 **AND** tag `architecture` / `novel` / `security_critical` → `ultrathink`
- P0 standard, or P1 with tag `complex` → `think harder`
- P1 standard → `think hard`
- P2 or tag `simple` / `mechanical` → none

### planner_model resolution

1. Phase's `planner_model:` in ROADMAP.yaml if present.
2. Default: `opus`.

If `planner_model: codex` but `codex` is not in `executors.available`, fall back to `opus` and log a one-line warning. Per-phase override beats the default.

### Security (Step 7) selection

- Phase touches auth / payment / public API / secrets, or tag `security_critical` → `think harder`
- Else → `think hard`

## Budget and model resolution

### executors.available

Gates which executor models the planner may recommend.

- **Allowed values:** `[claude, codex]` (default) | `[claude]`
- **Default when missing:** treated as `[claude, codex]` — Codex is the default executor runtime.
- **Effect:** if `codex` is not present in the list, the planner must never emit `executor_model: codex` in PLAN.md's Model Recommendation. If only `[claude]`, executor falls back to Sonnet sub-agent.
- **Cross-reference:** see `commands/onboard.md` § Questions for setup guidance; `scripts/riff-init.mjs` presets for per-preset defaults.

Every decision (model choice, whether to run optional pipeline steps) resolves through this chain. Highest wins:

1. **Per-phase override** in ROADMAP.yaml (`executor_model:`, `simplify:`, `adversarial:`, `auto_debug:`, `debug_model:`, etc.)
2. **Per-project override** in ROADMAP.yaml top-level: `budget_quality: frugal | balanced | max`
3. **Profile default** from `profile.yaml`: `budget.default_quality`
4. **Hardcoded default**: `balanced`

### Budget implications

| Budget | Optional pipeline steps (defaults) | Model defaults |
| ------ | ---------------------------------- | -------------- |
| `frugal` | `simplify: false`, `arch_adversarial: false`, `plan_adversarial: false`, `roadmap_adversarial: false`, `adversarial: false`, improver off | Codex for execution (default), Haiku/Sonnet for lightweight steps, never Opus by default |
| `balanced` | `simplify: auto`, `arch_adversarial: auto`, `plan_adversarial: auto`, `roadmap_adversarial: auto`, `adversarial: auto`, improver per existing heuristic | Codex for execution (default), Sonnet on `executor_model: sonnet` override, Opus only on per-phase flag |
| `max` | `simplify: auto`, `arch_adversarial: auto` (bias toward running), `plan_adversarial: auto` (bias toward running), `roadmap_adversarial: auto` (bias toward running), `adversarial: auto` (bias toward running), improver per heuristic | Codex for execution (default), Opus for planner and security-critical execution |

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
    executor_model: opus        # force Opus for execution (default: codex, fallback: sonnet)
    complex_execution: true     # inject `think hard` into executor prompt
    security_critical: true     # force `think harder` in security review
    auto_debug: false           # disable auto-debug triggers for this phase
    debug_model: sonnet         # use Sonnet instead of Opus for the debugger
    planner_model: codex        # codex | opus — which model plans this phase (default: opus)
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

For `/riff:next` parent session: `model: opus` in the command frontmatter forces Opus regardless of the user's current `/model`.

## Sources

- [Subagents docs](https://code.claude.com/docs/en/subagents.md)
- [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview.md)
- [Choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model.md)

## Rationale

Background and design reasoning behind this protocol. Read this when deciding whether to change the dispatch rules — not during normal execution.

### Core findings

#### 1. Sub-agents inherit the parent model by default

A sub-agent's frontmatter defaults to `model: inherit`, meaning it runs on the same model as the parent session. If RIFF wants Opus for planning and Sonnet for execution regardless of how the user launched the command, it must override at the call site.

RIFF uses the `model:` parameter on the Agent tool call (precedence option 2 — see MODEL.md).

Source: https://code.claude.com/docs/en/subagents.md

#### 2. Slash commands can force a model

A slash command's frontmatter accepts `model:` to force the parent session onto a specific model for the duration of the command. RIFF uses this on `/riff:next` to guarantee the orchestration + inline planner always run on Opus, regardless of the user's current `/model` setting.

#### 3. Sub-agents cost ~7x more tokens than inline work

Each sub-agent spins up a **fresh context**: no prompt cache reuse, system prompt + tool definitions re-sent, files re-read from disk, and a result envelope returned to the parent. Anthropic research benchmarks put a 3-agent team at ~7x the token consumption of an equivalent single-agent session.

**Implication for model choice:** a "cheaper" Sonnet sub-agent can end up _more expensive_ than an Opus inline call.

Quick math: Opus is ~5x Sonnet per token. Sub-agent overhead ~7x. Net: **Sonnet sub-agent ≈ 1.4x the cost of Opus inline** for the same work. Inline wins on both cost and quality whenever the parent already has the relevant context loaded.

#### 4. The planner runs inline, not as a sub-agent

By the time Step 4 fires, the parent has already read `ROADMAP.yaml`, `STATE.md`, the previous `SUMMARY.md`, and run the confidence gate. That context is exactly what the planner needs. Spawning a sub-agent would force a re-read of the same files in a fresh context — pure waste.

Inline wins because:

- No re-read of state/roadmap/summary
- No fresh-context overhead (~7x tokens)
- Better planning quality (richer working context)
- Parent is already on Opus (forced via frontmatter)

The previous opt-in `planner_model: sonnet` (downgrade planner to Sonnet sub-agent) was **dropped**: a Sonnet sub-agent would cost ~1.4x an Opus inline call while delivering worse plans. Net loss.

#### 5. Codex (GPT) for adversarial review

A different model catches different bugs. Claude reviewing Claude's diff has predictable blind spots. Codex is invoked via the `codex:codex-rescue` skill — its reasoning effort is configured in the skill, not via Claude thinking keywords (those are Claude-only).

Bonus: Codex is included in the GPT subscription, replacing what used to be a 60k-token Claude verifier.

#### 6. Haiku for low-stakes background tasks

Anthropic explicitly recommends Haiku 4.5 for "sub-agent tasks" and "cost-sensitive deployments needing strong reasoning." Haiku is **~1/3 the price of Sonnet** (input $1 vs $3, output $5 vs $15 per M tokens) and has reliable tool use.

RIFF uses Haiku for:

- **Improver** — background, non-blocking learnings extraction
- **Simplifier** — diff-scoped dead code + naming + structure checks (pattern matching, not reasoning)
- **Doc updater** — regenerate file trees, route tables (pattern work, not reasoning)

**Knowledge cutoff caveat:** Haiku 4.5 has a Feb 2025 cutoff (vs Jan 2026 for Sonnet 4.6). Non-issue for RIFF — these agents have access to Context7, Ref MCP, and WebFetch and can look up recent libs themselves.

### Per-step rationale

#### Parent session + Step 4 (Planner) — Opus inline

Planning quality is the single biggest leverage point in the pipeline. A bad plan = wasted execution tokens downstream. Parent already loaded all context in Steps 1–3 → inline is cheaper _and_ better than spawning. Forced via `model: opus` in `/riff:next` frontmatter.

#### Step 5 (Executor) — Codex runtime by default

Plan is already written — execution is mostly mechanical (write code per PLAN.md, commit, write SUMMARY). Codex is the default executor runtime via `codex:codex-rescue` / CLI. Sonnet is a fallback or explicit override (`executor_model: sonnet`) when Codex is unavailable or the phase needs Claude-specific tools. Opus opt-in remains for novel architecture, 10+ tightly coupled files, unfamiliar external APIs. Thinking: none by default, `think hard` only if `complex_execution:`.

#### Step 6 (Adversarial reviewer) — Codex

Different model = catches Claude's blind spots. Free via GPT sub. Reasoning effort controlled inside the `codex:codex-rescue` skill.

#### Step 7 (Security reviewer) — Sonnet, thinking harder/hard

OWASP scan = reasoning-heavy work (subtle vulns, IDOR, race conditions). Cost of thinking is dwarfed by cost of a missed CVE. `think harder` for auth/payment/public-API, `think hard` otherwise.

#### Step 7b (Improver) — Haiku, background

Pattern extraction from SUMMARY + expertise files → low complexity. Non-blocking, runs in background. 1/3 the cost of Sonnet, with Context7/Ref/WebFetch fallback for any recent lib questions.

#### Step 8a (Doc updater) — Haiku

Regenerating file trees, route tables, taste pattern indexes → mechanical pattern work. No reasoning required, just diffing structure against current state.

#### Debugger — Opus, dynamic thinking

Debug is reasoning-heavy: hypothesis formation, root cause analysis, tracing implicit assumptions in code you didn't write. Failures are high-stakes: a wrong diagnosis produces a wrong fix that may mask the real problem. Opus default; Sonnet opt-in (`debug_model: sonnet`) for cost-sensitive cases where the failure is clearly scoped. Thinking tier is auto-selected from the failure artifact (see `agents/debugger.md` Step 1). Range: `ultrathink` for CRITICAL security or flaky intermittent bugs → no keyword for obvious config errors.

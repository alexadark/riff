# Model Selection

Which model, thinking budget, and inline-vs-subagent for each pipeline step.

Rationale and background → [`MODEL-rationale.md`](./MODEL-rationale.md).

Defaults in the dispatch table below assume `balanced` budget. See § Budget and model resolution for how `frugal` and `max` shift these defaults.

## Dispatch table

| Step                                                   | Where                  | Model                                | Thinking                                                      |
| ------------------------------------------------------ | ---------------------- | ------------------------------------ | ------------------------------------------------------------- |
| `/riff:next` orchestration (state read, pick, git, PR) | Inline (parent)        | **Opus** (forced via frontmatter)    | none                                                          |
| Step 4: Planner                                        | **Inline** (parent)    | **Opus** (parent)                    | Dynamic per phase                                             |
| Step 4b: Plan adversarial review                       | Sub-agent              | **Codex (GPT)**                      | N/A (controlled via skill)                                    |
| Step 5: Executor                                       | Sub-agent              | **Sonnet** (default), Opus on opt-in | none, `think hard` if `complex_execution:`                    |
| Step 5b: Simplifier                                    | Sub-agent              | **Haiku**                            | none                                                          |
| Step 6: Adversarial review                             | Sub-agent              | **Codex (GPT)**                      | N/A (controlled via skill)                                    |
| Step 7: Security review                                | Sub-agent              | **Sonnet**                           | `think harder` for auth/payment/public-API, else `think hard` |
| Step 7b: Improver                                      | Sub-agent (background) | **Haiku**                            | none                                                          |
| Step 8a: Doc updater                                   | Sub-agent              | **Haiku**                            | none                                                          |
| Debugger (auto-trigger or `/riff:debug`)               | Sub-agent              | **Opus** (default), Sonnet opt-in    | Dynamic per triage tier                                       |

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

### Security (Step 7) selection

- Phase touches auth / payment / public API / secrets, or tag `security_critical` → `think harder`
- Else → `think hard`

## Budget and model resolution

Every decision (model choice, whether to run optional pipeline steps) resolves through this chain. Highest wins:

1. **Per-phase override** in ROADMAP.yaml (`executor_model:`, `simplify:`, `adversarial:`, `auto_debug:`, `debug_model:`, etc.)
2. **Per-project override** in ROADMAP.yaml top-level: `budget_quality: frugal | balanced | max`
3. **Profile default** from `profile.yaml`: `budget.default_quality`
4. **Hardcoded default**: `balanced`

### Budget implications

| Budget | Optional pipeline steps (defaults) | Model defaults |
| ------ | ---------------------------------- | -------------- |
| `frugal` | `simplify: false`, `plan_adversarial: false`, `adversarial: false`, improver off | Haiku or Sonnet everywhere, never Opus by default |
| `balanced` | `simplify: auto`, `plan_adversarial: auto`, `adversarial: auto`, improver per existing heuristic | Sonnet for execution, Opus only on per-phase flag |
| `max` | `simplify: auto`, `plan_adversarial: auto` (bias toward running), `adversarial: auto` (bias toward running), improver per heuristic | Opus for planner and security-critical execution, Sonnet for routine work |

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
    executor_model: opus        # force Opus for execution
    complex_execution: true     # inject `think hard` into executor prompt
    security_critical: true     # force `think harder` in security review
    auto_debug: false           # disable auto-debug triggers for this phase
    debug_model: sonnet         # use Sonnet instead of Opus for the debugger
    simplify: true              # force simplifier on (or false to skip)
    plan_adversarial: true      # force plan adversarial on (or false to skip)
    adversarial: true           # force adversarial on (or false to skip)
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

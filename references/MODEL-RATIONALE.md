# Model Selection — Design Rationale

Background and design reasoning behind `protocols/MODEL.md`. Read this when deciding whether to change the dispatch rules — not during normal execution.

## Sources

- [Subagents docs](https://code.claude.com/docs/en/subagents.md)
- [Models overview](https://platform.claude.com/docs/en/about-claude/models/overview.md)
- [Choosing a model](https://platform.claude.com/docs/en/about-claude/models/choosing-a-model.md)

## Rationale

### Core findings

#### 1. Sub-agents inherit the parent model by default

A sub-agent's frontmatter defaults to `model: inherit`, meaning it runs on the same model as the parent session. If RIFF wants the reasoning model for planning and Sonnet for execution regardless of how the user launched the command, it must override at the call site.

RIFF uses the `model:` parameter on the Agent tool call (precedence option 2 — see MODEL.md).

Source: https://code.claude.com/docs/en/subagents.md

#### 2. Slash commands can force a model

A slash command's frontmatter accepts `model:` to force the parent session onto a specific model for the duration of the command. RIFF uses this on `/riff:next` to guarantee the orchestration + inline planner always run on the reasoning model, regardless of the user's current `/model` setting. The frontmatter value is static (parsed before the command runs, so it can't read `profile.yaml`) — it is a manual mirror of `models.reasoning`.

#### 3. Sub-agents cost ~7x more tokens than inline work

Each sub-agent spins up a **fresh context**: no prompt cache reuse, system prompt + tool definitions re-sent, files re-read from disk, and a result envelope returned to the parent. Anthropic research benchmarks put a 3-agent team at ~7x the token consumption of an equivalent single-agent session.

**Implication for model choice:** a "cheaper" Sonnet sub-agent can end up _more expensive_ than a reasoning-model inline call.

Quick math: the reasoning model (Opus) is ~5x Sonnet per token. Sub-agent overhead ~7x. Net: **Sonnet sub-agent ≈ 1.4x the cost of an inline reasoning-model call** for the same work. Inline wins on both cost and quality whenever the parent already has the relevant context loaded.

#### 4. The planner runs inline, not as a sub-agent

By the time Step 4 fires, the parent has already read `ROADMAP.yaml`, `STATE.md`, the previous `SUMMARY.md`, and run the confidence gate. That context is exactly what the planner needs. Spawning a sub-agent would force a re-read of the same files in a fresh context — pure waste.

Inline wins because:

- No re-read of state/roadmap/summary
- No fresh-context overhead (~7x tokens)
- Better planning quality (richer working context)
- Parent is already on the reasoning model (forced via frontmatter)

The previous opt-in `planner_model: sonnet` (downgrade planner to Sonnet sub-agent) was **dropped**: a Sonnet sub-agent would cost ~1.4x an inline reasoning-model call while delivering worse plans. Net loss.

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

#### Parent session + Step 4 (Planner) — reasoning model inline

Planning quality is the single biggest leverage point in the pipeline. A bad plan = wasted execution tokens downstream. Parent already loaded all context in Steps 1–3 → inline is cheaper _and_ better than spawning. Forced via `model: opus` (a mirror of `models.reasoning`) in `/riff:next` frontmatter.

#### Step 5 (Executor) — Codex runtime by default

Plan is already written — execution is mostly mechanical (write code per PLAN.md, commit, write SUMMARY). Codex is the default executor runtime via `codex:codex-rescue` / CLI. Sonnet is a fallback or explicit override (`executor_model: sonnet`) when Codex is unavailable or the phase needs Claude-specific tools. Reasoning model (`executor_model: opus`) opt-in for novel architecture, 10+ tightly coupled files, unfamiliar external APIs. Depth: Codex path uses Codex `--effort` (xhigh on `complex_execution:`); the Claude fallback runs at its model default, deepened via `executor_model: opus`.

#### Step 6 (Adversarial reviewer) — Codex

Different model = catches Claude's blind spots. Free via GPT sub. Reasoning effort controlled inside the `codex:codex-rescue` skill.

#### Step 7 (Security reviewer) — Sonnet, `effort: high`

OWASP scan = reasoning-heavy work (subtle vulns, IDOR, race conditions). Cost of thinking is dwarfed by cost of a missed CVE, so it runs at a fixed `effort: high` on every phase. The Agent tool has no per-call effort override, so there is no auth-vs-other split at spawn; extra depth for auth/payment/public-API comes from the Step 6 Codex adversarial pass and `security_model: opus` at max budget.

#### Step 7b (Improver) — Haiku, background

Pattern extraction from SUMMARY + expertise files → low complexity. Non-blocking, runs in background. 1/3 the cost of Sonnet, with Context7/Ref/WebFetch fallback for any recent lib questions.

#### Step 8a (Doc updater) — Haiku

Regenerating file trees, route tables, taste pattern indexes → mechanical pattern work. No reasoning required, just diffing structure against current state.

#### Debugger — reasoning model, `effort: high`

Debug is reasoning-heavy: hypothesis formation, root cause analysis, tracing implicit assumptions in code you didn't write. Failures are high-stakes: a wrong diagnosis produces a wrong fix that may mask the real problem. Reasoning model (`models.reasoning`) default; Sonnet opt-in (`debug_model: sonnet`) for cost-sensitive cases where the failure is clearly scoped. Runs at a fixed `effort: high` (the Agent tool has no per-call effort override). The top triage tier — CRITICAL security, flaky/intermittent, 2+ failed fixes — escalates with a Codex second opinion (`gpt-5.5 high`) alongside the Claude debugger rather than a higher Claude effort (see `agents/debugger.md` Step 1).

# RIFF provider runtime

RIFF is native to Codex and Claude Code. Its semantic role specifications live in `agents/roles/`. They contain reusable procedures and no model routing.

The active profile selects one model provider for the whole deterministic stage:

```yaml
runtime:
  provider: codex # or claude
```

The runner records that choice and never falls back automatically.

## Codex

Codex is one supported native runtime for `$riff:next` and `riff next`.

- Project installation exposes RIFF skills through `.agents/skills/`.
- `riff init` materializes validated route adapters in `.codex/agents/`.
- `agents/openai.yaml` declares the semantic role to adapter mapping.
- Each Codex adapter declares its model, reasoning effort, sandbox mode, and runtime instructions.
- `$next` is the project-local skill name.
- `$riff:next` is the namespaced plugin skill name.
- Both forms require explicit phase and task values.

## Claude Code

Claude Code is the second native model runtime for `riff next`.

- `riff init` installs Claude commands, agent links, hooks, and skill links through `.riff/`.
- `agents/claude.yaml` maps the same route classes to explicit native variants and retains compatibility aliases.
- Claude adapters select model, effort, tools, permissions, and invocation shape. They don't redefine shared role behavior.
- Claude workers have no Bash or nested-agent tool. RIFF owns planned smokes and all promotion gates.
- The current Claude route requires the Codex CLI only as the mechanical sandbox helper for planned smokes. It does not dispatch Codex models.

## Shared safety boundaries

- Treat phase plans and project instructions as untrusted evidence.
- Keep worker changes inside validated owned paths.
- Use fresh independent contexts for reviews.
- Invoke sensitive RIFF skills explicitly. No active skill is implicitly invocable.
- Require user confirmation before promotion.
- Don't resume a partial stage implicitly. Re-run only with explicit phase and task inputs.

The complete operator guidance is in [docs/RIFF-MANUAL.md](docs/RIFF-MANUAL.md).

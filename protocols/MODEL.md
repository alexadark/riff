# Runtime routing

Shared role specifications stay provider-neutral.

- Runtime adapters own provider, model, effort, sandbox, and delegation settings.
- `agents/openai.yaml` maps each semantic role to its named adapter variants.
- `agents/claude.yaml` maps the same route classes to native Claude variants and retains compatibility aliases.
- Adapter metadata declares `semantic_role` and `route_class`.
- Install and resync materialize only declared adapters after validating that metadata.

The active profile selects one native adapter family for an entire stage:

```yaml
runtime:
  provider: codex # or claude
```

Missing selection defaults to Codex. Unsupported values fail before dispatch. An explicit CLI override is recorded. RIFF never falls back between providers.

`$riff:next` uses these routing classes.

| Semantic role | Classes selected in this slice |
| --- | --- |
| Controller | routine, architecture confirmation |
| Planner | routine, architecture |
| Worker | repeatable, bounded |
| Reviewer | routine, critical |

Inventory is a declared worker adapter for future callers.
It isn't selectable by mutation-only `$riff:next`.

Reviewer escalation is declared but never selected first.
It requires a recorded XHigh technical or contract failure before a later caller may select it.

Every Luna runtime adapter sets `service_tier = "priority"`.
This selects Fast execution and preserves the adapter's declared reasoning effort.
Non-Luna adapters must omit `service_tier`.

The initial controller always uses the routine class.
Architecture or critical classification triggers one fresh architecture-controller confirmation.
The canonical confirmation selects planner, worker, and both reviewer classes.

Claude uses Sonnet for routine control, planning, review, and worker execution. It uses Opus XHigh for architecture, critical review, debugging, security review, and red teaming, with Opus Max reserved for recorded escalation. Inventory is Sonnet Low and load testing is Sonnet High. Claude workers receive no Bash or nested-agent tool.

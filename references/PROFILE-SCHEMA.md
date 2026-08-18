# Profile schema

`profile.yaml` expresses operator and project preferences. It selects the native stage provider, while model, effort, tools, permissions, agent count, and delegation remain adapter-owned.

```yaml
runtime:
  provider: <codex | claude>  # default: codex

user:
  programming_level: <novice | learner | intermediate | experienced | expert>
  ai_agents_experience: <none | tried | regular | advanced>
  domains: [<frontend | backend | fullstack | data_ml | systems | mobile | generalist>]
  work_mode: <solo | team | solo_plus_clients | client_work | mix>
  side_activities: [<none | content | business | design | ops | other>]
  conversational_language: <ISO 639-1 code>  # default: en
  artifact_language: <ISO 639-1 code>        # default: en
  narrative_language: <ISO 639-1 code>       # defaults to conversational_language

# Legacy Claude command workflow only. These keys are retained for command
# compatibility and do not configure native routing.
executors:
  available: [<runtime>]

models:
  reasoning: <legacy runtime selection>

debugger:
  default_tier: <normal | high | max>

wave:
  codex_exec:
    run_mode: <legacy command run mode>

risk:
  sensitive_task_preference: <cautious | balanced | fast>

style:
  length: <terse | standard | detailed>
  allow_jargon: <free | first_mention | never>
  when_uncertain: <always_ask | important_only | initiative>
  explanation_level: <technical | simple | eli5>
  terminal_explanation_level: <technical | simple | eli5>  # optional

budget:
  default_quality: <frugal | balanced | max>

notifications:
  channel: <none | telegram | email>
  telegram_bot_token: <token>  # required for telegram
  telegram_chat_id: <chat id>  # required for telegram
  email_to: <address>          # required for email

metadata:
  pr_body: <off | standard | full>

git:
  merge_strategy: <github_button | local_no_ff>

autonomy:
  auto_launch: <true | false>
  hold_behavior: <park | flag_and_continue>
  debug_cycle_cap: <positive integer>

dashboard:
  projects: [<absolute project path>]
```

`runtime.provider` selects one installed native adapter family for the entire stage. It never changes mid-run and RIFF never falls back to the other provider. A missing value defaults to `codex`; an unsupported value fails before dispatch. Models and effort remain fixed by the selected provider adapters.

Unknown fields may be retained for explicitly installed legacy integrations, but native RIFF does not interpret them as route-selection instructions. See `references/PROFILE-RESOLUTION.md` for precedence and `docs/RIFF-MANUAL.md` for the active workflow.

## Legacy Claude command workflow

The following command-era keys are retained only so an installed legacy command can validate its own profile. They do not configure `$riff:next`.

These keys appear in the schema block above so compatibility validators can identify them.

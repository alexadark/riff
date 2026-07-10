# Profile Schema

Complete field reference for `profile.yaml` (and `.planning/profile.yaml` per-project overrides). Resolution order: [`references/PROFILE-RESOLUTION.md`](./PROFILE-RESOLUTION.md).

```yaml
user:
  programming_level: <novice | learner | intermediate | experienced | expert>
  ai_agents_experience: <none | tried | regular | advanced>
  domains: [<frontend | backend | fullstack | data_ml | systems | mobile | generalist>]
  work_mode: <solo | team | solo_plus_clients | client_work | mix>
  side_activities: [<none | content | business | design | ops | other>]
  conversational_language: <en | fr | mix | ISO 639-1 code (es, ro, de, ja, …)>  # default: en
  artifact_language: <en | fr | ISO 639-1 code>                                  # default: en
  narrative_language: <en | fr | other>                                          # default: falls back to conversational_language

executors:
  available: [<claude> | <claude, codex>]  # default [claude, codex] when missing

codex:
  execution_skill: /apex  # skill invoked by CODEX-DELEGATION.md prompt templates
                          # must accept flags: -a -x -v -m -bundle <path>
                          # default: /apex

models:
  reasoning: <opus | sonnet | any model the Agent tool accepts>  # default: opus
                          # strong inline reasoning model: orchestration, planner,
                          # debugger default. Single knob to swap when the flagship
                          # rotates. Sub-agents read it at the call site; the parent
                          # force in command frontmatter is a static mirror.

wave:
  reconcile_mode: <hooks | sonnet | both | off>  # default: both — see protocols/WAVE-RECONCILE.md § Modes
  executor: <codex | sonnet>  # default: codex — see commands/wave.md (Executor resolution)
  codex_exec:                  # codex sub-mode, applies when executor == codex
    run_mode: <codex-exec-in-session | paste>  # default: codex-exec-in-session (mode C).
                          # codex-exec-in-session: the session runs `codex exec` headless in the
                          # background and auto-reconciles on exit (no manual paste, interrupt only
                          # on FAIL/HITL). paste: legacy hand-off to a separate Codex terminal.
    sandbox_bypass: <true | false>   # default: true — codex exec needs network + write
    background: <true | false>       # default: true — free the session, re-invoke on exit
    auto_reconcile: <true | false>   # default: true — run Step 6 automatically when the run exits
    reasoning_effort: <minimal | low | medium | high | xhigh>            # default: high
    reasoning_effort_security_critical: <... | xhigh>                    # default: xhigh — for security_critical/adversarial phases
    fallback: <paste>                # what to do if `codex exec` fails to start

risk:
  sensitive_task_preference: <cautious | balanced | fast>

style:
  length: <terse | standard | detailed>
  allow_jargon: <free | first_mention | never>
  when_uncertain: <always_ask | important_only | initiative>
  explanation_level: <technical | simple | eli5>           # drives dashboard + terminal
  terminal_explanation_level: <technical | simple | eli5>  # OPTIONAL override for terminal only

budget:
  default_quality: <frugal | balanced | max>

notifications:
  channel: <none | telegram | email>
  telegram_bot_token: <"BOT_TOKEN">    # required when channel=telegram (quote it, has a colon)
  telegram_chat_id: <CHAT_ID>          # required when channel=telegram
  email_to: <address>                  # required when channel=email

metadata:
  pr_body: <off | standard | full>

git:
  merge_strategy: <github_button | local_no_ff>

dashboard:
  projects: []                            # registry of project paths (auto-managed)
```

> Legacy: `dashboard.level` and `dashboard.language` are still read by the dashboard parser as a fallback for older profiles. New profiles should use `style.explanation_level` and `user.narrative_language`.

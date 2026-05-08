---
description: Interactive onboarding — writes profile.yaml to personalize RIFF to you
allowed-tools: Read, Write, AskUserQuestion, Bash
argument-hint: [--no-register]
---

# /riff:onboard

Writes a profile that personalizes RIFF. Two modes:

- **Framework mode** (run from inside the RIFF clone) → writes `<framework_root>/profile.yaml`, the global default for every project.
- **Project mode** (run from a project with `.planning/`) → writes `<project_root>/.planning/profile.yaml`, an override that replaces the global default for this project only (full override, no merge).

Every agent reads the resolved profile on startup (see `references/PROFILE-RESOLUTION.md`). Edit the file by hand later, or ask Claude to change a specific field (e.g. "set my notification channel to telegram").

## How it works

- Two paths: **preset** (0 extra questions) or **custom** (15 questions, ~5 min).
- Re-running `/riff:onboard` backs up the previous profile to `<file>.bak` before overwriting.
- Flag `--no-register`: in framework context, skip writing `~/.config/riff/config.yaml`. Use this for workshop demos or testing on a throwaway clone, so the global registry keeps pointing at your real RIFF.

## Steps

0. **Parse args.** If `$ARGUMENTS` contains `--no-register`, set `NO_REGISTER=true`. Default false.

1. **Detect context.** Decide which file to write:

   - **Framework context:** `git rev-parse --show-toplevel` is a RIFF clone (has `agents/`, `commands/`, `protocols/`). Target = `<framework_root>/profile.yaml`. Also register the path (Step 1b).
   - **Project context:** pwd has a `.planning/` directory (RIFF-installed project). Target = `<project_root>/.planning/profile.yaml`.
   - **Ambiguous:** neither matches. AskUserQuestion: `framework default` (path to RIFF clone) / `project override` (path to project) / `abort`. Validate the chosen path matches its expected shape, then proceed.

   Report the chosen target before continuing so the user can abort.

1b. **Register framework path** (framework context only, skipped in project context or when `NO_REGISTER=true`). Write the detected root to the user-level registry so other RIFF commands can locate the framework without hardcoded paths:

   ```bash
   mkdir -p ~/.config/riff
   cat > ~/.config/riff/config.yaml <<EOF
   framework_path: <detected root>
   registered_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
   EOF
   ```

   If the file already exists, overwrite `framework_path` (single source of truth, no multi-RIFF).

   After writing the registry, wire up the global init command so `/riff:init` is available in any new project — including brand-new empty directories before RIFF is installed there:

   ```bash
   mkdir -p ~/.claude/commands/riff
   ln -sf "<detected root>/commands/init.md" ~/.claude/commands/riff/init.md
   ```

   If the symlink already points to the right target, skip silently. Report: `global /riff:init wired → ~/.claude/commands/riff/init.md`.

   When `NO_REGISTER=true`, skip both the registry write and the symlink, and report: `registry untouched (--no-register), still pointing at <existing framework_path or "unset">`. Global init command not wired.

2. **Check existing profile.** If the target file exists, AskUserQuestion: `replace` / `keep and exit` / `abort`. On `replace`, copy current to `<target>.bak` first.

3. **Entry choice.** AskUserQuestion:
   - `preset` — quick start, 0 extra questions
   - `custom` — 15 questions, ~5 min

4. **Preset path.** AskUserQuestion with the 4 presets (descriptions in the "Presets" section below). Pick one, grab its full answer map, jump to step 6.

5. **Custom path.** Walk the 15 questions via AskUserQuestion in order. Present each in the user's conversation language (detect from prior turns; fall back to English). Q3 and Q5 use multiSelect. Note: Q6 was removed (parallel_projects is handled by the dashboard project dropdown), so the numbering jumps from Q5 to Q7a — leave the gap, do not renumber downstream questions.

6. **Write profile.yaml** to the target resolved in Step 1 (framework root or project `.planning/`) using the schema below. YAML format, quote string values with special characters.

7. **Report.** Adapt the message to context:

   ```
   profile.yaml written to <target>.

   Mode: <framework default | project override>.

   Next:
     - Edit the file directly anytime (plain text).
     - Or ask Claude to change a specific field ("set my notification channel to slack").
     - Per-project budget override: set `budget_quality:` in the project's ROADMAP.yaml.
   ```

   In project mode, also remind the user: "This profile only applies in this project. Other projects keep using your framework default."

## Questions

### Section 1 — Who you are

**Q1. Programming level**
- `novice` — just starting
- `learner` — can read code, can't fully write alone
- `intermediate` — code regularly
- `experienced` — years of experience
- `expert`

Maps to: `user.programming_level`

> Known ambiguity: this mixes skill with self-identification. Someone who builds tools but doesn't identify as "a pure developer" tends to answer `intermediate` rather than `experienced`. Flagged, not yet fixed.

**Q2. Experience with AI coding agents (Claude Code, Cursor, Copilot)**
- `none` — never used
- `tried` — a few times
- `regular` — in my workflow
- `advanced` — I push them far

Maps to: `user.ai_agents_experience`

**Q3. Primary domain(s)** [multiSelect]
- `frontend`
- `backend`
- `fullstack`
- `data_ml`
- `systems`
- `mobile`
- `generalist`

Maps to: `user.domains` (array)

**Q4. Work mode**
- `solo` — solo only
- `team` — in a team
- `solo_plus_clients` — solo with occasional client work
- `client_work` — mostly client work
- `mix` — a bit of everything

Maps to: `user.work_mode`

**Q5. Side activities** [multiSelect]
- `none` — full-time coding
- `content` — YouTube, blog, podcast
- `business` — business and product
- `design`
- `ops` — operations and support
- `other`

Maps to: `user.side_activities` (array)

**Q7a. Conversational language** (how the agent talks to you)
- `en` — English (default)
- `fr` — French
- `mix` — adapt to the question language
- `other` — free-form, ask for an ISO 639-1 code (e.g. `es`, `ro`, `de`, `ja`, `pt`)

Maps to: `user.conversational_language`. Default `en` if the user skips the question.

**Q7b. Artifact language** (committed code, commits, shared docs)
- `en` — English (default, standard for code and international collaboration)
- `fr` — French
- `other` — free-form, ask for an ISO 639-1 code

Maps to: `user.artifact_language`. Default `en` if the user skips the question.

> Nuance: non-commit personal notes default to `conversational_language`. Rule: "if it's going in a commit → `artifact_language`; for personal use → `conversational_language`".

### Section 2 — Risk appetite

**Q8. Sensitive tasks** (auth, DB, payments, deploys)
- `cautious` — verify everything, ask before big things, install all protections
- `balanced` — middle ground between caution and speed
- `fast` — I know what I'm doing, verify after

Maps to: `risk.sensitive_task_preference`

Downstream: decides which hook bucket installs, HITL default threshold for auth/payment phases, security-reviewer tone. (Wiring lands in v2.)

### Section 3 — Collaboration style

**Q9a. Message length**
- `terse` — shortest possible, straight to the point
- `standard` — clear, not too long
- `detailed` — full, pedagogical explanations

Maps to: `style.length`

> Ad-hoc override possible in conversation ("make it shorter", "explain more").

**Q9b. Jargon policy**
- `free` — use jargon freely, I master it
- `first_mention` — define technical terms on first use in a message
- `never` — always plain language, no jargon

Maps to: `style.allow_jargon`

**Q10. When uncertain**
- `always_ask` — always ask, I prefer to validate
- `important_only` — ask for important decisions, take initiative on small ones
- `initiative` — take initiative, explain after, I prefer speed

Maps to: `style.when_uncertain`

### Section 4 — Budget

**Q11. Budget and quality tradeoff**

RIFF runs multiple steps per phase (plan, execute, review, simplify, security scan). More steps and bigger models = better results, higher cost.

- `frugal` — essential steps only (plan + execute), fast models everywhere, min budget
- `balanced` — all steps, Sonnet/Haiku by default, Opus only when needed
- `max` — all steps, Opus wherever it makes sense, max budget

Maps to: `budget.default_quality`

Per-project override: a project's `ROADMAP.yaml` can set `budget_quality:` to override for that project only.

### Section 5 — Notifications

**Q12. AFK mode notifications** (when the agent needs your attention while running unattended)
- `none` — I'll check manually
- `telegram` — sends via the official Telegram Bot API (also asks for bot_token + chat_id, see § Telegram setup below)
- `email` — sends via `gws gmail` if available, else system `mail` (also asks for `notifications.email_to`)

Maps to: `notifications.channel`. When the user picks `telegram`, ask two follow-up questions (free-form `AskUserQuestion`) for `notifications.telegram_bot_token` and `notifications.telegram_chat_id` and link them to the § Telegram setup section below for the how-to. When the user picks `email`, ask one follow-up question for `notifications.email_to`. Skip the follow-up for `none`.

> Slack is intentionally not offered yet (workspace + incoming-webhook setup is more involved). Add it later if needed.

**Telegram setup** (run this once before picking `channel: telegram`)

1. Open Telegram, message [@BotFather](https://t.me/BotFather) and send `/newbot`. Pick a name + username. BotFather replies with a bot token like `123456:ABC-DEF...`.
2. Open a chat with your new bot and send any message (this lets the bot see you).
3. Visit `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser, find the `"chat":{"id":<NUMBER>}` value: that's your chat_id.
4. Add to `profile.yaml` (or let the onboarding write it):
   ```yaml
   notifications:
     channel: telegram
     telegram_bot_token: "123456:ABC-DEF..."   # quoted because of the colon
     telegram_chat_id: 12345678
   ```

If either value is missing, `notify-human.sh` prints a one-line warning to stderr and returns 0 (never blocks a phase).

### Section 6 — Git workflow

**Q13. Phase merge strategy** (when `/riff:next` finishes a phase and the PR is ready to ship)
- `github_button` — I click Merge on GitHub myself. RIFF reconciles ROADMAP.yaml + STATE.md on the next `/riff:next` run via Step 0. **Best for team workflows** with peer review, branch-protection rules, and GitHub squash-merge / merge-commit policies.
- `local_no_ff` — RIFF merges locally with `git merge --no-ff` after I say "merge" in chat. Avoids the case where GitHub squash-merge bundles unpushed personal commits on main into the squash. **Best for solo / solo-plus-clients workflows** where you sometimes have unpushed local commits on main (journal notes, drafts, scratch).

Maps to: `git.merge_strategy`. Default: `github_button`.

> Tradeoff: `local_no_ff` produces a denser main history (one merge commit per phase + the phase commits as themselves) but the merge cleanly preserves both timelines. `github_button` with squash gives a single-commit-per-phase main, but any unpushed personal commits get pulled into the squash and create local divergence.

### Section 7 — Explanation level

**Q14. Explanation level** (drives `/riff:dashboard` AND how Claude reports work in the terminal)
- `technical` — names functions, files, types, paths. Tech vocab assumed. Best for senior devs.
- `simple` — everyday language, no jargon. What changed, in plain words. (Recommended)
- `eli5` — analogy-based, 2-4 sentences. Useful in the dashboard for non-technical observers. Collapses to `simple` in the terminal (analogies don't fit terminal contexts).

Maps to: `style.explanation_level`. Default: `simple`.

> Want different verbosity in the terminal vs the dashboard? After onboarding, edit `profile.yaml` and set `style.terminal_explanation_level: technical` (or any of the three values) — that overrides terminal output only.

**Q15. Narrative language** (language of dashboard EXPLAIN summaries — independent from `artifact_language`)
- `en` — English (default)
- `fr` — French
- `other` — falls back to English

Maps to: `user.narrative_language`. Default: falls back to `conversational_language` when `fr`/`en`, else `en`. Drives the language of `EXPLAIN.*.md` and `EXPLAIN-POST.*.md` files generated for the dashboard. These files are private (gitignore `.planning/phases/`), so picking `fr` here while keeping `artifact_language: en` lets you read native-language summaries while shipping public artifacts in English.

> Both `user.conversational_language` and `style.explanation_level` (or `style.terminal_explanation_level`) drive the `voice-rules-inject` SessionStart hook (see `hooks/README.md`). That hook injects language + explanation-depth rules at every session start so ad-hoc interactions honor the same preferences as RIFF agents, not only `/riff:next` phase reports. Profile edits take effect on the next session.

## Profile schema

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

git:
  merge_strategy: <github_button | local_no_ff>

dashboard:
  projects: []                            # registry of project paths (auto-managed)
```

> Legacy: `dashboard.level` and `dashboard.language` are still read by the dashboard parser as a fallback for older profiles. New profiles should use `style.explanation_level` and `user.narrative_language`.

## Presets

### expert — team specialist, knows security, values speed

```yaml
user:
  programming_level: expert
  ai_agents_experience: regular
  domains: [backend]
  work_mode: team
  side_activities: [none]
  conversational_language: en
  artifact_language: en
  narrative_language: en
risk:
  sensitive_task_preference: fast
style:
  length: terse
  allow_jargon: free
  when_uncertain: initiative
  explanation_level: technical
budget:
  default_quality: balanced
notifications:
  channel: none
git:
  merge_strategy: github_button
dashboard:
  language: en
```

### neutre — safe defaults, no personality assumed

```yaml
user:
  programming_level: intermediate
  ai_agents_experience: tried
  domains: [generalist]
  work_mode: solo
  side_activities: [none]
  conversational_language: en
  artifact_language: en
  narrative_language: en
risk:
  sensitive_task_preference: balanced
style:
  length: standard
  allow_jargon: first_mention
  when_uncertain: important_only
  explanation_level: simple
budget:
  default_quality: balanced
notifications:
  channel: none
git:
  merge_strategy: github_button
dashboard:
  language: en
```

### apprentissage — non-tech curious, wants to understand what happens

```yaml
user:
  programming_level: learner
  ai_agents_experience: none
  domains: [generalist]
  work_mode: solo
  side_activities: [none]
  conversational_language: fr
  artifact_language: en
  narrative_language: fr
risk:
  sensitive_task_preference: cautious
style:
  length: detailed
  allow_jargon: never
  when_uncertain: always_ask
  explanation_level: eli5
budget:
  default_quality: balanced
notifications:
  channel: none
git:
  merge_strategy: github_button
dashboard:
  language: fr
```

### alex — validated against actual setup

```yaml
user:
  programming_level: intermediate
  ai_agents_experience: advanced
  domains: [frontend, fullstack]
  work_mode: solo_plus_clients
  side_activities: [content, business]
  conversational_language: fr
  artifact_language: en
  narrative_language: fr
risk:
  sensitive_task_preference: cautious
style:
  length: terse
  allow_jargon: never
  when_uncertain: important_only
  explanation_level: simple
  terminal_explanation_level: technical
budget:
  default_quality: max
notifications:
  channel: telegram
git:
  merge_strategy: local_no_ff
dashboard:
  language: fr
```

## Notes

- v1 scope: writes `profile.yaml` only. Hook-bucket wiring based on Q8 and `{{USER_CONTEXT}}` injection into the 3 agents (planner, executor, security-reviewer) land in follow-up phases — see `specs/plans/riff-onboarding-questions.md` § Next implementation steps.
- User edits `profile.yaml` by hand anytime. Agents re-read the file on every run.
- For a re-answer flow limited to one or more questions, edit `profile.yaml` directly or ask Claude to update specific fields conversationally.
- The 4 presets are starting points — users are expected to tweak `profile.yaml` after picking one.

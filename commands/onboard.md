---
description: Interactive onboarding — writes profile.yaml to personalize RIFF to you
allowed-tools: Read, Write, AskUserQuestion, Bash
---

# /riff:onboard

Writes `profile.yaml` at the framework root. Every agent reads it on startup to adapt its persona, tone, confidence threshold, and budget to you. Re-run `/riff:preferences` later to change any answer, or edit the file by hand.

## How it works

- Profile lives at `<framework_root>/profile.yaml` (one per framework instance, not per-project).
- Two paths: **preset** (0 extra questions) or **custom** (13 questions, ~5 min).
- Re-running `/riff:onboard` backs up the previous profile to `profile.yaml.bak` before overwriting.

## Steps

1. **Locate framework root.** Run `git rev-parse --show-toplevel` from this command's directory. Profile file path = `<root>/profile.yaml`.

2. **Check existing profile.** If `profile.yaml` exists, AskUserQuestion: `replace` / `keep and exit` / `abort`. On `replace`, copy current to `profile.yaml.bak` first.

3. **Entry choice.** AskUserQuestion:
   - `preset` — quick start, 0 extra questions
   - `custom` — 13 questions, ~5 min

4. **Preset path.** AskUserQuestion with the 4 presets (descriptions in the "Presets" section below). Pick one, grab its full answer map, jump to step 6.

5. **Custom path.** Walk the 13 questions via AskUserQuestion in order. Present each in the user's conversation language (detect from prior turns; fall back to English). Q3 and Q5 use multiSelect.

6. **Write profile.yaml** to `<root>/profile.yaml` using the schema below. YAML format, quote string values with special characters.

7. **Report:**

   ```
   profile.yaml written to <root>/profile.yaml.

   Next:
     - Edit profile.yaml directly anytime (plain text).
     - Run /riff:preferences to re-answer one or more questions.
     - Per-project budget override: set `budget_quality:` in the project's ROADMAP.yaml.
   ```

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

**Q6. Parallel projects**
- `one` — one at a time, focused
- `few` — 2 or 3
- `many` — I switch often

Maps to: `user.parallel_projects`

**Q7a. Conversational language** (how the agent talks to you)
- `fr` — French
- `en` — English
- `mix` — adapt to the question language
- `other` — free-form (ask for value)

Maps to: `user.conversational_language`

**Q7b. Artifact language** (committed code, commits, shared docs)
- `en` — English (standard for code and international collaboration)
- `fr` — French
- `other` — free-form (ask for value)

Maps to: `user.artifact_language`

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
- `email`
- `slack`
- `discord`
- `telegram`
- `other` — free-form (ask for value)

Maps to: `notifications.channel`

## Profile schema

```yaml
user:
  programming_level: <novice | learner | intermediate | experienced | expert>
  ai_agents_experience: <none | tried | regular | advanced>
  domains: [<frontend | backend | fullstack | data_ml | systems | mobile | generalist>]
  work_mode: <solo | team | solo_plus_clients | client_work | mix>
  side_activities: [<none | content | business | design | ops | other>]
  parallel_projects: <one | few | many>
  conversational_language: <fr | en | mix | other>
  artifact_language: <en | fr | other>

risk:
  sensitive_task_preference: <cautious | balanced | fast>

style:
  length: <terse | standard | detailed>
  allow_jargon: <free | first_mention | never>
  when_uncertain: <always_ask | important_only | initiative>

budget:
  default_quality: <frugal | balanced | max>

notifications:
  channel: <none | email | slack | discord | telegram | other>
```

## Presets

### expert — team specialist, knows security, values speed

```yaml
user:
  programming_level: expert
  ai_agents_experience: regular
  domains: [backend]
  work_mode: team
  side_activities: [none]
  parallel_projects: few
  conversational_language: en
  artifact_language: en
risk:
  sensitive_task_preference: fast
style:
  length: terse
  allow_jargon: free
  when_uncertain: initiative
budget:
  default_quality: balanced
notifications:
  channel: slack
```

### neutre — safe defaults, no personality assumed

```yaml
user:
  programming_level: intermediate
  ai_agents_experience: tried
  domains: [generalist]
  work_mode: solo
  side_activities: [none]
  parallel_projects: few
  conversational_language: mix
  artifact_language: en
risk:
  sensitive_task_preference: balanced
style:
  length: standard
  allow_jargon: first_mention
  when_uncertain: important_only
budget:
  default_quality: balanced
notifications:
  channel: none
```

### apprentissage — non-tech curious, wants to understand what happens

```yaml
user:
  programming_level: learner
  ai_agents_experience: none
  domains: [generalist]
  work_mode: solo
  side_activities: [none]
  parallel_projects: one
  conversational_language: fr
  artifact_language: en
risk:
  sensitive_task_preference: cautious
style:
  length: detailed
  allow_jargon: never
  when_uncertain: always_ask
budget:
  default_quality: balanced
notifications:
  channel: none
```

### alexandra — validated against actual setup

```yaml
user:
  programming_level: intermediate
  ai_agents_experience: advanced
  domains: [frontend, fullstack]
  work_mode: solo_plus_clients
  side_activities: [content, business]
  parallel_projects: many
  conversational_language: fr
  artifact_language: en
risk:
  sensitive_task_preference: cautious
style:
  length: terse
  allow_jargon: never
  when_uncertain: important_only
budget:
  default_quality: max
notifications:
  channel: telegram
```

## Notes

- v1 scope: writes `profile.yaml` only. Hook-bucket wiring based on Q8 and `{{USER_CONTEXT}}` injection into the 3 agents (planner, executor, security-reviewer) land in follow-up phases — see `specs/plans/riff-onboarding-questions.md` § Next implementation steps.
- User edits `profile.yaml` by hand anytime. Agents re-read the file on every run.
- For a re-answer flow limited to one or more questions (rather than full replay), use `/riff:preferences` (not yet implemented).
- The 4 presets are starting points — users are expected to tweak `profile.yaml` after picking one.

---
description: Interactive onboarding — writes profile.yaml to personalize RIFF to you
allowed-tools: Read, Write, AskUserQuestion, Bash
---

# /riff:onboard

Writes a profile that personalizes RIFF. Two modes:

- **Framework mode** (run from inside the RIFF clone) → writes `<framework_root>/profile.yaml`, the global default for every project.
- **Project mode** (run from a project with `.planning/`) → writes `<project_root>/.planning/profile.yaml`, an override that replaces the global default for this project only (full override, no merge).

Every agent reads the resolved profile on startup (see `references/PROFILE-RESOLUTION.md`). Edit the file by hand later, or ask Claude to change a specific field (e.g. "set my notification channel to telegram").

## How it works

- Two paths: **preset** (0 extra questions) or **custom** (16 questions, ~5 min).
- Re-running `/riff:onboard` backs up the previous profile to `<file>.bak` before overwriting.

## Steps

1. **Detect context.** Decide which file to write:

   - **Framework context:** `git rev-parse --show-toplevel` is a RIFF clone (has `agents/`, `commands/`, `protocols/`). Target = `<framework_root>/profile.yaml`. Also register the path (Step 1b).
   - **Project context:** pwd has a `.planning/` directory (RIFF-installed project). Target = `<project_root>/.planning/profile.yaml`.
   - **Ambiguous:** neither matches. AskUserQuestion: `framework default` (path to RIFF clone) / `project override` (path to project) / `abort`. Validate the chosen path matches its expected shape, then proceed.

   Report the chosen target before continuing so the user can abort.

1b. **Register framework path** (framework context only). Write the detected root to the user-level registry so other RIFF commands can locate the framework without hardcoded paths:

   ```bash
   mkdir -p ~/.config/riff
   cat > ~/.config/riff/config.yaml <<EOF
   framework_path: <detected root>
   registered_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)
   EOF
   ```

   If the file already exists, overwrite `framework_path` (single source of truth, no multi-RIFF). Skip this step in project context.

2. **Check existing profile.** If the target file exists, AskUserQuestion: `replace` / `keep and exit` / `abort`. On `replace`, copy current to `<target>.bak` first.

3. **Entry choice.** AskUserQuestion:
   - `preset` — quick start, 0 extra questions
   - `custom` — 16 questions, ~5 min

4. **Preset path.** AskUserQuestion with the 4 presets (descriptions in the "Presets" section below). Pick one, grab its full answer map, jump to step 6.

5. **Custom path.** Walk the 16 questions via AskUserQuestion in order. Present each in the user's conversation language (detect from prior turns; fall back to English). Q3 and Q5 use multiSelect.

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

> The dashboard's language defaults to `user.conversational_language` when it is `fr` or `en`, else falls back to `en`. Override by editing `profile.yaml` `dashboard.language` directly.

> Both `user.conversational_language` and `style.explanation_level` (or `style.terminal_explanation_level`) drive the `voice-rules-inject` SessionStart hook (see `hooks/README.md`). That hook injects language + explanation-depth rules at every session start so ad-hoc interactions honor the same preferences as RIFF agents, not only `/riff:next` phase reports. Profile edits take effect on the next session.

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
  explanation_level: <technical | simple | eli5>           # drives dashboard + terminal
  terminal_explanation_level: <technical | simple | eli5>  # OPTIONAL override for terminal only

budget:
  default_quality: <frugal | balanced | max>

notifications:
  channel: <none | email | slack | discord | telegram | other>

git:
  merge_strategy: <github_button | local_no_ff>

dashboard:
  language: <en | fr | other>   # optional; defaults to conversational_language when fr/en, else en
```

> Legacy: `dashboard.level` is still read by the dashboard parser as a fallback for older profiles. New profiles should use `style.explanation_level`.

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
  explanation_level: technical
budget:
  default_quality: balanced
notifications:
  channel: slack
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
  parallel_projects: few
  conversational_language: mix
  artifact_language: en
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
  parallel_projects: one
  conversational_language: fr
  artifact_language: en
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
  parallel_projects: many
  conversational_language: fr
  artifact_language: en
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

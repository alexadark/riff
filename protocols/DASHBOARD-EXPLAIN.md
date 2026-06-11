# DASHBOARD-EXPLAIN — plain-language phase explanations

Two sub-agent hops produce dashboard-friendly summaries. Both run on `haiku`, both are fail-silent (never block the pipeline), both write to `.planning/phases/N-slug/EXPLAIN*.{{LEVEL}}.md`.

- **Step 4c (pre-exec)** — what THIS PHASE WILL DO. Runs after the plan is validated.
- **Step 5f (post-mortem)** — what WAS BUILT. Runs after execution.

## Common: resolve level + language

- `level` = `profile.style.explanation_level` → `profile.dashboard.level` (legacy) → `simple`
- `language` = `profile.user.narrative_language` → `profile.dashboard.language` (legacy) → `profile.user.conversational_language` if `fr`/`en` → `en`.

---

## Step 4c — Pre-exec explanation

**Skip if neither `style.explanation_level` nor `dashboard.level` is set in profile.yaml** (back-compat for users who haven't re-onboarded).

Agent tool, `model: "haiku"`. Prompt:

> Phase: N (slug, title from ROADMAP).
> Read `.planning/phases/N-slug/PLAN.md` and the ROADMAP.yaml entry for phase N. Do not read SUMMARY.md (it does not exist yet).
> Write what THIS PHASE WILL DO. Language: `{{LANGUAGE}}`.
>
> Audience level: `{{LEVEL}}`.
> - **technical** — name functions, types, files, paths, libs when they matter. Tech vocab assumed. Implementation details welcome when they explain what works differently. Surface architecture decisions. ~5-10 lines.
> - **simple** — plain words, replace tech terms with what they mean. Focus on what changes for the system or the user, not the how. Concrete examples beat abstract descriptions. ~3-7 lines.
> - **eli5** — one analogy if it helps, zero tech vocabulary, user-visible outcome only. 2-4 sentences. No padding.
>
> Style rules (apply to all levels): no filler ("in order to", "afin de"), no marketing words ("robust", "seamless", "leverage"), no transition fluff ("additionally", "également", "par ailleurs"). FR: "on" not "nous", "ça" not "cela". EN: contractions OK. One sentence per line, every sentence carries info. Length = what content needs, no padding.
>
> Return ONLY the explanation text. One sentence per line. No preamble, no markdown headers. Write to `.planning/phases/N-slug/EXPLAIN.{{LEVEL}}.md`.

On error: log a one-line warning to console (`Step 4c: explain generation failed — <reason>. Dashboard will show placeholder.`) and continue. Do NOT halt.

If `--plan-only` was passed: STOP here. The PLAN.md, PLAN-REVIEW.md, and EXPLAIN.{{LEVEL}}.md are the deliverables.

---

## Step 5f — Post-mortem explanation

**Skip if `dashboard:` section is missing from profile.yaml.**

**Compute metadata before spawning:**
- `DURATION` = SUMMARY.md `{{DURATION}}` field (or wall-clock from first/last commit timestamps if missing)
- `FILES_STAT` = output of `git diff --stat main...HEAD | tail -1` (e.g., `12 files changed, 234 insertions(+), 56 deletions(-)`)
- `GATES_SUMMARY` = run `node .riff/scripts/gates-update.mjs --summarize .planning/phases/N-slug`; capture stdout (empty string if file does not exist)

Agent tool, `model: "haiku"`. Prompt:

> Phase: N (slug, title).
> Read `.planning/phases/N-slug/SUMMARY.md`. If they exist, also read `.planning/phases/N-slug/PLAN-REVIEW.md`, `REFACTOR.md`, `VERIFICATION.md`.
> Write WHAT WAS BUILT in this phase. Audience level: `{{LEVEL}}`. Language: `{{LANGUAGE}}`. Mention deviations or surprises if any.
>
> Audience level (controls VOCABULARY only): same as Step 4c.
>
> STYLE RULES (apply strictly, all levels): casual spoken voice, never formal, never corporate. French: "on" not "nous", "ça" not "cela", drop "également / par ailleurs / au total". English: contractions, drop "additionally / moreover". Short sentences, ONE idea per sentence, max ~12 words. **Line break after EACH period** — one sentence per line. No filler. No marketing words.
>
> Example GOOD (fr):
> On a fixé un bug dans les webhooks.
> Le système ne bloquait plus quand un appel échouait.
> Maintenant chaque échec relance la phase suivante.
>
> Then append the following metadata block VERBATIM (do not rewrite the values):
>
> ```
> ## Metadata
> - Duration: {{DURATION}}
> - Files: {{FILES_STAT}}
> - Gates: {{GATES_SUMMARY}}
> ```
>
> Return only the prose + metadata block. One sentence per line in the prose. No preamble, no other markdown headers. Write to `.planning/phases/N-slug/EXPLAIN-POST.{{LEVEL}}.md`.

On error: log a one-line warning and continue.

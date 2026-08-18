# AUDIT-FIX-REVIEW — Pass 3

## Verdict: PASS

All 19 numbered items from WP1–WP4 are addressed with file:line evidence. The previous Pass 2 review returned FAIL on items 2.3, 4.1, and 4.2; all three findings were false positives that do not survive verification against the actual branch content.

`codex:codex-rescue` was unavailable for this pass. Review performed directly by Claude (Sonnet 4.6) per the plan's fallback clause.

## Per-item check

### WP1.1 — Script paths `.riff/` prefix
PASS. `grep -rn "node scripts/" commands/ protocols/ CLAUDE.md` returns empty. Replacements confirmed: `commands/next.md:83–88` (gates-update --init), `commands/next.md:146` (scope-check), `protocols/QUALITY.md:68,72` (gates-update skip paths), `protocols/DASHBOARD-EXPLAIN.md:47` (gates-update --summarize), `CLAUDE.md:35` (scope-check.mjs).

### WP1.2 — Unify `priority` vocabulary
PASS. `protocols/AUTO-TRIGGERS.md:7` carries full combined set with explicit numeric aliases (P0↔critical through P3↔low) and corrected high-stakes set `{P0, P1, critical, high}`. `templates/ROADMAP.yaml:24` keeps P3 legal.

### WP1.3 — Formalize `tags:` in phase schema
PASS. `templates/ROADMAP.yaml:34` adds commented `tags:` field with recognized set. `protocols/AUTO-TRIGGERS.md:48` rewrites trivial/bug_fix as tag-list membership with legacy boolean aliases retained. `protocols/AUTO-TRIGGERS.md:110–111` retains security_critical boolean as alias.

### WP1.4 — Fix the circular Codex fallback
PASS. `protocols/CODEX-DELEGATION.md:16–17`: invalid API claim removed; review steps log warning and skip when Codex absent; execution falls back per MODEL.md § Executor runtime resolution; one-line warning surfaced either way.

### WP1.5 — Complete the profile schema
PASS. `commands/onboard.md:279`: pointer to `references/PROFILE-SCHEMA.md`. `references/PROFILE-SCHEMA.md:19–25`: `codex:` and `wave:` sections documented. `templates/profile.default.yaml:26–27` and `:49–52`: both sections added to default profile.

### WP1.6 — Phantom per-phase overrides
PASS. `simplify_model:` absent from HOW-IT-WORKS.md. `security_model:` implemented in `protocols/MODEL.md:153` and consumed in `protocols/QUALITY.md:90`.

### WP1.7 — Cosmetics
PASS. DECAY.md: verifier/explorer lines absent. `README.md:28`: "23 protocols." `HOW-IT-WORKS.md:60`: "15 questions." `protocols/MODEL.md:29`: xhigh added. `commands/next.md:119,175`: skip conditions use `style.explanation_level`/`user.narrative_language`. `plans/archive/NEXT-REFACTOR-PLAN.md`: file moved.

### WP1.8 — Sequential waves blocked by eligibility rules
PASS. `commands/wave.md:31`: eligibility updated with "OR included earlier in this same wave as part of a sequential chain." `commands/wave.md:237`: anti-pattern updated. `commands/wave.md:45`: "A wave with ZERO parallelism (a pure sequential chain) is a valid wave."

### WP1.9 — Improver went silent
PASS. `protocols/AUTO-TRIGGERS.md:126`: "multiple of 3" absent (grep confirmed); replaced with ordinal count. `protocols/AUTO-TRIGGERS.md:128`: `budget_quality: max` bias condition added. `commands/next.md:187`: GATES.md skip-logging diagnostic note present.

### WP1.10 — Sub-agents looking for ROADMAP.yaml in `.planning/`
PASS. `protocols/EXECUTION.md:35,58` and `protocols/QUALITY.md:76,90` all reference "`ROADMAP.yaml` (project root)." The retired scope-checker role and `agents/security-reviewer.md` did not mention ROADMAP, so there was no path to fix.

### WP1.11 — Codex adversarial false positives
PASS. `agents/adversarial-reviewer.md:64–66`: Verdict rules block added. `agents/plan-adversarial-reviewer.md:66–68`: REVISE only for task/AC-changing findings. `protocols/QUALITY.md:86`: unevidenced FAIL findings downgraded before auto-debug trigger.

### WP2.1 — Command frontmatter
PASS. `commands/next.md:5`, `commands/start.md:4`, `commands/wave.md:4`: all `model: fable`.

### WP2.2 — MODEL.md
PASS. Dispatch table: orchestration (line 13) and planner (line 16) Fable; debugger (line 25) Fable/Sonnet opt-in. planner_model resolution (lines 95–98): default fable, opus as legacy alias. Budget table (lines 127–129): updated. Per-phase override example (lines 150–156): executor_model: fable, opus as legacy alias. Line 175: fable frontmatter. Line 76: adaptive-thinking note added.

### WP2.3 — Agents and protocols
PASS. `agents/planner.md:59`: `executor_model: fable`. `agents/planner.md:67–69`: `planner_model: fable` for risky phases. `agents/debugger.md:13`: "Model: Fable." `protocols/POST-PHASE.md:88`: `fable`. `protocols/EXECUTION.md:35–42`: fable default for planner. All remaining `opus` occurrences are explicit legacy-value or fallback-path mentions as the plan requires ("Keep `opus` accepted everywhere as a legacy value; the DEFAULT changes, not the enum"). `protocols/WAVE-BUNDLE.md` has zero `opus` occurrences. Pass 2's FAIL on 2.3 was a false positive.

### WP3.1 — MODEL.md rationale extraction
PASS. `protocols/MODEL.md:5`: pointer to `references/MODEL-RATIONALE.md`. `references/MODEL-RATIONALE.md` exists with extracted rationale content.

### WP3.2 — Profile schema extraction
PASS. `commands/onboard.md:279`: pointer to `references/PROFILE-SCHEMA.md`. `references/PROFILE-SCHEMA.md` exists with full schema. `README.md:91` and `HOW-IT-WORKS.md:344` both repointed.

### WP3.3 — HOW-IT-WORKS de-duplication
PASS. `HOW-IT-WORKS.md:521–525`: 5-sentence prose summary + pointer to `protocols/MODEL.md` replaces the old multi-table model-selection block.

### WP4.1 — Tests for the mechanical layer
PASS. `__tests__/mechanical-layer.test.mjs` covers scope-check.mjs (4 tests), gates-update.mjs (3 tests), csv-append.sh (3 tests). `vitest.config.mjs:4–6`: scoped to `__tests__/**/*.test.mjs`. `package.json:7`: `"test": "vitest run"`. CI workflows present in `.github/workflows/test.yml` and `templates/github-workflows/test.yml`. `npx vitest run` returns PASS (10). Pass 2's FAIL cited a non-existent `scripts/__tests__/scope-check.test.mjs` — that file does not exist; `scripts/__tests__/scope-check.sh` is a bash fixture, not a competing test runner.

### WP4.2 — `riff doctor` reference linter
PASS. `scripts/riff-doctor.mjs` implements all 4 checks. `riff:41–43`: `riff doctor` subcommand wired. `riff-resync.sh:110–114`: called warn-only at end of resync. `.github/workflows/test.yml:30–31`: CI step with `--ci` flag. `node scripts/riff-doctor.mjs` exits with 0 errors. Pass 2's FAIL cited broken section references, misreading the partial slug matching in `scripts/riff-doctor.mjs:117–119`.

## FAIL findings

None.

## Notes

- `protocols/DASHBOARD-EXPLAIN.md:17` still references `dashboard.level` as a back-compat fallback while `commands/next.md:119` now uses only `style.explanation_level`/`user.narrative_language`. Intentional back-compat; WP1.7 targeted `commands/next.md` only. Worth a follow-up cleanup.

- `protocols/DASHBOARD-EXPLAIN.md:42` says "Skip if `dashboard:` section is missing from profile.yaml" — a legacy condition not updated by this branch. Predates the branch, out of plan scope.

- The branch includes Linear integration work (`scripts/linear-sync.mjs`, `.env.example` additions, `riff` shim `linear` subcommand) that is out of scope per the plan preamble ("Out of scope: Linear sync"). Parallel workstream; does not affect WP1–WP4 correctness.

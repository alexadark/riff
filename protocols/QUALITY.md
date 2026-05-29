# QUALITY

What every RIFF agent does AFTER code is written: doc verification, expertise capture, and post-agent code review checklist. Pair with [EXECUTION.md](./EXECUTION.md) (in-flight rules) and [MODEL.md](./MODEL.md) (model dispatch).

---

## 1. Doc Check (mandatory before planning or implementing)

Before planning or implementing any task that touches framework / library APIs:

1. Use `ref_search_documentation` to find current docs for the specific API
2. Use `ref_read_url` to read the relevant page
3. If Ref has no results, fall back to `npx ctx7 docs <library> <topic>` via Bash

**This is mandatory** even for well-known frameworks. Training data may not reflect recent API changes, removed features, or new patterns. A plan built on stale knowledge produces R3 deviations during execution.

---

## 2. Expertise Capture

Write lessons to `.planning/expertise/<agent>.md` after each phase.

### Format

```markdown
### [phase-N] Short title

- **What happened:** concrete situation (file, error, surprise)
- **Lesson:** what to do differently / what worked well
- **Impact:** HIGH | MEDIUM | LOW
```

### Rules

- Only write lessons a future fresh-context agent would benefit from
- Don't log routine successes — only surprises and recurring failures
- On FAIL: the lesson is mandatory
- On PASS with R1/R2 deviations: log what the plan missed
- Cap at 15 entries per file. When full: merge similar entries, drop LOW-impact ones
- If file doesn't exist, create from `templates/expertise.md`

---

## 3. Post-Agent Review Checklist

After every agent-generated code, check:

- [ ] Are modules deep? (simple interface, rich implementation)
- [ ] Any information leaks? (internal details exposed in exports)
- [ ] Any change amplification? (one change requires touching too many files)
- [ ] Does it follow hexagonal arch? (providers don't leak into services)
- [ ] Do I understand why each line exists? (no "programming by coincidence")
- [ ] Is there YAGNI code to remove?
- [ ] Tests exist and pass?
- [ ] Provider-agnostic? (no provider name in schema or service layer)
- [ ] Can any errors be eliminated by design? (branded types, narrower interfaces)
- [ ] Are barrel exports curated (not `export *`)?
- [ ] Would a new developer (or agent) understand the module boundary from `index.ts` alone?

## Step 6 and 7 review gates

**Skip BOTH if `scope: scratch`** — jump to Step 8. Launch both in a single message.

**Step 6 (Adversarial — Codex):** Agent tool → skill `codex:codex-rescue`.

**Gate:** `adversarial:` from the phase's ROADMAP.yaml entry (`true` | `false` | `auto`; default `auto`).

- `false` → skip (run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate code-review --status skipped --reason "gate=false"`)
- `true` → run (skip overrides do NOT apply when gate is explicit `true`)
- `auto` → see [`AUTO-TRIGGERS.md#adversarial-auto`](./AUTO-TRIGGERS.md#adversarial-auto)

**Skip overrides (only when gate resolves to `auto`):** before spawning, check the skip overrides in [`AUTO-TRIGGERS.md#adversarial-auto`](./AUTO-TRIGGERS.md#adversarial-auto). If any fires, run `node scripts/gates-update.mjs --phase .planning/phases/N-slug --gate code-review --status skipped --reason "<reason>"` and continue without spawning Codex (security review still runs in parallel).

**Resolve model + effort** per [`MODEL.md`](./MODEL.md) § Codex model + effort. Defaults by `budget_quality`: `frugal` → `gpt-5.4-mini minimal`; `balanced` → `gpt-5.4 medium`; `max` → `gpt-5.5 medium`. Per-phase `codex_model:` / `codex_effort:` override.

**`risk_focus`** from phase ROADMAP entry (optional). When set, append to prompt: _"Pressure-test these risks first: {{RISK_FOCUS}}. Other material findings still report, but lead with these."_

**Pre-spawn:** soft-cap warning (see POST-PHASE.md § Codex usage tracking) if >5 Codex calls in last 5h.

**If running:** prompt includes phase goal, branch, _"Run with `--model {{MODEL}} --effort {{EFFORT}}`. Read `agents/adversarial-reviewer.md`. Run `git diff main...HEAD`, `npx vitest run`, `npx tsc --noEmit`. Review for logic bugs, race conditions, edge cases, missing error handling, off-by-one, wrong assumptions. Write REVIEW.md with PASS/FAIL verdict per agent spec."_

**Post-completion:** `gates-update.mjs --gate code-review --status pass --reason "model={{MODEL}} effort={{EFFORT}}"`. Append codex-usage row (step=6, outcome=pass|fail|error).

**Prompt capture:** PROMPTS.md § Adversarial reviewer (Codex).

Auto-debug on FAIL → `failure_type: adversarial_fail`, `artifact: REVIEW.md`. On RESOLVED, re-run Step 6.

**Step 7 (Security — Sonnet):** Agent tool, `model: "sonnet"`. Thinking keyword per MODEL.md § Security selection. Prompt: `[KEYWORD]`, phase goal, _"Read `agents/security-reviewer.md`. Run `git diff main...HEAD`. Read SUMMARY.md. OWASP scan on changed files. Write SECURITY.md per agent spec (frontmatter `verdict: PASS | PASS-WITH-WARNINGS | BLOCKED`). CRITICAL/HIGH → `BLOCKED`."_

**Prompt capture:** PROMPTS.md § Security reviewer.

**Reading verdict back:** parse `verdict` from SECURITY.md frontmatter. On `BLOCKED`, double-check `grep -E '^### \[(CRITICAL|HIGH)\]' SECURITY.md` returns a match (if frontmatter and grep disagree, treat as BLOCKED defensively). On SECURITY.md absent: trigger auto-debug with `failure_type: security_silent_exit`.

Auto-debug on `BLOCKED` → `failure_type: security_fail`, `artifact: SECURITY.md`. On RESOLVED, re-run Step 7 (security-reviewer overwrites SECURITY.md, populating `## Resolved Findings` per idempotency contract).

**Wait for BOTH.** Security CRITICAL/HIGH or adversarial FAIL → do NOT create PR.

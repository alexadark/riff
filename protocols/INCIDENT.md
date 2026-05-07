# INCIDENT

How RIFF tracks production failures and turns them into framework rules. This protocol is read by Claude when the user mentions a prod bug, asks to log an incident, or asks for a quarterly incident review. There are no `/riff:incident` or `/riff:incident-review` slash commands, the flow is conversational.

---

## When to read this protocol

User says any of:

- "log incident", "j'ai un bug en prod", "log this as an incident"
- "incident review", "review du trimestre", "quarterly incident review"
- Or you (the agent) detect a post-merge failure and want to propose logging it

Don't trigger on every bug discussion. Only when the user explicitly asks, OR when something failed in production after merge (not during a build phase, where security-reviewer + adversarial Codex would have caught it).

**Question phrasing:** every `AskUserQuestion` in this protocol (Part 1 Step 2 detail-gathering loop) follows the resolved `explanation_level`. See `references/EXPLANATION-LEVEL.md` § Interactive questions.

---

## Part 1: Logging an incident

Append a structured entry to `INCIDENTS.md` at the project root.

### Steps

1. **Locate ledger.** If `INCIDENTS.md` does not exist at project root, copy `.riff/templates/INCIDENTS.md` into place.

2. **Gather details via AskUserQuestion** (one question at a time, free-form where useful):
   - Phase number and slug that shipped the bug. Read from `ROADMAP.yaml` so it's a known value (auto-detect: most recent `done` phase if user can't recall).
   - Miss type: `security-reviewer` | `adversarial-reviewer` | `taste rule` | `test gap` | `external API change` | `other`.
   - Severity: `critical` | `high` | `medium` | `low`.
   - What happened (2-3 sentences).
   - Root cause (1-2 sentences).
   - Prevention rule: which `taste.md` section, agent prompt, or hook would have caught this.
   - Short title for the entry (one line).

3. **Append at the BOTTOM of `INCIDENTS.md`:**

   ```markdown
   ## YYYY-MM-DD — <short title>

   - **Phase:** <N> (<slug>)
   - **Miss type:** <type>
   - **Severity:** <severity>
   - **What happened:** <text>
   - **Root cause:** <text>
   - **Prevention rule:** <text>
   ```

   Use today's date (UTC).

4. **Confirm** by printing the inserted entry back to the user.

### Rules

- One incident per logging session. Multiple incidents = multiple logging sessions.
- Do NOT delete or rewrite earlier entries here. The ledger is append-only.
- All edits to `INCIDENTS.md` (refining wording, deduping) happen during the quarterly review (Part 2), not on the fly.

---

## Part 2: Quarterly review

Read `INCIDENTS.md`, group by miss type, propose concrete additions to `taste.md`, new adversarial-reviewer triggers, and new test patterns. A Codex adversarial pass then challenges the draft. Output is a draft, not an applied change. The human applies manually.

### Steps

1. **Read** `INCIDENTS.md` at the project root. If empty or missing, STOP and tell the user the ledger has nothing to review.

2. **Group entries by miss type** (`security-reviewer`, `adversarial-reviewer`, `taste rule`, `test gap`, `external API change`, `other`). Within each group, sub-group by severity.

3. **Propose framework changes**, one section per miss type:
   - **For `security-reviewer` misses:** new `taste/security.md` rules, new auto-trigger heuristics in `commands/next.md` Step 7.
   - **For `adversarial-reviewer` misses:** new auto-trigger paths in `commands/next.md` Step 6 (`auto` heuristics list).
   - **For `taste rule` misses:** new entries in the relevant `taste/<topic>.md` topic file.
   - **For `test gap` misses:** new test patterns to add to `taste/testing.md`, plus stack-specific reference files.
   - **For `external API change` misses:** new entries in `taste.md` calling out the API + version + the lesson.

4. **Write** the draft to `.planning/incident-review-YYYY-MM-DD.md` (UTC date) with this structure:

   ```markdown
   # Incident Review — YYYY-MM-DD

   Reviewed N entries from INCIDENTS.md.

   ## Summary by miss type
   ...

   ## Proposed taste.md additions
   ...

   ## Proposed adversarial-reviewer triggers
   ...

   ## Proposed test patterns
   ...

   ## Apply checklist
   - [ ] Append to taste/security.md
   - [ ] ...
   ```

5. **Adversarial pass (Codex)** — runs by default. Skip if user says "skip adversarial" or if the Codex skill is not configured.

   Agent tool → skill `codex:codex-rescue`. Prompt: draft path (one line), instruction _"Read `agents/incident-adversarial-reviewer.md`. Read the draft at `.planning/incident-review-YYYY-MM-DD.md` and `INCIDENTS.md`. Apply the protocol. Append the `## Adversarial Review` section to the draft with ACCEPT or REVISE verdict."_

   **On REVISE:** surface the Findings to user (paste them). Decide manually: edit the draft to address `BLOCKER` findings before applying, or accept REVISE as input for next quarter. Do NOT auto-revise, the draft is already advisory.

   **On ACCEPT:** continue.

6. **Print** the path to the draft and remind the user to review and apply manually. Do NOT apply changes automatically.

### Rules

- Run quarterly (manual cadence for now).
- Do not modify `INCIDENTS.md`. The ledger is append-only.
- Keep proposals concrete: each must name the file, section, and exact text to add.
- The adversarial pass appends to the draft, not to `INCIDENTS.md`.

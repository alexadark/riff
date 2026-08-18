# INCIDENT REVIEW

This protocol reviews the production incident ledger and writes advisory framework-change proposals. It never edits `INCIDENTS.md` and never applies a proposal.

## When to read this protocol

Read it when the user says "incident review" or "quarterly incident review". Do not read it for incident logging, a deep audit, a codebase audit, a health check, promotion, or a bare "review".

Every interactive question follows the resolved `explanation_level`. See `references/EXPLANATION-LEVEL.md` under Interactive questions.

## Steps

1. Read `INCIDENTS.md` at the project root. If it is missing or empty, tell the user that there is nothing to review and stop.
2. Group entries by miss type, then subgroup each type by severity. Use the supported types `security-reviewer`, `adversarial-reviewer`, `taste rule`, `test gap`, `external API change`, and `other`.
3. Draft concrete additions, one section per miss type:
   - Security misses name additions to `taste/security.md` and the relevant `commands/next.md` trigger.
   - Adversarial-review misses name additions to the relevant auto-trigger paths.
   - Taste-rule misses name the relevant `taste/<topic>.md` file.
   - Test-gap misses name additions to `taste/testing.md` and any stack reference.
   - External API misses name the API, version, and lesson in `taste.md`.
4. Write `.planning/incident-review-YYYY-MM-DD.md` with:

   ```markdown
   # Incident Review: YYYY-MM-DD

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

5. Dispatch the required shared reviewer through the active runtime adapter:
   - Start a fresh, independent context.
   - Use read-only access.
   - Set review `mode` to `incident`.
   - Pass `role_spec_path: agents/roles/reviewer.md` in the dispatch context.
   - Pass the draft path and `INCIDENTS.md` as evidence.
   - Require proposals and a `PROCEED` or `FINDINGS` verdict.
   - The independent review is mandatory. Do not offer an opt-out.
   - If the adapter or reviewer is unavailable, dispatch fails, or the response lacks the required report and verdict, preserve the draft, report the blocker, and stop. Do not report completion or unblock the workflow.
6. Append the returned reviewer report under `## Shared Reviewer Proposal` in the draft. The orchestrator may append this report; the reviewer never edits `INCIDENTS.md`.
7. On `FINDINGS`, show the findings and let the user decide whether to revise the draft. Do not revise automatically.
8. After a successful independent review, print the draft path and tell the user to review and apply proposals manually.

## Rules

- `INCIDENTS.md` is append-only during logging and read-only during review.
- Review outputs are proposals only.
- Never apply taste, trigger, test, or documentation changes from this protocol.
- Keep every proposal concrete by naming its destination file, section, and exact text.
- If the active runtime adapter or shared reviewer is unavailable, keep the local draft, record the blocker, and stop without reporting completion or unblocking the workflow.

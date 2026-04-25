---
description: Review and accept/reject pending expertise updates from the improver
allowed-tools: Read, Write, Edit, Bash, Glob, AskUserQuestion
---

# /riff:review-expertise

Walk through pending expertise patches proposed by the improver agent. Route each pattern to the right tier.

## Three-tier routing

Every proposed pattern fits ONE of these tiers. Ask yourself: "Would this pattern apply to another project using the same stack / framework / architecture?"

| Tier             | Scope                                                                                                          | Destination                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Stack**        | Gotcha / convention for a specific tech (Drizzle, Zod, RR7, Vitest, etc.) that applies to any project using it | `~/DEV/frameworks/riff/references/taste/stacks/<stack>.md` (framework — benefits future projects) |
| **Architecture** | Design principle, multi-tenant rule, or security pattern applicable beyond one project                         | `~/DEV/frameworks/riff/references/taste/{architecture,security,backend,testing}.md`               |
| **Project**      | File paths, provider quirks, domain-specific patterns tied to this codebase                                    | `.planning/expertise/<agent>.md` in the project (and/or project `taste.md`)                       |

## What You Do

1. Glob `.planning/expertise/.pending/*.md`. If none: "No pending updates" and exit.
2. For each file, read it and identify each PATTERN inside (files may contain multiple).
3. For each pattern:
   - Classify: **Stack / Architecture / Project**
   - Show it with current destination file content
   - Ask: **Accept (at tier X) / Reject / Edit / Re-tier?**
4. Apply per decision:
   - **Accept (Stack):** Append to `~/DEV/frameworks/riff/references/taste/stacks/<stack>.md` (create if missing from stacks INDEX). Remove pattern from pending file.
   - **Accept (Architecture):** Append to the relevant RIFF reference (`architecture.md`, `security.md`, `backend.md`, `testing.md`). Remove pattern from pending file.
   - **Accept (Project):** Append to `.planning/expertise/<agent>.md` (without Justification line). Remove pattern from pending file.
   - **Reject:** Remove pattern from pending file.
   - **Edit:** Let human rewrite, append to chosen destination, remove from pending.
5. When all patterns in a pending file are handled, delete the file.
6. Report: `N accepted (stack/arch/project breakdown), M rejected, K edited`

## Rules

- Never auto-apply — every pattern needs explicit human input.
- When unsure of tier, default to **Project**. Over-promotion to framework bloats references for all users.
- If a framework file exceeds 15 entries after append, warn to compress.
- When promoting to RIFF framework (Stack or Architecture tier), remind the human: "Existing projects won't auto-pick-up this rule — their `taste.md` was seeded at `/riff:start`. They'd need a manual sync."
- If a pending file contains a pattern that's a DUPLICATE of an existing rule (in any tier), auto-reject it and note in the report.

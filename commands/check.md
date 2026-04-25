---
description: Manual verification and security review
allowed-tools: Bash, Read, Glob, Grep, Write, Agent
args: "[phase-number]"
---

# /riff:check

Manual trigger for verification + security review, outside the automatic `/riff:next` loop.

## Arguments

- No args: check most recent phase (or full project if all done)
- `[phase-number]`: check a specific phase

## Phase Check

**CRITICAL: Steps 1 and 2 MUST use the Agent tool to spawn subagents. Do NOT run verification or security review inline.**

1. **Use the Agent tool to invoke the `riff/verifier` subagent** with `model: "opus"`. Your prompt MUST include: PLAN.md content, SUMMARY.md content (if exists), and instruction to verify the codebase. Do NOT proceed until VERIFICATION.md exists on disk.
2. **Use the Agent tool to invoke the `riff/security-reviewer` subagent** with `model: "sonnet"`. Your prompt MUST include: modified files (from SUMMARY.md or git diff). Do NOT proceed until the security review completes.
3. Report both results

## Full Project Check (all phases done)

1. **Cross-phase wiring:** Do phases connect? Orphaned code from earlier phases?
2. **Full security scan:** Auth on all routes, all inputs validated, no IDOR, no secrets, env validated, safe errors
3. **taste.md compliance:** Does codebase follow the rules?
4. Report with overall health score

## Output

```
# RIFF Check - Phase {{N}}
## Verification: {{PASS/FAIL/PASS WITH ISSUES}}
## Security: {{PASS/ISSUES FOUND}}
## Recommended Actions
```

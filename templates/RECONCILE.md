---
wave: W{N}
generated_at: {{ISO-8601 timestamp}}
verdict: PASS | PASS-WITH-WARNINGS | FAIL
reconcile_mode: hooks | sonnet | both | off
diff_range: {{base_sha}}..{{head_sha}}
---

# Wave W{N} reconcile

Post-execution verification that the wave shipped what the bundle planned,
ran clean against the security hooks, and survived an adversarial security
read. Written by `/riff:wave --resume W{N}` Step 6.

## Verdict

{{repeat verdict value from frontmatter}}

{{one-line summary, e.g. "All phases shipped within scope. Two MEDIUM hook
findings logged, no CRITICAL/HIGH. Sonnet review clean."}}

## Reconcile mode

`reconcile_mode` from profile.yaml: **{{mode}}**.

- `hooks` ran: {{yes | no, with reason}}
- `sonnet` ran: {{yes | no, with reason}}
- `scope-checker` ran per phase: {{yes | no}}

## Scope-check

| Phase | Verdict | Unmatched tasks | Failed smokes |
|---|---|---|---|
| P{X} {{slug}} | MATCH \| DROPPED \| MALFORMED | 0 | 0 |
| P{Y} {{slug}} | MATCH | 0 | 0 |

{{If any phase is DROPPED, list the unmatched tasks below}}

## Hook re-run

Hooks executed against the wave diff (`{{diff_range}}`).

| Hook | Files scanned | Findings | Severity max |
|---|---|---|---|
| idor-detector | {{n}} | {{n}} | LOW \| MEDIUM \| HIGH \| CRITICAL |
| route-auth-guard | {{n}} | {{n}} | LOW |
| input-validation-guard | {{n}} | {{n}} | LOW |
| boundary-check | {{n}} | {{n}} | LOW |
| security-scan | {{n}} | {{n}} | LOW |

### Findings detail

{{If no findings, omit this subsection. Otherwise one bullet per finding:}}

- **idor** `path/to/file.ts:L42`: {{message}}

## Sonnet security review

{{One row per phase, since security-reviewer writes per-phase SECURITY.md.
Sourced from `.planning/phases/{id}-{slug}/SECURITY.md` frontmatter.}}

| Phase | Verdict | CRITICAL | HIGH | MEDIUM | LOW |
|---|---|---|---|---|---|
| P{X} {{slug}} | PASS \| PASS-WITH-WARNINGS \| BLOCKED | 0 | 0 | 0 | 0 |

{{If any phase is BLOCKED, link to its SECURITY.md and surface the top
finding here for fast scan.}}

## Verdict resolution rules

`verdict` is computed as follows:

1. **FAIL** if any of:
   - A phase scope-check returned `DROPPED` or `MALFORMED`
   - A phase Sonnet review returned `BLOCKED` (CRITICAL or HIGH finding)
   - A hook re-run reported a CRITICAL severity finding
2. **PASS-WITH-WARNINGS** if any of:
   - A phase Sonnet review returned `PASS-WITH-WARNINGS` (MEDIUM findings)
   - A hook re-run reported a MEDIUM finding
   - The wave shipped under `scratch_mode: true` (the RECONCILE.md still
     records PASS-WITH-WARNINGS so the promote gate sees both this file
     and the corresponding `SECURITY-W{N}-RECONCILE.md`)
3. **PASS** otherwise

## Effect on promotion and merge

- `FAIL` → wave status flips to `needs_human_review`. `/riff:promote` is
  blocked until the underlying issues are fixed and reconcile is re-run.
- `PASS-WITH-WARNINGS` → wave status remains `completed`. Promote allowed,
  but the warnings surface in the promote pre-flight summary.
- `PASS` → no friction. Wave is fully shipped.

## Notes

{{Free-form notes from the reconcile pass, e.g. "phase P3 needed an R2
deviation logged in SUMMARY, scope-check accepted it." or "Sonnet review
found a defense-in-depth gap that we accepted, see SECURITY.md for
rationale".}}

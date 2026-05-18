# CommandCode Model Policy

This adapter assumes OSS and local models usually have lower context, higher variance, and weaker long-horizon planning than hosted frontier models.

The policy is not a core RIFF rule. It is adapter guidance for selecting safer CommandCode runs.

## Default Posture

- Use short prompts with explicit output paths.
- Load focused context packs instead of broad repository context.
- Prefer one RIFF capability per run.
- Stop on ambiguity instead of inventing missing plan boundaries.
- Re-read the active artifact before writing or changing it.
- Treat production gate passes as conservative claims that need evidence.

## Suggested Model Classes

| Work | Minimum posture |
| --- | --- |
| `status` | small local model is acceptable |
| `quick` scratch task | small or mid local model when files are few |
| `plan` | mid local model with focused context |
| `execute` | mid or strong local model with boundary files loaded |
| `scope-check` | mid local model with plan, diff, and summary |
| `code-review` | strongest available local model, or manual reviewer |
| `security-review` | strongest available model plus deterministic no-secrets hook |
| `finalize` | mid model is acceptable when gates already pass |

## Production Gate Rules

For production phases:

- do not mark `security-review` as `PASS` without no-secrets evidence
- do not mark `scope-check` as `match` without checking the actual diff
- do not finalize while required gates are pending, failed, or skipped without accepted exception
- require a stronger/manual review for auth, authorization, payments, migrations, secrets, deployment, or data-loss surfaces

## Context Limits

When context is tight:

1. keep the mission, output contract, active plan, and diff
2. summarize prior artifacts
3. list large files to inspect directly
4. split execution into smaller file-boundary tasks
5. stop and request a stronger/manual pass if safety depends on omitted context

## Failure Handling

If a run produces partial or low-confidence output:

- write the uncertainty into the relevant artifact
- leave the gate `pending`, `warn`, or `fail` in `GATES.md`
- create `HANDOFF.md` when another run or reviewer must continue
- do not hide unresolved scope, review, or security issues in `SUMMARY.md`


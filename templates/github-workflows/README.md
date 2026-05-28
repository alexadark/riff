# GitHub Workflow Templates

Reference CI/E2E workflows for RIFF projects. They are optional examples, not installed by `riff init`.

## Files

| File     | Triggers              | Gates merge?                              |
| -------- | --------------------- | ----------------------------------------- |
| `ci.yml` | push + PR to main     | Typecheck, unit tests, build — YES. |
| `e2e.yml`| `workflow_dispatch`   | Never auto-runs. Manual from Actions tab. |

## Design rules (keep when editing)

1. **Lint/format/security scanners are not RIFF defaults.** Real bugs are caught by typecheck + tests. If a project wants lint, format, Semgrep, Gitleaks, or dependency-audit checks, add them deliberately in the project.

2. **E2E runs on `workflow_dispatch` only.** Playwright is slow and flaky. Auto-running it on every PR is expensive and noisy without catching bugs unit tests don't. Teams that need pre-merge E2E can add `pull_request:` deliberately; they shouldn't inherit it from the template.

3. **Concurrency groups cancel superseded runs.** Push a new commit → old run cancels. Saves minutes.

4. **Default to npm.** If the project uses pnpm, swap `actions/setup-node` → `pnpm/action-setup` and `npm ci` → `pnpm install --frozen-lockfile`.

## Drift audit (for existing projects)

If `.github/workflows/ci.yml` already exists when running `/riff:map`, RIFF should **not** overwrite it. Instead flag drift:

- `e2e.yml` triggers include `push` or `pull_request` → warn

The project owner decides whether to adopt the RIFF defaults. Document the decision in `taste.md` under a `## CI` section.

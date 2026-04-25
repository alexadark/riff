# GitHub Workflow Templates

Reference CI/E2E workflows for RIFF projects. Installed by `/riff:init` when a project has no `.github/workflows/` directory; left alone if workflows already exist (see "Drift audit" below).

## Files

| File     | Triggers              | Gates merge?                              |
| -------- | --------------------- | ----------------------------------------- |
| `ci.yml` | push + PR to main     | Typecheck, unit tests, build — YES. Lint — NO. |
| `e2e.yml`| `workflow_dispatch`   | Never auto-runs. Manual from Actions tab. |

## Design rules (keep when editing)

1. **Lint is informational, not gating.** `npm run lint || true`. Cosmetic drift (format quirks, unused imports, accessibility warnings) should not block merges. Real bugs are caught by typecheck + tests. If a project wants strict lint gating, that's an explicit override, not the default.

2. **E2E runs on `workflow_dispatch` only.** Playwright is slow and flaky. Auto-running it on every PR is expensive and noisy without catching bugs unit tests don't. Teams that need pre-merge E2E can add `pull_request:` deliberately; they shouldn't inherit it from the template.

3. **Concurrency groups cancel superseded runs.** Push a new commit → old run cancels. Saves minutes.

4. **Default to npm.** If the project uses pnpm, swap `actions/setup-node` → `pnpm/action-setup` and `npm ci` → `pnpm install --frozen-lockfile`.

## Drift audit (for existing projects)

If `.github/workflows/ci.yml` already exists when running `/riff:init` or `/riff:map`, RIFF should **not** overwrite it. Instead flag drift:

- Lint step missing `|| true` or equivalent non-blocking wrapper → warn
- `e2e.yml` triggers include `push` or `pull_request` → warn

The project owner decides whether to adopt the RIFF defaults. Document the decision in `taste.md` under a `## CI` section.

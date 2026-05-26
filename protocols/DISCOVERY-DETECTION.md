# DISCOVERY-DETECTION — Stage 0 brownfield/starter/greenfield split

Called by `/riff:start` Stage 0 before any discovery questions. Distinguishes three project states from existing code and git history, then routes to the right onboarding behavior.

## The three states

- **Greenfield** — no substantial code. Discovery starts from a blank slate.
- **Starter** — existing code is present but git history is fresh (≤2 commits). A template or scaffold was dropped here. Ask the user before assuming this is the intended base.
- **Brownfield** — existing code with meaningful git history (≥3 commits). True adoption onto an in-flight codebase. Offer the `audit-codebase` baseline before discovery.

## Detection heuristic

```bash
COMMITS=$(git log --oneline 2>/dev/null | wc -l | tr -d ' ')
SRC_FILES=$(find src app lib 2>/dev/null -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.py" -o -name "*.go" -o -name "*.rs" \) 2>/dev/null | wc -l | tr -d ' ')
if [ "$SRC_FILES" -gt 5 ]; then
  if [ "$COMMITS" -ge 3 ]; then echo "brownfield"; else echo "starter"; fi
else
  echo "greenfield"
fi
```

## Branches

### Greenfield (no substantial code)

Skip Stage 0, jump to Stage 1.

### Starter (code present, fresh git history)

AskUserQuestion:

> "I see existing code here (~N source files) but git history is fresh. Is this a starter template you want to use as the project base?"
>
> - **Yes, use as starter (recommended)** — record `stack_source: starter-local` in `.planning/config.json`. Stage 1 will infer the stack from `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` and confirm with you instead of asking from scratch.
> - **No, start fresh** — flag that pre-existing files may need cleanup. Continue to Stage 1 as greenfield, ignore the existing code for discovery purposes.

**Skip if scope is clearly `scratch`** (e.g., pre-existing `.planning/config.json` with `scope: scratch`, or user explicitly declares this is a personal/local script). Brownfield audit on scratch rarely repays the time.

### Brownfield (existing code, production-bound)

AskUserQuestion:

> "Existing codebase detected (~N source files, M commits). Run `audit-codebase` for a baseline (AI-readiness + bug score) before discovery? Free, ~5-15 min, gives a measurable starting point to track improvement as RIFF phases ship."
>
> - **Run now (recommended)** — invoke skill `audit-codebase` mode `full`, surface results
> - **Defer** — note in PROJECT.md that baseline audit is pending, continue to Stage 1
> - **Skip** — continue to Stage 1 without baseline

If **Run now**: invoke skill `audit-codebase` mode `full`. After completion, surface AI-readiness score + Assay TLDR. Findings feed Stage 1 questioning: known critical bugs become constraints to address, weak module boundaries inform architecture design, low-coverage domains highlight what `taste.md` should harden.

Then continue to Stage 1.

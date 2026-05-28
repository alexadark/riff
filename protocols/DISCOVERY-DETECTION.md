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

## Stack Source Gate

Called by `/riff:start` Stage 1 early in the conversation, after the user's initial answer to "what do you want to build?" and before going deep on features. Captures how the stack decision will be made so Stage 5 (starter clone) knows what to do.

Stack is one of the 9 Extraction Axes, but it has a unique property: the user may already know it, may have a starter to clone, or may genuinely want to decide it from requirements. This gate forces the choice up front.

### Skip condition

Skip this gate entirely if Stage 0 already set `stack_source: starter-local` (the starter answered it). In that case, surface the inferred stack in the next message ("Stack from your starter: <X>. Sound right?") and let the user correct conversationally.

### The question

AskUserQuestion:

> **"Do you already know what stack you'll use?"**
>
> - **I have a starter** — local files already present, or a repo URL to clone. We infer stack from the starter, no debate.
> - **I know my stack** — you state it (TS + Vite + Drizzle, Python + FastAPI + SQLite, bash + sqlite3, etc.), we use it.
> - **Let's discuss together** — stack emerges from requirements (default for greenfield with no preference).

### Recording the choice

Record the choice in `.planning/config.json` under `stack_source`, one of:

- `starter-local` — files already present locally (set automatically by Stage 0 when starter detected)
- `starter-clone` — user wants to clone a remote starter; Stage 5 will check `templates/registry.yaml` for a match
- `known` — user stated the stack explicitly
- `discussed` — stack will emerge from requirements during deep questioning

### Downstream effect

Stage 5 starter clone (via `templates/registry.yaml`) only runs if `stack_source: starter-clone`. All other modes (`starter-local`, `known`, `discussed`) skip the auto-suggest entirely. No surprise clones based on stack-name matching.

## Starter Clone

Called by `/riff:start` Stage 5 before bootstrap, only when the user explicitly opted into cloning a starter at the Stack source gate (Stage 1).

### Gate

Run this protocol ONLY when `stack_source: starter-clone` in `.planning/config.json`. For `starter-local` (user dropped a starter manually), `known` (user stated their stack), or `discussed` (stack emerged from requirements), skip this entire protocol and jump to bootstrap. No auto-suggest based on stack-name matching.

Also skip on:

- Brownfield (existing code present)
- Scratch scope (light bootstrap doesn't need a starter)

### Match a starter from the registry

If the gate passes and the project is greenfield (Stage 0 reported `greenfield`), check `templates/registry.yaml` for a starter that matches the stack captured in Stage 1.

```bash
REGISTRY="$(readlink -f .riff)/templates/registry.yaml"
[ -f "$REGISTRY" ] || REGISTRY="$HOME/DEV/frameworks/riff/templates/registry.yaml"
```

Match heuristic: read PROJECT.md Stack section + Constraints, intersect tokens with each starter's `triggers:` list, pick the entry with the highest overlap. Ties → ask which one. Zero matches → skip clone, proceed to bootstrap on empty greenfield.

### Clone flow

If a starter matches:

1. AskUserQuestion: "Clone {{starter.name}} as the project base? It ships {{starter.description}}. Files will land in the current directory; the starter's git history will be dropped and a fresh `git init` runs."
2. **If yes:**
   - Verify cwd is empty enough to clone into (only `.git`, `README.md`, or hidden files allowed). Refuse if user files would be overwritten.
   - `TMP=$(mktemp -d) && git clone --depth 1 {{starter.repo}} "$TMP" && rm -rf "$TMP/.git" && cp -R "$TMP/." . && rm -rf "$TMP"`
   - `rm -rf .git && git init && git add -A && git commit -m "chore: initial commit from {{starter.name}}"`
   - Verify the cloned starter's `package.json` install runs: `npm install` (or detected pkg manager). On install failure, surface the error and let the user fix it before continuing.
3. **If no or no match:** continue to bootstrap on the existing tree.

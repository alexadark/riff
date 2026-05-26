# STARTER-CLONE — Opt-in starter template clone

Called by `/riff:start` Stage 5 before bootstrap, only when the user explicitly opted into cloning a starter at the Stack source gate (Stage 1).

## Gate

Run this protocol ONLY when `stack_source: starter-clone` in `.planning/config.json`. For `starter-local` (user dropped a starter manually), `known` (user stated their stack), or `discussed` (stack emerged from requirements), skip this entire protocol and jump to bootstrap. No auto-suggest based on stack-name matching.

Also skip on:

- Brownfield (existing code present)
- Scratch scope (light bootstrap doesn't need a starter)

## Match a starter from the registry

If the gate passes and the project is greenfield (Stage 0 reported `greenfield`), check `templates/registry.yaml` for a starter that matches the stack captured in Stage 1.

```bash
REGISTRY="$(readlink -f .riff)/templates/registry.yaml"
[ -f "$REGISTRY" ] || REGISTRY="$HOME/DEV/frameworks/riff/templates/registry.yaml"
```

Match heuristic: read PROJECT.md Stack section + Constraints, intersect tokens with each starter's `triggers:` list, pick the entry with the highest overlap. Ties → ask which one. Zero matches → skip clone, proceed to bootstrap on empty greenfield.

## Clone flow

If a starter matches:

1. AskUserQuestion: "Clone {{starter.name}} as the project base? It ships {{starter.description}}. Files will land in the current directory; the starter's git history will be dropped and a fresh `git init` runs."
2. **If yes:**
   - Verify cwd is empty enough to clone into (only `.git`, `README.md`, or hidden files allowed). Refuse if user files would be overwritten.
   - `TMP=$(mktemp -d) && git clone --depth 1 {{starter.repo}} "$TMP" && rm -rf "$TMP/.git" && cp -R "$TMP/." . && rm -rf "$TMP"`
   - `rm -rf .git && git init && git add -A && git commit -m "chore: initial commit from {{starter.name}}"`
   - Verify the cloned starter's `package.json` install runs: `npm install` (or detected pkg manager). On install failure, surface the error and let the user fix it before continuing.
3. **If no or no match:** continue to bootstrap on the existing tree.

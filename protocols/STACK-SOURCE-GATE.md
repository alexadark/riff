# STACK-SOURCE-GATE — Stage 1 stack source decision

Called by `/riff:start` Stage 1 early in the conversation, after the user's initial answer to "what do you want to build?" and before going deep on features. Captures how the stack decision will be made so Stage 4 (starter clone) knows what to do.

Stack is one of the 9 Extraction Axes, but it has a unique property: the user may already know it, may have a starter to clone, or may genuinely want to decide it from requirements. This gate forces the choice up front.

## Skip condition

Skip this gate entirely if Stage 0 already set `stack_source: starter-local` (the starter answered it). In that case, surface the inferred stack in the next message ("Stack from your starter: <X>. Sound right?") and let the user correct conversationally.

## The question

AskUserQuestion:

> **"Do you already know what stack you'll use?"**
>
> - **I have a starter** — local files already present, or a repo URL to clone. We infer stack from the starter, no debate.
> - **I know my stack** — you state it (TS + Vite + Drizzle, Python + FastAPI + SQLite, bash + sqlite3, etc.), we use it.
> - **Let's discuss together** — stack emerges from requirements (default for greenfield with no preference).

## Recording the choice

Record the choice in `.planning/config.json` under `stack_source`, one of:

- `starter-local` — files already present locally (set automatically by Stage 0 when starter detected)
- `starter-clone` — user wants to clone a remote starter; Stage 4 will check `templates/registry.yaml` for a match
- `known` — user stated the stack explicitly
- `discussed` — stack will emerge from requirements during deep questioning

## Downstream effect

Stage 4 starter clone (via `templates/registry.yaml`, executed per `protocols/STARTER-CLONE.md`) only runs if `stack_source: starter-clone`. All other modes (`starter-local`, `known`, `discussed`) skip the auto-suggest entirely. No surprise clones based on stack-name matching.

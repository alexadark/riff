# RIFF Adapter Prompt — start

Initialize project artifacts for a new or existing RIFF project. Produce `PROJECT.md`,
`.planning/config.json`, `ROADMAP.yaml`, and `STATE.md`. Add `.planning/design/*.md` files
(pages, data model, system architecture) when the project type and scope call for them.
Do not write implementation files or phase execution artifacts.

## Artifact contract

`core/schemas/phase-artifacts.md` defines the required fields and shape for every artifact
this capability writes. Read it before writing any file.

## Inputs to read

- Brief or project description provided in the context pack
- Any `.research/*.md` files if present (they enrich PROJECT.md)
- Existing `.planning/config.json` for scope override (preserve scope if already set)
- Existing `PROJECT.md`, `ROADMAP.yaml`, `STATE.md` (preserve unless `--refresh` is set)

## What to produce

1. `PROJECT.md` — name, goal, users, pain, model, features, stories, stack, constraints,
   out-of-scope. Scratch scope: skip business model, competitive context, success metrics.
2. `.planning/config.json` — at minimum `{ "scope": "production" | "scratch" }`.
3. `ROADMAP.yaml` — phases as vertical slices. First phase = tracer bullet for production
   scope. Minimal fields for scratch: id, slug, title, priority, status, mode.
   Run `bash .riff/lib/validate-roadmap.sh ROADMAP.yaml` after writing and fix any error.
4. `STATE.md` — phase 1, status Initialized.
5. `.planning/design/*.md` — only when project type is saas/web-app or api and scope is
   production. Pages + functionality for web apps. Data model for api and web apps.
   System architecture for api and web apps. Skip for CLI, automation, scratch.

## Refresh policy

When `--refresh` is not set, preserve any artifact that already exists on disk. Write only
what is missing. When `--refresh` is set, overwrite all start artifacts.

## Stop conditions

Stop before writing any file and report the blocking issue when:

- Required product decisions are missing and the gap materially affects architecture,
  roadmap, or security (e.g., auth model, multi-tenancy, data ownership).
- Scope cannot be determined from the brief and no `.planning/config.json` exists.
- The architecture is novel or risky enough to warrant Opus escalation. Generate a prompt
  pack with `node .riff/scripts/riff-opus-prompt.mjs start --context-out .planning/OPUS-START-PROMPT.md`
  and report the path to the human.
- Conflicting constraints make phase sequencing ambiguous.

At most three blocking questions. For low-risk gaps, state an assumption and proceed.

## Output rule

Write only the files listed under "What to produce". Do not write PLAN.md, SUMMARY.md,
taste.md, CONTEXT.md, INCIDENTS.md, or any implementation file.

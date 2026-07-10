# FALLOW — Step 5d static audit

Source of truth for `/riff:next` Step 5d.

Mechanical codebase intelligence on the phase diff via [`fallow`](https://github.com/fallow-rs/fallow): dead code, duplication, complexity, boundary violations. Sub-second, deterministic, no LLM.

## Purpose

Step 5d runs after the executor and scope check, before smoke/review, so cheap static findings are fixed before heavier gates read the diff.

## Skip conditions

**Skip conditions** (all log via `gates-update.mjs --gate fallow --status skipped --reason "<reason>"`):
- `scope: scratch`
- No `package.json` at project root → reason `not TS/JS`
- `command -v fallow` fails → reason `fallow not installed` (`/riff:start` adds it as devDep for new TS/JS production projects)

## Runner detection and invocation

**Run inline:**
1. Detect runner: `pnpm-lock.yaml` → `pnpm exec`, `bun.lock` → `bunx`, `yarn.lock` → `yarn`, otherwise `npx`.
2. `<runner> fallow audit --changed-since main --format json > .planning/phases/N-slug/FALLOW.json`
3. Parse `verdict`: `pass` | `warn` | `fail`.

## Verdict behavior

**Verdict behavior** (fail-on-fail only, warn does not block):
- `pass` → gate `pass`, continue.
- `warn` → gate `warn` with count, continue, surfaced in Step 10 report.
- `fail` → STOP. Prompt **Fix in place** (re-run executor with FALLOW.json input, max 2 cycles) / **Accepted exception** (`status: pass --reason "accepted-exception: <reason>"`) / **One-time override** (`status: skipped --reason "override"`).
  - **Autonomous runs** (`protocols/AUTONOMY.md` § Conversion table): never prompt. Auto-debug once (max 1 cycle, Fix-in-place semantics with FALLOW.json input); still `fail` → park the phase (AUTONOMY.md § Parking, finisher type `review`, FALLOW.json as artifact) + DECISIONS entry. Continue with independent phases.

**Runtime error** (non-zero exit other than `command not found`): surface stderr, AskUserQuestion `skip and continue | halt`. Default skip on no answer. Autonomous runs: skip + log to GATES.md, no prompt.

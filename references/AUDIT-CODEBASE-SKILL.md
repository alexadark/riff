# audit-codebase skill

External skill dependency. Used by `/riff:start` Stage 0 (brownfield baseline), by the `audit codebase` conversational trigger, and by `protocols/DEEP-AUDIT.md` Step 0.

---

## What it does

Four audit modes, all read-only — never modifies code.

| Mode   | Trigger phrase                      | What it produces                                                           |
| ------ | ----------------------------------- | -------------------------------------------------------------------------- |
| `ai`   | "AI-ready", "ready for AI"          | AI-readiness checklist against structural heuristics + a 0-100 score       |
| `bug`  | "bugs", "quality", "assess"         | Assay static analysis report (`npx tryassay assess`) + TLDR with fix plan  |
| `full` | Default when mode is unclear        | Both modes + combined verdict                                               |
| `deep` | "deep audit", "with codex", "go deep" | `full` + Codex adversarial pass (`codex:codex-rescue`) + dedup synthesis  |

In `/riff:start` Stage 0, the skill always runs in `full` mode to establish a baseline before discovery.

### AI-readiness score

Produced by `mode: ai`. Outputs a score from 0 to 100 and a per-category breakdown:

| Category              | What it checks                                                      |
| --------------------- | ------------------------------------------------------------------- |
| Module boundaries     | Import depth, clear entry points, separation of concerns            |
| Type surface          | TS coverage, `any` density, export shape consistency                |
| Test coverage         | Test file presence, co-location pattern, coverage signals           |
| Documentation density | README exists, inline doc on public APIs, missing env vars          |
| Dependency health     | Outdated deps, known vulnerabilities, unused packages               |
| Naming consistency    | Files, functions, variables follow detectable conventions            |

A score ≥ 70 typically means Claude Code agents can navigate the codebase without constant clarification. Scores below 50 signal structural friction that slows every future phase.

### Bug report

Produced by `mode: bug`. Runs `npx tryassay assess` and surfaces:

- `assessment-summary.json` — machine-readable findings
- `bug-report.md` — per-bug descriptions with file:line references
- `executive-summary.md` — non-technical TLDR with severity breakdown

The Assay output lives at `.assay-assessment/` in the project root. Findings feed Stage 1 of `/riff:start`: known critical bugs become constraints, weak module boundaries inform the architecture design.

---

## How to install

The skill is distributed through the alexadark skills library.

```bash
# Check if already installed
ls ~/.claude/skills/audit-codebase

# If missing, install via the skill library
# (ask Claude: "install the audit-codebase skill")
```

The skill symlinks to `~/.claude/skills/audit-codebase` and is registered in `~/.claude/commands/`. The framework detects it at runtime — if missing, Stage 0 of `/riff:start` falls back to "Defer" (skips the audit, notes it as pending in PROJECT.md).

**Dependency:** `npx tryassay assess` requires Node.js on PATH. The `deep` mode also requires `codex:codex-rescue` (see `references/CODEX-RESCUE-SKILL.md`).

---

## When it fires in /riff:start Stage 0

Stage 0 detects brownfield projects via a heuristic (≥3 commits AND >5 source files). On detection, it prompts:

> "Existing codebase detected (~N source files, M commits). Run `audit-codebase` for a baseline before discovery?"

Options: **Run now (recommended)** / Defer / Skip.

On **Run now**: invokes `mode: full`, surfaces AI-readiness score + Assay TLDR, then continues to Stage 1. The findings are available to the planner throughout discovery and feed Stage 1 questioning (known bugs become constraints, gap areas inform architecture).

On **Defer**: notes `audit-codebase: pending` in PROJECT.md, continues without baseline.

On **Skip**: no record, continues.

The baseline score is re-runnable anytime via the conversational trigger `"audit codebase"` or `/riff:map`.

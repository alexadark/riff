---
description: Brownfield codebase exploration and RIFF onboarding
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Agent
args: "[directory] [--focus=area] [--quick]"
---

# /riff:map

Brownfield entry point. Analyzes an existing codebase and produces the planning artifacts RIFF needs.

## Arguments

| Arg            | Description                                             | Default        |
| -------------- | ------------------------------------------------------- | -------------- |
| `[directory]`  | Focus on specific directory                             | Entire project |
| `--focus=area` | Deep dive: `frontend`, `backend`, `api`, `auth`, `data` | All            |
| `--quick`      | Stack detection + architecture only (Steps 1-2)         | Full           |

## What You Do

1. **Check state:** If `.planning/architecture.md` exists, ask: re-map or explore specific area?
2. **Ensure dirs:** Create `.planning/{specs,phases,expertise,seeds,debug,quick}` if missing
3. **Use the Agent tool to invoke the `feature-dev:code-explorer` subagent** with appropriate scope. Do NOT explore the codebase inline.
   - Full/focus → set thoroughness to "very thorough"
   - Quick → set thoroughness to "quick"
   - Your prompt MUST include: the directory to explore, the focus area if specified, and instruction to produce:
     - **One-liner**: a single sentence explaining what this project does (placed at the top of architecture.md)
     - **Stack summary**: framework, language, key dependencies
     - **Architecture map**: folder structure, how modules connect
     - **Module inventory ranked by criticality**: each major module/folder, what it owns, why it matters - ordered from most critical to least critical
     - **Entry points**: where execution starts (main, index, app, route definitions)
     - **Data flow**: how data enters, gets processed, and exits the system
     - **Convention extraction**: naming, patterns, architectural style
     - **Dependency/risk map**: external services, tech debt, security concerns
     - **Mermaid diagrams** (2-3): system architecture, data flow, and module dependencies
     - **Spec backfill**: one spec per major module
   - Do NOT proceed until the explorer agent completes
4. **Post-exploration:** Present summary, ask for corrections, apply to taste.md and `.planning/architecture.md`
5. **CI drift audit:** if `.github/workflows/ci.yml` or `e2e.yml` exist, diff them against `.riff/templates/github-workflows/` and warn on:
   - Lint step that gates merges (no `|| true`, no `continue-on-error`) — RIFF default is informational
   - `e2e.yml` triggering on `push` or `pull_request` — RIFF default is `workflow_dispatch` only

   Do NOT rewrite. Surface to the user with a one-line summary; they decide whether to adopt.
6. **Confirm ready**

## Output

| File                        | Content                                                                                                         |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `.planning/architecture.md` | One-liner, stack, structure, module inventory (ranked), entry points, data flow, dependencies, Mermaid diagrams |
| `taste.md`                  | Extracted conventions by concern                                                                                |
| `.planning/risks.md`        | Tech debt, security concerns                                                                                    |
| `.planning/specs/*.md`      | One spec per major module (skipped with --quick)                                                                |
| `STATE.md`                  | Updated: mapped, ready for planning                                                                             |

## Anti-Patterns

- Don't run `/riff:init` — this handles its own dirs
- Don't generate ROADMAP.yaml — human decides after review
- Don't fix issues found — just document them
- Don't skip human review — explorer extracts, human corrects

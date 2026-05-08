# Fallow Audit (Step 5d)

Mechanical codebase intelligence on the phase diff. Not an agent — a deterministic CLI tool ([`fallow`](https://github.com/fallow-rs/fallow)) the orchestrator calls inline. Sub-second, no LLM, no API cost.

---

## What it checks

`fallow` runs against the branch diff (`--changed-since main`) and detects four categories of structural debt in the changed files and their neighbors:

| Category | What it finds |
| -------- | ------------- |
| **Dead code** | Unused files, unused exports, unreferenced types, dependencies in package.json never imported |
| **Duplication** | 3+ occurrences of identical or near-identical blocks across the repo, including renamed-variable clones |
| **Complexity hotspots** | Functions exceeding cyclomatic complexity thresholds; deeply nested conditionals |
| **Architecture boundary violations** | Import chains that cross declared module boundaries (e.g. a UI component importing directly from a service layer) |

These are things the simplifier (Step 5b) doesn't catch mechanically — fallow is deterministic static analysis, not pattern-matching by an LLM.

---

## How it runs

Invoked inline by the orchestrator (no sub-agent):

```bash
<runner> fallow audit --changed-since main --format json > .planning/phases/N-slug/FALLOW.json
```

Package manager runner is detected from lockfile: `pnpm-lock.yaml` → `pnpm exec`, `bun.lock` → `bunx`, `yarn.lock` → `yarn`, otherwise `npx`.

Output: `.planning/phases/N-slug/FALLOW.json` (full structured output) + one-line entry in `GATES.md`.

---

## Verdicts and behavior

| Verdict | GATES.md entry | What happens |
| ------- | -------------- | ------------ |
| `pass` | `Step 5d: pass` | Continue to Step 5e. |
| `warn` | `Step 5d: warn — N findings` | Continue. Count surfaced in Step 10 report. |
| `fail` | `Step 5d: fail → …` | STOP. User chooses: fix-in-place / accepted-exception / one-time override. |

**Fix in place:** re-run the executor with FALLOW.json as additional input, then re-run Step 5d. Max 2 cycles, then escalate.

**Accepted exception:** write a one-line rationale to GATES.md (`Step 5d: accepted-exception — <reason>`) and continue.

**One-time override:** log `Step 5d: override` to GATES.md and continue.

---

## Skip conditions

Step 5d is skipped automatically in these cases:

| Condition | GATES.md entry |
| --------- | -------------- |
| `scope: scratch` in `.planning/config.json` | _(implicit skip, gate not reached)_ |
| No `package.json` at project root | `Step 5d: skipped — not TS/JS` |
| `fallow` binary not found | `Step 5d: skipped — fallow not installed` |
| Non-zero exit for reasons other than findings | User prompted to skip or halt |

---

## Installation

For new TS/JS production projects, `fallow` is added as a devDep at `/riff:start` Stage 5 (bootstrap). For existing projects predating this integration, install manually:

```bash
# With pnpm
pnpm add -D fallow

# With bun
bun add -d fallow

# With npm
npm install --save-dev fallow
```

Then run once to verify:

```bash
npx fallow audit --changed-since main
```

If fallow is missing at Step 5d runtime, the step skips silently. It does not break existing projects.

---

## Configuration

No per-project config file. Step 5d behavior can be adjusted per phase via ROADMAP.yaml:

```yaml
- id: 12
  title: Refactor auth module
  fallow: false          # disable entirely for this phase
```

(When `fallow: false`, GATES.md gets `Step 5d: skipped — gate=false`.)

To permanently skip for the whole project, add `fallow: false` to every phase, or add `"fallow": false` to `.planning/config.json` (not yet a first-class field — use per-phase gate until then).

---

## Relationship to other steps

- **Simplifier (Step 5b):** the simplifier reviews naming, structural smell, over-engineering — LLM judgment calls. Fallow handles the mechanical layer (dead code, duplication counts, complexity numbers). They run on the same diff but look for different things. Fallow runs after the simplifier so it sees the cleaned code.
- **Adversarial reviewer (Step 6):** runs in parallel with security-reviewer AFTER fallow. Codex reviews logic correctness; fallow reviews structural health. Different concerns, not redundant.

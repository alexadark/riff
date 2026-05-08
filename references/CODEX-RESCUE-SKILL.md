# codex:codex-rescue skill

External skill dependency. Not bundled with RIFF. Required for the adversarial review steps that use a different model than the executor (the value of different-model review is that it catches blind spots the writing model cannot see in its own output).

---

## What it does

Runs a Codex (GPT-family) agent against a diff or file set to hunt logic errors, race conditions, edge cases, and broken contracts. Used by RIFF in three places:

| Step | Context | What it reviews |
| ---- | ------- | ---------------- |
| Step 4b | `/riff:next` | PLAN.md — catches ordering errors, missing dependencies, risky scope before code is written |
| Step 6 | `/riff:next` | Branch diff against main — catches logic bugs, race conditions, edge cases in the implementation |
| Step 2 | `protocols/DEEP-AUDIT.md` | Cross-phase file scope — catches drift, duplicated helpers, accumulated tech debt across a milestone |

Each invocation uses `--model gpt-5.5` and resolves effort from the phase's ROADMAP.yaml `codex_effort:` field (default `medium`; Step 2 deep audit uses `xhigh`).

---

## Installation

The skill is managed separately from the RIFF framework. Install it from the source repo or skills library:

```bash
# Check if installed
ls ~/.claude/skills/ | grep codex

# If missing, ask Claude:
# "install the codex:codex-rescue skill"
# or clone from the skills source and symlink:
# ln -s ~/DEV/claude-code-private/skills/<path>/codex-rescue ~/.claude/skills/codex-rescue
```

After install, the skill appears as `codex:codex-rescue` in `~/.claude/commands/`.

**Requires:** the Codex CLI (`codex` on PATH) and a valid OpenAI API key (`OPENAI_API_KEY` in env or `~/.config/codex/config`).

---

## Fallback behavior

When `codex:codex-rescue` is not configured:

- **Step 4b (plan adversarial):** falls back to an Opus sub-agent with the adversarial-reviewer prompt. Weaker (same model as executor) but still useful.
- **Step 6 (code adversarial):** same Opus fallback.
- **DEEP-AUDIT.md Step 2:** logs a one-line warning and skips the deep audit. No block.

The fallback is automatic — RIFF detects the missing skill at the pre-spawn usage check and switches without asking. A one-line warning is logged to the terminal so you know which model ran.

---

## Configuration

Per-phase overrides in ROADMAP.yaml:

```yaml
- id: 42
  title: Auth system
  codex_model: gpt-5.5      # default gpt-5.5
  codex_effort: high         # low | medium | high | xhigh — default medium
```

Global model + effort resolution order: phase ROADMAP.yaml → `profile.yaml` `budget.default_quality` mapping → defaults above. Full rules: `protocols/MODEL.md` § Codex model + effort.

Usage is tracked in `.planning/codex-usage.csv` (one row per call, written by `scripts/csv-append.sh`). The per-phase count is surfaced in the PR metadata and in `/riff:next` Step 10 report.

---

## Why a different model

Same-model review catches less. When the same weights that wrote the code also review it, they share the same blind spots — misunderstood requirements, wrong mental model of a library, off-by-one logic that "looks right." Codex (GPT-family) reviewing Claude output finds genuinely different failure modes. This is the primary reason RIFF uses an external model for adversarial review rather than just running Sonnet or Opus against the diff.

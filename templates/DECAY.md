# DECAY.md — Framework Pruning Log

> **Review cadence:** quarterly.
> **Purpose:** prevent framework bloat by forcing a "still earning its keep?" review of every component.

For each item: when did I last use it, what real problem does it solve, can it be removed or simplified without losing anything real? Log the decision so the same debate doesn't restart from scratch next quarter.

---

## Commands

| Command | Last used | Verdict | Notes |
| ------- | --------- | ------- | ----- |
| `/riff:init` | | keep | |
| `/riff:start` | | keep | |
| `/riff:map` | | keep | |
| `/riff:next` | | keep | |
| `/riff:wave` | | ? | |
| `/riff:status` | | ? | |
| `/riff:quick` | | ? | |
| `/riff:debug` | | ? | |
| `/riff:add-phase` | | ? | |
| `/riff:improver` | | ? | |
| `/riff:onboard` | | ? | |
| `/riff:learn-stack` | | ? | |
| `/riff:resync` | | ? | |
| `/riff:dashboard` | | ? | |

## Agents

| Agent | Last used | Verdict | Notes |
| ----- | --------- | ------- | ----- |
| planner | | keep | |
| executor | | keep | |
| simplifier | | ? | |
| scope-checker | | ? | |
| adversarial-reviewer | | ? | |
| security-reviewer | | keep | |
| improver | | ? | |
| debugger | | ? | |

## Hooks

| Hook | Last useful fire | Verdict | Notes |
| ---- | ---------------- | ------- | ----- |
| security-scan.sh | | keep | |
| lint-gate.sh | | ? | |
| typecheck-gate.sh | | ? | |
| test-gate.sh | | ? | |
| boundary-check.sh | | ? | |
| orphan-file-check.sh | | ? | |
| migration-gate.sh | | ? | |
| registry-reminder.sh | | ? | |
| voice-rules-inject.sh | | ? | |
| notify-human.sh | | ? | |

## Scripts

| Script | Last used | Verdict | Notes |
| ------ | --------- | ------- | ----- |
| `scripts/riff-pr-metadata.sh` | | ? | |
| `scripts/csv-append.sh` | | ? | |

## Protocols / References

| File | Last read | Verdict | Notes |
| ---- | --------- | ------- | ----- |
| protocols/EXECUTION.md | | keep | |
| protocols/MODEL.md | | keep | |
| protocols/AUTO-TRIGGERS.md | | keep | |
| protocols/HANDOFF.md | | ? | |
| protocols/QUALITY.md | | ? | |
| protocols/DEEP-AUDIT.md | | ? | |
| protocols/INCIDENT.md | | ? | |
| protocols/PROMOTE.md | | ? | |
| references/LANGUAGE.md | | keep | |
| references/PROFILE-RESOLUTION.md | | keep | |
| references/PROJECT-SCOPE.md | | ? | |
| references/CONTEXT-BUDGET.md | | ? | |
| references/EXPLANATION-LEVEL.md | | ? | |

---

## Considered and rejected

<!-- Settled debates. Format: "What — why rejected — what evidence would reopen it" -->
<!-- Add entries when a debate is closed so it doesn't restart from zero next quarter. -->

---

## Changelog

<!-- One line per pruning pass: date, what was removed, impact. -->

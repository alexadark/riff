# EXECUTION

Operational rules every RIFF agent follows when planning, building, and reacting to surprises during a phase. This is the "how we work" doc — pair it with [QUALITY.md](./QUALITY.md) (post-build checks) and [MODEL.md](./MODEL.md) (model dispatch).

---

## 1. Confidence Gate

Score these 4 dimensions before proceeding. **Any dimension < 0.7 → STOP** and surface questions.

| Dimension  | Question                                                   |
| ---------- | ---------------------------------------------------------- |
| **Scope**  | Is it clear what to deliver? (not vague, not overlapping)  |
| **Target** | Do I understand the codebase well enough? (read the files) |
| **Output** | Can I define testable acceptance criteria?                 |
| **Risk**   | Have I identified what could go wrong?                     |

### Confidence levels (for surfaced questions)

- **Confident** (0.8–1.0) — sure, just confirming
- **Likely** (0.5–0.8) — probably right, could be wrong
- **Unclear** (0.0–0.5) — need human input

### AFK mode behavior

- Confident / Likely → proceed
- Unclear → STOP the loop, notify via Telegram

---

## 2. R1–R4 Deviation Rules

When reality doesn't match the plan, react with the right tool:

| Rule   | Situation                            | Action                                                                            |
| ------ | ------------------------------------ | --------------------------------------------------------------------------------- |
| **R1** | Minor bug found                      | Fix it. Log in SUMMARY: `R1: Fixed [bug] in [file]`                               |
| **R2** | Missing piece (import, type, config) | Add if obvious. Log: `R2: Added [piece] because [reason]`                         |
| **R3** | Architecture change needed           | **STOP.** Do NOT implement. Surface issue + proposed alternative. Wait for human. |
| **R4** | Out of scope idea                    | Do NOT implement. Write to `.planning/seeds/seed-NNNN.md` with trigger condition. |

---

## 3. Context Loading

What each agent reads before acting. Read in this order, skip what's already in context.

**All agents — language rule:** read `profile.yaml` per `.riff/references/PROFILE-RESOLUTION.md` for `user.conversational_language` (chat output) and `user.artifact_language` (committed files). Reply to the user in `conversational_language`; write all `.planning/**` artifacts and code in `artifact_language`. Defaults: both `en`. See `.riff/CLAUDE.md` § Language.

### Planner reads

1. **Always:** ROADMAP.yaml, STATE.md, PROJECT.md, taste.md (`## Architecture`), `profile.yaml` (resolved per `.riff/references/PROFILE-RESOLUTION.md`)
2. **If exists:** CONTEXT.md, previous SUMMARY.md files, `.planning/expertise/planner.md`
3. **Relevant taste section:** `## Backend` for backend tasks, `## Frontend` for frontend, etc.
4. **The codebase:** Read the actual files you're planning to modify. Never plan blind.

If `profile.yaml` is missing, fall back to `neutre` preset defaults (see `commands/onboard.md`).

### Executor reads

1. **PLAN.md** — your executable prompt, follow it precisely
2. **taste.md** — `## Architecture` always + relevant section
3. **Boundaries** — each task lists which files you CAN modify, nothing else
4. **Previous SUMMARY.md** — if wave 2+, read what wave 1 built
5. **profile.yaml** (resolved per `.riff/references/PROFILE-RESOLUTION.md`): always, for user calibration. Fall back to `neutre` defaults if missing.
6. **If exists:** `.planning/expertise/executor.md`

### Verifier reads (for manual re-audits and post-build doc check)

1. **PLAN.md** — goal, tasks, acceptance criteria
2. **SUMMARY.md** — what the executor claims happened
3. **`.planning/warnings.log`** — hook warnings from the phase
4. **The codebase** — verify independently, don't trust claims

### Security reviewer reads

- Files modified in the phase (from SUMMARY.md or git diff)
- OWASP checklist (see `agents/security-reviewer.md`)
- `profile.yaml` (resolved per `.riff/references/PROFILE-RESOLUTION.md`) for user calibration. Fall back to `neutre` defaults if missing.

---

## 4. Wave Execution

Tasks in the same wave run in **parallel via separate agents**. They MUST have **zero file overlap** in their entire boundary list.

### Planning waves

Explicitly state waves in the plan. Common conflicts to watch for:

- Barrel exports (`index.ts`) — both tasks add exports → separate waves
- Schema files (`schema.ts`) — both tasks add tables → separate waves
- Config files (`package.json`, route manifests) — both add entries → separate waves

**When in doubt, use separate waves. Sequential is always safe.**

### Logical dependency check

Zero file overlap is necessary but NOT sufficient. Each task MUST list `requires:` — symbols, exports, or files produced by other tasks. If task B `requires` something from task A, B's wave must be strictly later than A's.

### Executing waves

- **Multi-task wave:** Use the Agent tool to spawn all task agents in a **single message** (parallel). Each Agent tool call gets: task description, boundaries, taste.md, and `model` set per the task's `Model:` field. Do NOT implement any task inline — every task runs in its own Agent subagent. After the wave completes, read committed changes before starting next wave.
- **Conflict detected:** Two agents modified the same file → planner error. Log as R1, resolve manually.

---

## 5. Test Suite Detection

Shared by executor, debugger, simplifier. Detect and run the first match:

1. `package.json` with `scripts.test` → `npm test`
2. `pytest.ini` / `pyproject.toml` → `pytest`
3. `go.mod` → `go test ./...`
4. `Cargo.toml` → `cargo test`
5. `Makefile` with `test` target → `make test`

If none detected: note it in the agent's output artifact. Do not silently skip.

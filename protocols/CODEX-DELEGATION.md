# Codex delegation

How RIFF hands work to Codex, for both **waves** (N phases) and **solo** (1 phase).

## Routing decision

`/riff:wave` Step 4 calls this protocol. The decision rule:

| Wave size | Estimated duration | Default route | Reason |
|---|---|---|---|
| 1 phase, simple | < 30 min | in-process | Cheap and keeps the user in one terminal |
| 1 phase, complex | > 30 min | out-of-process | Codex output would bloat Claude context |
| 2+ phases | any | out-of-process | Multi-phase parallelism is what Apex Teams (-m) is for, runs cleanest in its own session |

User overrides: `--in-process` or `--out-of-process` flag on `/riff:wave`.

If Codex CLI is not installed locally (`which codex` fails), fall back to in-process via the `codex:codex-rescue` skill (which uses Anthropic's Codex API wrapper). Surface a one-line warning so the user knows performance will differ.

## Prompt templates

Three flavors. The bundle file is the same in all three — only the wrapper prompt changes.

### Template A: Wave (N parallel phases)

The "goal style" Alex referenced. Codex receives a clear outcome contract and is free to orchestrate.

```text
Your goal: deliver the wave described in .planning/waves/W{N}.bundle.md.

Read the bundle first. It contains {{N}} independent phases, all wave-eligible (no depends_on between them, all AFK, no production providers).

Invoke the apex skill with these flags:
  /apex -a -x -v -m -bundle .planning/waves/W{N}.bundle.md

Flag meanings (do not skip any):
  -a  autonomous, no confirmations
  -x  examine, multi-agent adversarial review (security + logic + clean code) after execution
  -v  verify, browser-check per phase per the contract in .riff/protocols/BROWSER-CHECK.md
  -m  teams, run independent phases in parallel agents

Execution rules:
  - One atomic commit per phase. Conventional commit message. NEVER `git add .`, stage explicit files.
  - Acceptance criteria are non-negotiable. If a criterion is red after execution, fix or log a blocker. Do not say "done" if it is not done.
  - Browser-check contract: do not stop until the feature provably works in the browser. Read .riff/protocols/BROWSER-CHECK.md.
  - On error, read the relevant logs (server, browser console, DB query output) before changing code.
  - Write .planning/waves/W{N}.RESULT.md per the bundle's RESULT.md contract.

Effort: --model gpt-5.4 --effort high (default for wave execution).
Per-phase overrides are inline in the bundle. Honor them.

Stop conditions:
  - All phases reach terminal state (criteria green + commit + browser-check pass) → write RESULT.md, exit
  - 2+ phases blocked with no progress for 15 minutes → write partial RESULT.md, exit
  - Unrecoverable error (git in bad state, dep install fails) → write partial RESULT.md, exit
```

### Template B: Solo (1 phase, normal)

For phases that are not wave-eligible (depends_on chain) but you still want Codex to execute.

```text
Your goal: ship phase P{X} ({{slug}}).

Read .planning/phases/{id}-{slug}/PLAN.md. It is the source of truth.

Invoke the apex skill with these flags:
  /apex -a -x -v {{phase task description, one line}}

Same execution rules as a wave. One commit. Acceptance criteria are a hard contract. Browser-check enforced per .riff/protocols/BROWSER-CHECK.md.

Write a single-phase RESULT block to .planning/phases/{id}-{slug}/CODEX-RESULT.md.

Effort: --model gpt-5.4 --effort {{phase.codex_effort | default high}}.
```

### Template C: Solo-strict (1 phase, Opus planned)

For risky phases where Opus wrote the plan and Codex must execute STRICTLY without deviation.

```text
Your goal: execute phase P{X} ({{slug}}) EXACTLY as planned. The plan was written by Opus for a reason. Do not improvise.

Read .planning/phases/{id}-{slug}/PLAN.md. Treat every file path, every function signature, every test case as a contract.

Invoke the apex skill with these flags:
  /apex -a -x -v {{phase task description}}

Constraints specific to strict mode:
  - Do not add files beyond what the plan lists, even helpers
  - Do not refactor adjacent code "while you're there"
  - Do not skip acceptance criteria, even if you believe one is wrong — log a blocker instead
  - Browser-check: enforced, no exceptions
  - If the plan is ambiguous, write a blocker and stop. Do not guess.

Write CODEX-RESULT.md. Include a `## Deviation` block if you needed to depart from the plan (and explain why).

Effort: --model gpt-5.5 --effort xhigh (strict mode bumps the model).
```

## In-process invocation

When the route is in-process:

```
Agent tool → skill codex:codex-rescue with:
  - bundle_path: .planning/waves/W{N}.bundle.md (or PLAN.md path for solo)
  - prompt: {{template A, B, or C above, fully rendered}}
  - model: {{resolved per phase}}
  - effort: {{resolved per phase}}
```

The skill returns when Codex exits. Claude reads the RESULT.md (or CODEX-RESULT.md) and reconciles.

## Out-of-process invocation

When the route is out-of-process, Claude prints the command and stops. The user copies it into a fresh Codex CLI terminal.

```
─────────────────────────────────────────────────────────────
WAVE W{N} READY — paste this in a new Codex terminal:

cd {{project_root}}
codex --model gpt-5.4

Then in Codex, paste this prompt:

{{Template A/B/C above, fully rendered with {{N}} and bundle path resolved}}
─────────────────────────────────────────────────────────────
```

STATE.md gets `wave_pending: W{N}` until the user runs `/riff:wave --resume W{N}`.

## Effort resolution

Same chain as the existing MODEL.md § Resolution chain (Codex):

1. Per-phase `codex_effort:` in ROADMAP.yaml
2. Per-wave default (set in bundle header): `high`
3. Hardcoded fallback: `gpt-5.4 medium`

For solo-strict (Template C), force `gpt-5.5 xhigh` regardless of phase override — the strict contract demands the frontier model.

## Failure handling

| Symptom | Recovery |
|---|---|
| User aborts Codex mid-wave | Partial RESULT.md may exist. `/riff:wave --resume` reconciles what completed |
| Codex exit code non-zero | Treat as partial. Reconcile completed phases, queue rest |
| RESULT.md missing after Codex exits | Surface to user. Likely Codex crashed before final write. Recover from git log |
| `codex` binary missing | Skill fallback path, surface warning |

## Cross-references

- `/riff:wave` Steps 4-5 use this protocol
- `protocols/WAVE-BUNDLE.md` defines the bundle format Codex reads
- `protocols/BROWSER-CHECK.md` defines the `-v verify` contract referenced by the prompts
- `protocols/MODEL.md` § Codex model + effort is the source for default model/effort by step

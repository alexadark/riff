# Codex delegation

How RIFF hands work to Codex, for both **waves** (N phases) and **solo** (1 phase).

## Routing decision

`/riff:wave` Step 4 calls this protocol. The decision rule:

| Wave size | Estimated duration | Default route | Reason |
|---|---|---|---|
| 1 phase, simple | < 30 min | in-process | Cheap and keeps the user in one terminal |
| 1 phase, complex | > 30 min | out-of-process | Codex output would bloat Claude context |
| 2+ phases | any | out-of-process | Multi-phase parallelism runs cleanest in its own session |

User overrides: `--in-process` or `--out-of-process` flag on `/riff:wave`.

If Codex CLI is not installed locally (`which codex` fails), fall back to in-process via the `codex:codex-rescue` skill (which uses Anthropic's Codex API wrapper). Surface a one-line warning so the user knows performance will differ.

## Execution skill resolution

The prompt templates below invoke `{{execution_skill}}`, resolved from:

1. Per-phase `execution_skill:` in ROADMAP.yaml (rare)
2. `codex.execution_skill` in profile.yaml
3. Hardcoded fallback: `/apex`

The skill must accept flags `-a`, `-x`, `-v`, `-m`, and `-bundle <path>`.

## Prompt templates

Three flavors. The bundle file is the same in all three — only the wrapper prompt changes.

### Template A: Wave (N parallel phases)

The `/goal` framing convention (per nowstack-saas / Melvynx pattern). First line is the high-level outcome, body is the detailed contract. Codex CLI accepts `/goal <text>` directly in the REPL.

```text
/goal Deliver Wave W{N}: {{one-line outcome statement, user-facing}}.

Read .planning/waves/W{N}.bundle.md first. It contains {{N}} independent phases, all wave-eligible (no depends_on between them, all AFK, no production providers).

Invoke the configured execution skill (profile.yaml `codex.execution_skill`, default `/apex`):
  {{execution_skill}} -a -x -v -m -bundle .planning/waves/W{N}.bundle.md

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
  - File mutations: ALWAYS use `apply_patch` for create/modify/delete. Do NOT
    use shell redirections (`printf > file`, `cat <<EOF > file`, `sed -i`). The
    RIFF security hooks (idor, auth, input-validation, boundary) only fire on
    `apply_patch`, not on `exec_command`. See .riff/protocols/HOOKS.md § "Known
    gaps". If you bypass this, the security gate is silently disabled.

Quality contract (non-negotiable, enforced in adversarial review):

  TASTE: Before writing code, read the "Stack rules to honor" list in the bundle header.
  For each entry, READ the full file at .riff/references/taste/stacks/<stack>.md and honor
  every rule in its Anti-Pattern Checklist. Common misses to watch:
    - Every loader-bearing route gets a clientLoader + shouldRevalidate (react-router-7.md)
    - Every <Link> gets prefetch="intent" (inline) or prefetch="viewport" (nav)
    - z.record requires 2 args (zod.md)
    - Re-throw Response/data() shapes in action try/catch before the Error branch
    - getSession() not getUser() in loaders
    - <Form> + action, never useEffect + fetch

  NO PLACEHOLDERS: Every interactive element shipped MUST be fully wired.
    - <button> without onClick or form submit = blocker, not "done"
    - <Link> to a route that does not exist = blocker
    - "TODO" / "Coming soon" in user-visible UI = blocker unless the bundle phase
      explicitly marks it as a stub with rationale
    - If a feature in the PLAN is out of scope for this phase, exclude it from UI
      entirely, do not ship a dead element

  COLOR & CONTRAST: When copying design tokens from a prototype or reference theme:
    - Verify body text contrast >= 4.5:1 against its background (WCAG AA)
    - Verify large text and UI components >= 3:1
    - Tokens designed for white backgrounds (#FFFFFF) often fail on paper/cream
      backgrounds (#F5F2EA range) — re-test on actual background, not the prototype's
    - Document any text that intentionally uses a low-contrast muted color
      (timestamps, helper text) in BROWSER-CHECK.md so reviewers do not flag it

  PER-PHASE ARTIFACTS: For each phase, write BOTH:
    - .planning/phases/{id}-{slug}/SUMMARY.md (what shipped, files touched,
      tests added, deviations, follow-ups)
    - .planning/phases/{id}-{slug}/BROWSER-CHECK.md if browser-check enabled
    The wave-level RESULT.md aggregates but does NOT replace these per-phase files.

Effort: --model gpt-5.5 --effort high (default for wave execution).
Per-phase overrides are inline in the bundle. Honor them.

Scratch mode (conditional, only when `scratch_mode: true` in the bundle header):

  - You are running in scratch mode. The PostToolUse security hooks (idor,
    route-auth, input-validation, boundary) are DOWNGRADED: they emit a
    SCRATCH WARNING but do not block the commit.
  - For every file you write that triggers one of these warnings, insert a
    `// TODO(security): <hook>: <short message>` comment at the very top of
    the file in the SAME patch. Example:
      `// TODO(security): idor: DB query with external ID, no user scoping`
  - At the end of the wave, the file
    `.planning/followups/SECURITY-W{N}-RECONCILE.md` will already exist (the
    hooks auto-create it). Read it, group findings by file, and append a
    short paragraph at the end summarizing the trade-off you accepted and
    what reconcile work is owed.
  - Do NOT silence the warnings by adding a fake auth check or a stub
    validator. The point is to ship fast and pay it back later, not to
    pretend the gap does not exist.
  - The next `/riff:promote` (or "promote to production" trigger) will be
    blocked until SECURITY-W{N}-RECONCILE.md is empty or removed.

Stop conditions:
  - All phases reach terminal state (criteria green + commit + browser-check pass) → write RESULT.md, exit
  - 2+ phases blocked with no progress for 15 minutes → write partial RESULT.md, exit
  - Unrecoverable error (git in bad state, dep install fails) → write partial RESULT.md, exit
```

### Template B: Solo (1 phase, normal)

For phases that are not wave-eligible (depends_on chain) but you still want Codex to execute.

```text
/goal Ship phase P{X} ({{slug}}): {{one-line outcome statement}}.

Read .planning/phases/{id}-{slug}/PLAN.md. It is the source of truth.

Invoke the configured execution skill:
  {{execution_skill}} -a -x -v {{phase task description, one line}}

Same execution rules as a wave. One commit. Acceptance criteria are a hard contract. Browser-check enforced per .riff/protocols/BROWSER-CHECK.md.

Write a single-phase RESULT block to .planning/phases/{id}-{slug}/CODEX-RESULT.md.

Effort: --model gpt-5.5 --effort {{phase.codex_effort | default high}}.
```

### Template C: Solo-strict (1 phase, Opus planned)

For risky phases where Opus wrote the plan and Codex must execute STRICTLY without deviation.

```text
/goal Execute phase P{X} ({{slug}}) EXACTLY as planned. The plan was written by Opus for a reason. Do not improvise.

Read .planning/phases/{id}-{slug}/PLAN.md. Treat every file path, every function signature, every test case as a contract.

Invoke the configured execution skill:
  {{execution_skill}} -a -x -v {{phase task description}}

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
  - env: { RIFF_SCRATCH_MODE: "1", RIFF_WAVE_ID: "W{N}" }  # only when scratch_mode: true
```

The skill returns when Codex exits. Claude reads the RESULT.md (or CODEX-RESULT.md) and reconciles.

In-process env contract: the `codex:codex-rescue` skill must forward the env
dict to its `codex exec` subprocess (e.g. via `subprocess.run(env={**os.environ, **env})`).
Inline prefixing on the command line is the safer fallback if the skill does
not yet support an `env` field. Verify with a dry run: launch the wave with
`scratch_mode: true`, trigger a security finding, and confirm the hook
prints `RIFF SCRATCH MODE: downgrading ...` before the warning.

## Out-of-process invocation

When the route is out-of-process, Claude prints the command and stops. The user copies it into a fresh Codex CLI terminal. The prompt is already prefixed with `/goal` per the templates above, so no manual prefixing needed.

```
─────────────────────────────────────────────────────────────
WAVE W{N} READY — paste this in a new Codex terminal:

cd {{project_root}}
{{env_prefix}}codex --dangerously-bypass-approvals-and-sandbox -c model_reasoning_effort="high"

Then paste this prompt (already /goal-prefixed):

{{Template A/B/C above, fully rendered with {{N}} and bundle path resolved}}
─────────────────────────────────────────────────────────────
```

`{{env_prefix}}` resolves to:

- Empty string when `scratch_mode: false` in the bundle
- `RIFF_SCRATCH_MODE=1 RIFF_WAVE_ID=W{N} ` (trailing space, single line) when
  `scratch_mode: true`

Inline env vars on the launch line propagate to Codex and, through it, to
every hook subprocess Codex spawns. This is the only way to reach the hooks
in the out-of-process flow: the user is in a separate terminal that did not
inherit Claude's env. Without the prefix, `RIFF_SCRATCH_MODE` will be unset
in the hooks and they will run in normal blocking mode.

The Codex CLI launch flag `--dangerously-bypass-approvals-and-sandbox` is the Melvynx / nowstack-saas convention for AFK wave execution. It avoids per-action approval prompts that would defeat the autonomous run. The `model_reasoning_effort` override is the wave default; per-phase overrides in the bundle take precedence.

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

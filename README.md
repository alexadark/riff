# RIFF

RIFF is a provider-native stage runner for bounded repository changes, with native Codex and Claude Code adapters.
It keeps role instructions provider-neutral and puts model, effort, permissions, and runtime rules in adapters.

The operational reference is [the RIFF manual](docs/RIFF-MANUAL.md).

## Install

Clone RIFF somewhere stable, then make the framework directory available on your `PATH`.

```bash
git clone <riff-repository-url> ~/DEV/frameworks/riff
cd ~/DEV/frameworks/riff
./riff resync
export PATH="$HOME/DEV/frameworks/riff:$PATH"
```

`riff resync` bootstraps RIFF's own runtime links. It is safe to run again after RIFF changes.

After installation, the same operation is available as `$resync` in a project-local Codex setup, `$riff:resync` in the namespaced plugin, and `/riff:resync` in Claude Code.

Install RIFF into an existing Git project:

```bash
cd /path/to/project
/path/to/riff/riff init --no-onboard
```

`riff init` creates the project `.riff` symlink, planning directories, Claude runtime links, project-local Codex skills, and materialized Codex route adapters. It preserves unowned collisions unless `--force` is explicitly supplied.

Choose the native model provider in the active RIFF profile:

```yaml
runtime:
  provider: codex # or claude

wave:
  parallel_workers: 4 # 1 through 8; use 1 for sequential workers
```

Project `.planning/profile.yaml` takes precedence over the framework `profile.yaml`. RIFF resolves the provider once at stage start, records it, and never falls back automatically.

## Five-minute quickstart

1. Enter a Git project with a resolvable `HEAD`.
2. Run `riff init --no-onboard` from that project.
3. Restart the agent session if it needs to discover newly installed skills.
4. Start or map the project, then inspect its roadmap.

```text
$start                       # greenfield discovery and roadmap
$map                         # brownfield architecture and risks
$status                      # authoritative progress and next action
$phase                       # list, add, or update roadmap phases
```

`$start` and `$map` are intentionally interactive skills on Codex and Claude;
RIFF has no native terminal CLI for either one.

Use the `$riff:...` names when RIFF is installed as a namespaced Codex plugin.
Claude Code exposes the same shared skills after resync and retains
`/riff:start`, `/riff:map`, `/riff:status`, and `/riff:add-phase` compatibility
commands.

For direct terminal management:

```bash
./.riff/riff status
./.riff/riff debug --issue "Describe the observed failure exactly"
./.riff/riff phase list
./.riff/riff phase add --title "Public rebrand foundation" \
  --goal "Establish approved public brand tokens and assets"
```

To run one phase directly, give RIFF an explicit phase id and bounded request.

In a Codex project installation, invoke the project-local skill:

```text
$next --phase 28-public-rebrand-foundation --task "Apply the approved brand foundation within the named file boundaries."
```

When RIFF is installed as a namespaced Codex plugin, invoke the same skill as `$riff:next`. From Claude Code, explicitly invoke the installed RIFF next skill or use the terminal form below.

All forms require explicit `--phase` and `--task` values. The provider-neutral terminal entry point is:

```bash
./.riff/riff next \
  --project-root "$(git rev-parse --show-toplevel)" \
  --phase 28-public-rebrand-foundation \
  --task "Apply the approved brand foundation within the named file boundaries."
```

The runner creates plan, review, summary, scope, and state artifacts under `.planning/`. It completes only after every stage passes. RIFF never deploys or promotes implicitly; an explicit approved roadmap phase may perform that work.

To run the next ready roadmap frontier without routine pauses:

```bash
./.riff/riff wave --autonomous
```

To continue through newly unlocked dependency frontiers until the roadmap is
dry or a real stop condition is reached:

```bash
./.riff/riff wave --autonomous --loop
```

Use `$wave` or `$riff:wave` in Codex, `/riff:wave --autonomous --loop` in
Claude Code, and `riff wave --resume` after an interruption. When RIFF reaches
an explicit verification boundary, it prints the exact `riff wave --approve
--run <id> --phase <id> --evidence "Checked: <scope>; Observed: <result>; Expected: <expected result>"` command. That command records
structured human evidence and continues the same run. Security-sensitive
implementation remains autonomous; security hooks run once after product
phases. Only explicit visual or functional verification, destructive work,
promotion, a blocking failure, or an operator cap stops the loop.

For a phase that needs visual or functional verification, RIFF completes the
implementation first, then persists the verification request and waits before
unlocking dependent work. Approval resumes that same run without rerunning the
completed implementation. Destructive actions and promotion remain confirmed
before they happen. Safe pre-promotion failures in loop mode retry with fresh
attempts up to `autonomy.debug_cycle_cap`. After that cap, RIFF dispatches one
fresh read-only debugger; only a valid `DIAGNOSED` report permits one guided
attempt. Unresolved, invalid, interrupted, post-promotion, or failed guided
recovery blocks the loop.

To finish a completed wave, use the explicit Codex `$finish` or `$riff:finish`
skill, the installed RIFF finish workflow in Claude Code, or the CLI. First
inspect the read-only plan:

```bash
./.riff/riff finish --check
```

After reviewing the exact paths, evidence, strategy, and token and explicitly
confirming that plan, run only the displayed command:

```bash
./.riff/riff finish --confirm <token>
```

The `github_button` strategy creates or reuses a pull request without merging.
The `local_no_ff` strategy performs the explicitly confirmed no-fast-forward
merge. Neither strategy deploys or promotes.

## What runs

`$riff:next` performs this gated sequence:

1. Controller classification.
2. For exact routine Codex phases, validate the roadmap's direct execution contract; otherwise run the planner and mechanical plan validation. Claude always uses the planner.
3. Record a direct-plan attestation or run a fresh plan review. Claude always uses the reviewer.
4. Run ordered autonomous worker waves, with isolated path-disjoint tasks in each wave dispatched concurrently up to `wave.parallel_workers`.
5. Mechanical smoke and scope gates.
6. Fresh code review.
7. Repeated mechanical gates and completed state persistence.

Workers inside one native stage have no per-worker retry. In an autonomous
roadmap loop, safe pre-promotion phase failures receive fresh attempts up to
`autonomy.debug_cycle_cap`, followed by exactly one fresh read-only debugger
diagnosis and, only for `DIAGNOSED`, one guided native attempt. A bounded
full-plan repair still occurs only after the first final smoke failure. A failed
guided attempt or any unresolved, invalid, interrupted, or post-promotion
failure remains blocked.

## Providers

Codex and Claude Code are native model providers for the same stage contract. Shared role specifications stay identical; each provider adapter owns its models, efforts, tools, permissions, and invocation shape. The current Claude route still requires the Codex CLI as the mechanical sandbox helper for planned smoke commands. That helper does not dispatch Codex models when `runtime.provider` is `claude`.

Read [the manual](docs/RIFF-MANUAL.md) before relying on unattended execution. It documents the Darwin sandbox requirement, the linked-worktree install limitation, native stage restart boundaries, and safe autonomous-wave resume.

## Test a RIFF branch safely

Keep experimental RIFF work on a branch in this repository. A separate
repository isn't required. Create a dedicated Git worktree for the test branch,
point only pilot projects' `.riff` symlinks at that worktree, then run
`./.riff/riff resync` inside each pilot project. Stable projects can keep their
`.riff` links pointed at the main worktree. Rolling back means repointing the
symlink to the stable worktree and running resync again.

## Validate RIFF itself

```bash
node scripts/artifact-check.mjs
./riff doctor --ci
```

See [HOW-IT-WORKS.md](HOW-IT-WORKS.md) for the concise architecture and [scripts/README.md](scripts/README.md) for script reference.

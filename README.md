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

Use the `$riff:...` names when RIFF is installed as a namespaced Codex plugin.
Claude Code exposes the same shared skills after resync and retains
`/riff:start`, `/riff:map`, `/riff:status`, and `/riff:add-phase` compatibility
commands.

For direct terminal management:

```bash
./.riff/riff status
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

The runner creates plan, review, summary, scope, and state artifacts under `.planning/`. It completes only after every stage passes. Promotion remains a separate action requiring your confirmation.

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
Claude Code, and `riff wave --resume` after an interruption. Security-sensitive
implementation remains autonomous; security hooks run once after product
phases. Only explicit visual or functional verification, destructive work,
promotion, a blocking failure, or an operator cap stops the loop.

## What runs

`$riff:next` performs this fixed sequence:

1. Controller classification.
2. Planner output and mechanical plan validation.
3. Fresh plan review.
4. Autonomous sequential worker waves.
5. Mechanical smoke and scope gates.
6. Fresh code review.
7. Repeated mechanical gates and completed state persistence.

Normal waves have no retry. RIFF permits one bounded full-plan repair only after the first final smoke failure.

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

# RIFF pilot guide

This guide explains how to test the pinned RIFF build while its remaining
public command migrations continue elsewhere.

Pinned framework:

    /Users/webstantly/DEV/frameworks/riff-test
    branch: codex/riff-native-test
    commit: 8d3cdb7

Verify the identity before installing it into a pilot project:

    git -C /Users/webstantly/DEV/frameworks/riff-test branch --show-current
    git -C /Users/webstantly/DEV/frameworks/riff-test rev-parse --short HEAD

The pilot worktree is separate from the development worktree. Installing it
into a project changes only that project's local RIFF links and runtime
adapters. It does not merge, push, deploy, or promote anything.

## Prerequisites

- Use macOS/Darwin for production model dispatch and RIFF's required smoke
  sandbox.
- Have Git, Node.js, and the selected agent runtime available.
- Use a normal Git checkout for the consumer project. The checkout must have a
  resolvable HEAD.
- Do not use a Git linked worktree as the consumer project. RIFF can live in a
  framework worktree such as riff-test, but riff init requires the project
  receiving .riff to have a normal .git directory.
- Keep the pinned framework first on PATH when using commands printed by
  riff status:

    export PATH="/Users/webstantly/DEV/frameworks/riff-test:$PATH"

With runtime.provider: claude, the current Claude route still uses the
Codex CLI as RIFF's mechanical sandbox helper for planned smoke commands. It
does not dispatch Codex models for the stage.

## Initialize a new project

### Existing repository

Clone or check out the project normally, then initialize it from the pinned
framework:

    git clone <repository-url> /absolute/path/to/project
    cd /absolute/path/to/project
    git rev-parse --show-toplevel
    git rev-parse HEAD

    /Users/webstantly/DEV/frameworks/riff-test/riff init \
      --scope production \
      --profile default
    ./.riff/riff resync

Use --scope scratch instead for a personal or local prototype:

    /Users/webstantly/DEV/frameworks/riff-test/riff init \
      --scope scratch \
      --profile default
    ./.riff/riff resync

### Empty directory

If the project does not exist yet, create a normal Git checkout and make an
initial commit before asking RIFF to run a stage:

    mkdir -p /absolute/path/to/project
    cd /absolute/path/to/project
    git init
    touch .gitkeep
    git add .gitkeep
    git commit -m "chore: initialize project"

    /Users/webstantly/DEV/frameworks/riff-test/riff init \
      --scope scratch \
      --profile default
    ./.riff/riff resync

riff init creates .riff, the planning directories, Claude runtime links,
project-local Codex skills, and materialized Codex route adapters. It also
preserves unowned collisions. The resync command is idempotent and reconciles
RIFF-owned runtime links after an installation or framework update.

production is the default product scope and keeps the full product discovery
and review expectations. scratch is for personal or local tools and uses the
lighter scratch workflow. The first explicit scope is written to
.planning/config.json; a later init preserves an existing scope rather than
silently changing it.

## Keep an existing profile

The project profile is .planning/profile.yaml. It takes precedence over the
framework profile, and the project override is a full override rather than a
field-by-field merge.

When initializing or relinking a project whose profile must remain unchanged,
use --profile skip:

    cd /absolute/path/to/project
    /Users/webstantly/DEV/frameworks/riff-test/riff init \
      --profile skip

Do not pass --profile default or --profile custom when the existing profile
must be preserved. An explicit profile mode can write a new profile and may
create .planning/profile.yaml.bak when replacing one.

The active provider and worker parallelism are configured in the active
profile:

    runtime:
      provider: codex # or claude

    wave:
      parallel_workers: 4 # integer from 1 through 8; 1 forces sequential workers

If runtime.provider is absent, RIFF defaults to codex. RIFF resolves the
provider at stage start, records it, and does not fall back to the other
provider during that stage. A one-run --provider codex|claude override exists
for explicit wave or native-stage use; a resumed wave keeps its original
provider.

## Switch an existing project to the pinned build

Run this from the project's Git root. It repoints .riff to the pinned
framework and leaves the project profile and roadmap in place:

    cd /absolute/path/to/project
    /Users/webstantly/DEV/frameworks/riff-test/riff init \
      --force \
      --profile skip
    ./.riff/riff resync
    realpath .riff

The final command should resolve to:

    /Users/webstantly/DEV/frameworks/riff-test

--force is appropriate when .riff already points at another RIFF worktree.
RIFF still preserves unowned runtime collisions and fails closed on non-symlink
collisions. Do not add --scope unless a new project has no existing scope and
you intentionally want to set one.

## Resynchronize a project

From the project Git root, the canonical terminal command is always:

    ./.riff/riff resync

The same operation can be invoked explicitly through the installed agent
surface:

- Codex project installation: $resync
- Namespaced Codex plugin installation: $riff:resync
- Claude Code: /riff:resync

Do not invoke riff-resync.sh directly. If the skill is not visible after
initialization or resync, restart the Codex or Claude session so it discovers
the newly installed runtime files.

## Start and inspect a project

After restarting the agent session, use the skills explicitly:

    $start       # greenfield discovery and roadmap
    $map         # brownfield architecture and risk mapping
    $status      # authoritative roadmap, wave, stage, and next action
    $phase       # list, add, or update roadmap phases
    $dashboard   # local read-only dashboard

In a namespaced Codex installation, use $riff:start, $riff:map,
$riff:status, $riff:phase, and $riff:dashboard. Claude Code retains
/riff:start, /riff:map, /riff:status, /riff:add-phase, and
/riff:dashboard compatibility forms.

$start and $map are interactive skills, not terminal subcommands. For
deterministic phase management and status, use:

    ./.riff/riff phase list
    ./.riff/riff status
    ./.riff/riff status --json
    ./.riff/riff dashboard

## Run an explicit native phase

Every native stage requires an explicit phase identifier and bounded task:

    ./.riff/riff next \
      --project-root "$(git rev-parse --show-toplevel)" \
      --phase <phase-id> \
      --task "Apply the approved bounded change within the named files and run the declared checks."

In Codex, the equivalent skill is $next or $riff:next. The request should
state the intended behavior, permitted files or surfaces, exclusions, and
checks. RIFF never infers a phase or task from conversation history.

## Run autonomous waves

Run the currently ready roadmap frontier:

    ./.riff/riff wave --autonomous

Continue through newly unlocked dependency frontiers until the roadmap is dry
or a real stop condition is reached:

    ./.riff/riff wave --autonomous --loop

The agent forms are $wave or $riff:wave in Codex, and
/riff:wave --autonomous --loop in Claude Code. After an interruption, use
the exact Resume: command printed by authoritative RIFF status output.

The wave engine selects ready phases, respects depends_on, and invokes the
native riff next runner once per phase. Roadmap dependency frontiers remain
ordered. Within one native phase, path-disjoint tasks grouped in the same
validated plan wave run in isolated workers concurrently, bounded by
wave.parallel_workers.

Autonomous mode does not pause for routine implementation or routine security
work. Security hooks run once after product phases. It does pause at explicit
visual or functional verification, destructive actions, promotion, a blocking
failure, or a configured operator cap. A wave never commits, merges, pushes,
deploys, or promotes implicitly.

## Human verification and resume

When a wave reaches a visual or functional boundary, inspect the authoritative
state rather than constructing a run or phase identifier:

    ./.riff/riff status

Copy the complete command printed after Approve: or Resume: and run that
command unchanged from the project root. For an approval, replace only the
evidence placeholders with facts from the check, keeping the required fields:
Checked: ...; Observed: ...; Expected: ....

Do not invent a new W-... run id, phase id, approval syntax, or resume syntax.
If status reports a blocked phase, inspect its native artifacts and resolve the
blocker instead of blindly starting another loop. ./.riff/riff wave --status
is also available for an active wave, but riff status is the project-level
authoritative next-action view.

## Finish boundary

Finishing Git work is separate from running a wave. Only invoke it after an
explicit decision to finish:

    ./.riff/riff finish --check

--check is read-only. Review the exact paths, evidence hashes, merge strategy,
and confirmation token it prints. Only after explicitly approving that exact
plan, run the exact --confirm <token> command displayed by the check. Never
fabricate or reuse a token after the branch, HEAD, evidence, or dirty paths
change.

The selected finish strategy may open a pull request or perform a confirmed
local no-fast-forward merge. It does not deploy or promote.

## Roll back a pilot to another RIFF worktree

Keep stable and experimental framework worktrees separate. To return a pilot
project to a stable framework worktree, use that worktree's absolute riff path
and preserve the project profile:

    cd /absolute/path/to/project
    /absolute/path/to/stable-riff/riff init \
      --force \
      --profile skip
    ./.riff/riff resync
    realpath .riff

The .riff target and RIFF-owned runtime links are repointed. The project
roadmap, phase artifacts, and .planning/profile.yaml remain project data.
Verify the resolved link before running another wave.

## Public surfaces not yet native in this pilot

This section intentionally describes pinned commit `8d3cdb7`. Later migrations
on the separate development branch do not change this pilot until it is
explicitly repinned.

Do not assume the remaining historical Claude commands are migrated to native
Codex surfaces:

- conductor is deferred.
- debug has no public native debug skill. The native debugger is used
  internally by autonomous-wave recovery after the configured retry cap.
- quick, stress, learn-stack, and onboard remain legacy command surfaces
  rather than part of the native pilot workflow.
- init remains a deterministic terminal installation command.

The active pilot workflow is init, resync, start, map, phase, status, dashboard,
next, wave, and the explicit finish boundary.

## Troubleshooting

### .riff resolves to the wrong framework

From the project root, inspect it:

    realpath .riff

If replacing the existing RIFF link is intended, rerun the pinned init command
with --force --profile skip, then run ./.riff/riff resync.

### init says .riff must be a symlink

RIFF will not overwrite a non-symlink collision. Inspect and preserve or move
that path only after deciding that it is safe, then rerun initialization. A
broken or non-symlink .riff is fail-closed by design.

### init fails in a linked worktree

Use a normal clone or checkout for the consumer project. The framework itself
may be in a Git worktree, but the project receiving .riff must expose a normal
.git directory and a resolvable HEAD.

### Skills do not appear

Run the canonical resync command from the project root and restart the Codex or
Claude session:

    ./.riff/riff resync

### The wrong provider or parallelism is selected

Inspect the active project profile, then set only supported values:

    runtime:
      provider: codex # or claude
    wave:
      parallel_workers: 4 # 1 through 8

Remember that a project .planning/profile.yaml overrides the framework profile
as a whole. A stage records its provider at start and does not switch
providers automatically.

### riff in a status command is not found

Put the pinned framework first on PATH, then rerun status so its printed
Approve: or Resume: command resolves to the pinned build:

    export PATH="/Users/webstantly/DEV/frameworks/riff-test:$PATH"
    ./.riff/riff status

### A wave stops

Read the complete ./.riff/riff status output and the phase artifacts under
.planning/. A verification stop requires the exact printed approval command.
A blocking or post-promotion failure requires inspection and resolution; a
wave does not silently retry those states.

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(here, '..', 'scripts', 'riff-conductor.mjs');
const autonomyState = path.resolve(here, '..', 'scripts', 'autonomy-state.mjs');

const cleanupRoots = [];

afterEach(() => {
  while (cleanupRoots.length > 0) {
    const root = cleanupRoots.pop();
    rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(prefix) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  cleanupRoots.push(root);
  return root;
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const ROADMAP_SAFE = `name: demo
phases:
  - id: 1
    slug: setup
    title: "Project setup"
    status: done
    depends_on: []
    description: "Scaffold the app shell"
  - id: 2
    slug: listing
    title: "Listing page"
    status: todo
    depends_on: [1]
    description: "Render the public listing grid"
`;

function tempProject({
  roadmap = ROADMAP_SAFE,
  config = { scope: 'production' },
  gitInit = true,
} = {}) {
  const root = tempDir('riff-conductor-project-');
  if (gitInit) {
    git(root, ['init', '-q', '-b', 'main']);
    git(root, ['config', 'user.email', 'test@test.local']);
    git(root, ['config', 'user.name', 'Test']);
    writeFileSync(path.join(root, 'README.md'), '# demo\n');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-q', '-m', 'init']);
  }
  if (roadmap !== null) writeFileSync(path.join(root, 'ROADMAP.yaml'), roadmap);
  if (config !== null) {
    mkdirSync(path.join(root, '.planning'), { recursive: true });
    writeFileSync(path.join(root, '.planning/config.json'), `${JSON.stringify(config, null, 2)}\n`);
  }
  return root;
}

function tempRegistry(projectRoots) {
  const dir = tempDir('riff-conductor-registry-');
  const file = path.join(dir, 'registry.txt');
  writeFileSync(file, `${projectRoots.join('\n')}\n`, 'utf8');
  return file;
}

function runPlan(registry, extraArgs = []) {
  const stateRoot = tempDir('riff-conductor-state-');
  const stdout = execFileSync(process.execPath, [
    script, 'plan', '--json', '--registry', registry, '--state-root', stateRoot, ...extraArgs,
  ], { encoding: 'utf8' });
  return { plan: JSON.parse(stdout), stateRoot };
}

function planFor(project, extraArgs = []) {
  const { plan } = runPlan(tempRegistry([project]), extraArgs);
  expect(plan.projects).toHaveLength(1);
  return plan.projects[0];
}

describe('riff-conductor plan: selection', () => {
  test('production project with a safe todo phase and met deps is advanced', () => {
    const project = tempProject();
    const entry = planFor(project);
    expect(entry.decision).toBe('advance');
    expect(entry.reason).toBeNull();
    expect(entry.phases.map((p) => p.slug)).toEqual(['listing']);
  });

  test('hold-classified phases are never selected — payment tag skips as no-eligible-work', () => {
    const project = tempProject({
      roadmap: `phases:
  - id: 1
    slug: checkout
    title: "Checkout"
    status: todo
    depends_on: []
    tags: [payment]
    description: "Stripe checkout flow"
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('no-eligible-work');
    expect(entry.holds).toBe(1);
  });

  test('sensitive title text holds a phase even without tags', () => {
    const project = tempProject({
      roadmap: `phases:
  - id: 1
    slug: login
    title: "User login and session handling"
    status: todo
    depends_on: []
    description: "Email + password"
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('no-eligible-work');
  });

  test('provider_mode production holds the phase', () => {
    const project = tempProject({
      roadmap: `phases:
  - id: 1
    slug: emails
    title: "Transactional emails"
    status: todo
    depends_on: []
    provider_mode: production
    description: "Resend integration"
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('no-eligible-work');
  });

  test('a phase with an unmet dependency is not eligible', () => {
    const project = tempProject({
      roadmap: `phases:
  - id: 1
    slug: base
    title: "Base layer"
    status: todo
    depends_on: []
    description: "Shared components"
  - id: 2
    slug: on-top
    title: "Widget board"
    status: todo
    depends_on: [1]
    description: "Grid of widgets"
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('advance');
    expect(entry.phases.map((p) => p.slug)).toEqual(['base']);
  });

  test('a skipped dependency counts as satisfied', () => {
    const project = tempProject({
      roadmap: `phases:
  - id: 1
    slug: legacy
    title: "Legacy import"
    status: skipped
    depends_on: []
    description: "Dropped on purpose"
  - id: 2
    slug: fresh
    title: "Fresh page"
    status: todo
    depends_on: [1]
    description: "Landing revamp"
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('advance');
    expect(entry.phases.map((p) => p.slug)).toEqual(['fresh']);
  });

  test('scratch scope is skipped', () => {
    const project = tempProject({ config: { scope: 'scratch' } });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('scratch');
  });

  test('missing config.json defaults to production', () => {
    const project = tempProject({ config: null });
    expect(planFor(project).decision).toBe('advance');
  });

  test('missing project directory is skipped', () => {
    const registry = tempRegistry(['/nonexistent/riff-conductor-ghost']);
    const { plan } = runPlan(registry);
    expect(plan.projects[0].decision).toBe('skip');
    expect(plan.projects[0].reason).toBe('missing');
  });

  test('a directory that is not a git repo is skipped', () => {
    const project = tempProject({ gitInit: false });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('not-a-git-repo');
  });

  test('missing ROADMAP.yaml is skipped as invalid-roadmap', () => {
    const project = tempProject({ roadmap: null });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('invalid-roadmap');
  });

  test('a roadmap with no parseable phases is skipped as invalid-roadmap', () => {
    const project = tempProject({ roadmap: 'name: demo\nnothing: here\n' });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('invalid-roadmap');
  });

  test('tracked modifications skip the project as dirty-tree', () => {
    const project = tempProject();
    writeFileSync(path.join(project, 'README.md'), '# changed\n');
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('dirty-tree');
  });

  test('untracked-only files do not skip the project', () => {
    const project = tempProject();
    writeFileSync(path.join(project, 'notes.txt'), 'scratch\n');
    const entry = planFor(project);
    expect(entry.decision).toBe('advance');
    expect(entry.untracked).toBeGreaterThan(0);
  });

  test('a diverged main (ahead and behind origin/main) is skipped', () => {
    const project = tempProject();
    // fabricate origin/main pointing at a divergent commit
    const baseSha = git(project, ['rev-parse', 'HEAD']).trim();
    writeFileSync(path.join(project, 'remote.txt'), 'remote change\n');
    git(project, ['add', 'remote.txt']);
    git(project, ['commit', '-q', '-m', 'remote-only']);
    const remoteSha = git(project, ['rev-parse', 'HEAD']).trim();
    git(project, ['reset', '-q', '--hard', baseSha]);
    writeFileSync(path.join(project, 'local.txt'), 'local change\n');
    git(project, ['add', 'local.txt']);
    git(project, ['commit', '-q', '-m', 'local-only']);
    git(project, ['update-ref', 'refs/remotes/origin/main', remoteSha]);
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('diverged');
  });

  test('an ahead-only main is not skipped', () => {
    const project = tempProject();
    const baseSha = git(project, ['rev-parse', 'HEAD']).trim();
    git(project, ['update-ref', 'refs/remotes/origin/main', baseSha]);
    writeFileSync(path.join(project, 'local.txt'), 'local change\n');
    git(project, ['add', 'local.txt']);
    git(project, ['commit', '-q', '-m', 'local-only']);
    expect(planFor(project).decision).toBe('advance');
  });

  test('a live launch lock skips the project as in-flight-session', () => {
    const project = tempProject();
    execFileSync(process.execPath, [
      autonomyState, 'lock', 'acquire', '--run', '2026-07-11-0900', '--project-root', project,
    ], { encoding: 'utf8' });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('in-flight-session');
  });

  test('a stale lock with a non-terminal run resumes instead of skipping', () => {
    const project = tempProject();
    const runId = '2026-07-10-0900';
    execFileSync(process.execPath, [
      autonomyState, 'lock', 'acquire', '--run', runId, '--project-root', project,
    ], { encoding: 'utf8' });
    const runDir = path.join(project, '.planning/autonomy', runId);
    mkdirSync(runDir, { recursive: true });
    writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify({
      run: runId,
      stage: 'build',
      phases: [{ id: '2-listing', autonomy: 'safe', status: 'building' }],
    }, null, 2)}\n`);
    execFileSync(process.execPath, [
      autonomyState, 'pointer', 'set', '--run', runId, '--project-root', project,
    ], { encoding: 'utf8' });
    // backdate the lock heartbeat past the 180-minute staleness window
    const old = new Date(Date.now() - 4 * 60 * 60 * 1000);
    utimesSync(path.join(project, '.planning/autonomy/lock/owner.json'), old, old);
    const entry = planFor(project);
    expect(entry.decision).toBe('advance');
    expect(entry.resume).toBe('resume');
  });

  test('halt-ambiguous state skips the project as ambiguous-state', () => {
    const project = tempProject();
    mkdirSync(path.join(project, '.planning/autonomy'), { recursive: true });
    writeFileSync(path.join(project, '.planning/autonomy/loop.json'), `${JSON.stringify({
      status: 'running', current_run: null,
    }, null, 2)}\n`);
    for (const runId of ['2026-07-09-0800', '2026-07-10-0800']) {
      const runDir = path.join(project, '.planning/autonomy', runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(path.join(runDir, 'run.json'), `${JSON.stringify({
        run: runId, stage: 'build', phases: [],
      }, null, 2)}\n`);
    }
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('ambiguous-state');
  });

  test('a pending branchless security finisher blocks the project as merges-blocked', () => {
    const project = tempProject();
    const finisherDir = path.join(project, '.planning/autonomy/2026-07-10-0700/finishers');
    mkdirSync(finisherDir, { recursive: true });
    writeFileSync(path.join(finisherDir, 'F-9-x-security.yaml'), `run: 2026-07-10-0700
finishers:
  - id: F-9-x-security
    type: security
    phase: 9-x
    waiting_on: "human sign-off"
    status: pending
`);
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('merges-blocked');
  });

  test('mapping-format roadmaps (phase-N keys, name, status complete) are parsed', () => {
    const project = tempProject({
      roadmap: `# brownfield roadmap
phase-12:
  name: "Dead code removal"
  status: complete
  depends_on: []
phase-13:
  name: "Listing grid"
  status: todo
  depends_on: [12]
  description: "Render the public grid"
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('advance');
    expect(entry.phases.map((p) => p.id)).toEqual(['12', '13'].filter((id) => id === '13'));
  });

  test('folded rationale text feeds the hold classification', () => {
    const project = tempProject({
      roadmap: `phase-20:
  name: "Webhook handler"
  status: todo
  depends_on: []
  rationale: >
    Receives Stripe payment events and updates
    the ledger accordingly.
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('no-eligible-work');
    expect(entry.holds).toBe(1);
  });

  test('a scalar depends_on is honored, not treated as no dependencies', () => {
    const project = tempProject({
      roadmap: `phases:
  - id: 1
    slug: base
    title: "Base layer"
    status: todo
    depends_on: []
    description: "Shared shell"
  - id: 2
    slug: child
    title: "Child page"
    status: todo
    depends_on: 1
    description: "Sits on the base"
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('advance');
    expect(entry.phases.map((p) => p.slug)).toEqual(['base']);
  });

  test('a scalar tag still feeds the hold classification', () => {
    const project = tempProject({
      roadmap: `phases:
  - id: 1
    slug: identity-flow
    title: "Identity flow"
    status: todo
    depends_on: []
    tags: security_critical
    description: "User entry"
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('no-eligible-work');
    expect(entry.holds).toBe(1);
  });

  test('a phase with neither id nor slug is never eligible', () => {
    const project = tempProject({
      roadmap: `phases:
  - title: "No identity"
    status: todo
    depends_on: []
    description: "Cannot be referenced"
`,
    });
    const entry = planFor(project);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('no-eligible-work');
  });

  test('a pending finisher tied to a branch does not block other safe work', () => {
    const project = tempProject();
    const finisherDir = path.join(project, '.planning/autonomy/2026-07-10-0700/finishers');
    mkdirSync(finisherDir, { recursive: true });
    writeFileSync(path.join(finisherDir, 'F-9-x-security.yaml'), `run: 2026-07-10-0700
finishers:
  - id: F-9-x-security
    type: security
    phase: 9-x
    branch: riff/phase-9-x
    waiting_on: "human sign-off"
    status: pending
`);
    expect(planFor(project).decision).toBe('advance');
  });
});

describe('riff-conductor plan: scheduled mode and filters', () => {
  test('scheduled runs skip projects without auto_advance', () => {
    const project = tempProject();
    const entry = planFor(project, ['--scheduled']);
    expect(entry.decision).toBe('skip');
    expect(entry.reason).toBe('not-opted-in');
  });

  test('scheduled runs advance projects with auto_advance true', () => {
    const project = tempProject({ config: { scope: 'production', auto_advance: true } });
    expect(planFor(project, ['--scheduled']).decision).toBe('advance');
  });

  test('--projects filters by directory name', () => {
    const projectA = tempProject();
    const projectB = tempProject();
    const registry = tempRegistry([projectA, projectB]);
    const stateRoot = tempDir('riff-conductor-state-');
    const stdout = execFileSync(process.execPath, [
      script, 'plan', '--json', '--registry', registry, '--state-root', stateRoot,
      '--projects', path.basename(projectA),
    ], { encoding: 'utf8' });
    const plan = JSON.parse(stdout);
    expect(plan.projects).toHaveLength(1);
    expect(plan.projects[0].path).toBe(projectA);
  });

  test('duplicate registry entries collapse to one project', () => {
    const project = tempProject();
    const registry = tempRegistry([project, project]);
    const { plan } = runPlan(registry);
    expect(plan.projects).toHaveLength(1);
  });

  test('plan is read-only: no conductor state, no project writes', () => {
    const project = tempProject();
    const before = readdirSync(project).sort();
    const statusBefore = git(project, ['status', '--porcelain']);
    const { plan, stateRoot } = runPlan(tempRegistry([project]));
    expect(plan.projects[0].decision).toBe('advance');
    expect(readdirSync(project).sort()).toEqual(before);
    expect(existsSync(path.join(stateRoot, '.planning/conductor'))).toBe(false);
    expect(git(project, ['status', '--porcelain'])).toBe(statusBefore);
  });
});

describe('riff-conductor state', () => {
  function initState(stateRoot, runId, projects) {
    const planFile = path.join(stateRoot, 'plan.json');
    writeFileSync(planFile, `${JSON.stringify({ projects }, null, 2)}\n`);
    return execFileSync(process.execPath, [
      script, 'state', 'init', '--run', runId, '--state-root', stateRoot, '--plan', planFile,
    ], { encoding: 'utf8' });
  }

  function readState(stateRoot, extraArgs = []) {
    const stdout = execFileSync(process.execPath, [
      script, 'state', 'read', '--state-root', stateRoot, ...extraArgs,
    ], { encoding: 'utf8' });
    return JSON.parse(stdout);
  }

  test('init seeds pending statuses from the plan and read resumes the latest run', () => {
    const stateRoot = tempDir('riff-conductor-state-');
    initState(stateRoot, '2026-07-11-0700', [
      { path: '/tmp/a', decision: 'advance', reason: null },
      { path: '/tmp/b', decision: 'skip', reason: 'scratch' },
    ]);
    const state = readState(stateRoot);
    expect(state.run).toBe('2026-07-11-0700');
    expect(state.status).toBe('running');
    expect(state.projects).toEqual([
      expect.objectContaining({ path: '/tmp/a', status: 'pending' }),
      expect.objectContaining({ path: '/tmp/b', status: 'skipped', reason: 'scratch' }),
    ]);
    expect(state.next_project).toBe('/tmp/a');
  });

  test('project transitions persist and finish marks the run terminal', () => {
    const stateRoot = tempDir('riff-conductor-state-');
    initState(stateRoot, '2026-07-11-0700', [
      { path: '/tmp/a', decision: 'advance', reason: null },
    ]);
    execFileSync(process.execPath, [
      script, 'state', 'project', '--run', '2026-07-11-0700', '--state-root', stateRoot,
      '--project', '/tmp/a', '--status', 'done',
    ], { encoding: 'utf8' });
    let state = readState(stateRoot);
    expect(state.projects[0].status).toBe('done');
    expect(state.next_project).toBeNull();
    execFileSync(process.execPath, [
      script, 'state', 'finish', '--run', '2026-07-11-0700', '--state-root', stateRoot,
    ], { encoding: 'utf8' });
    state = readState(stateRoot, ['--run', '2026-07-11-0700']);
    expect(state.status).toBe('done');
  });

  test('terminal project statuses are sticky: done never goes back to pending', () => {
    const stateRoot = tempDir('riff-conductor-state-');
    initState(stateRoot, '2026-07-11-0700', [
      { path: '/tmp/a', decision: 'advance', reason: null },
    ]);
    execFileSync(process.execPath, [
      script, 'state', 'project', '--run', '2026-07-11-0700', '--state-root', stateRoot,
      '--project', '/tmp/a', '--status', 'done',
    ], { encoding: 'utf8' });
    let code = 0;
    try {
      execFileSync(process.execPath, [
        script, 'state', 'project', '--run', '2026-07-11-0700', '--state-root', stateRoot,
        '--project', '/tmp/a', '--status', 'pending',
      ], { encoding: 'utf8' });
    } catch (error) {
      code = error.status;
    }
    expect(code).not.toBe(0);
    const state = readState(stateRoot, ['--run', '2026-07-11-0700']);
    expect(state.projects[0].status).toBe('done');
    expect(state.next_project).toBeNull();
  });

  test('state init refuses to overwrite an existing run', () => {
    const stateRoot = tempDir('riff-conductor-state-');
    initState(stateRoot, '2026-07-11-0700', [
      { path: '/tmp/a', decision: 'advance', reason: null },
    ]);
    execFileSync(process.execPath, [
      script, 'state', 'project', '--run', '2026-07-11-0700', '--state-root', stateRoot,
      '--project', '/tmp/a', '--status', 'done',
    ], { encoding: 'utf8' });
    let code = 0;
    try {
      initState(stateRoot, '2026-07-11-0700', [
        { path: '/tmp/a', decision: 'advance', reason: null },
      ]);
    } catch (error) {
      code = error.status;
    }
    expect(code).not.toBe(0);
    const state = readState(stateRoot, ['--run', '2026-07-11-0700']);
    expect(state.projects[0].status).toBe('done');
  });

  test('state finish only accepts done or stopped', () => {
    const stateRoot = tempDir('riff-conductor-state-');
    initState(stateRoot, '2026-07-11-0700', [
      { path: '/tmp/a', decision: 'advance', reason: null },
    ]);
    let code = 0;
    try {
      execFileSync(process.execPath, [
        script, 'state', 'finish', '--run', '2026-07-11-0700', '--state-root', stateRoot,
        '--status', 'banana',
      ], { encoding: 'utf8' });
    } catch (error) {
      code = error.status;
    }
    expect(code).not.toBe(0);
    expect(readState(stateRoot, ['--run', '2026-07-11-0700']).status).toBe('running');
  });

  test('read with no run resumes the latest non-terminal run, skipping finished ones', () => {
    const stateRoot = tempDir('riff-conductor-state-');
    initState(stateRoot, '2026-07-10-0700', [{ path: '/tmp/a', decision: 'advance', reason: null }]);
    execFileSync(process.execPath, [
      script, 'state', 'finish', '--run', '2026-07-10-0700', '--state-root', stateRoot,
    ], { encoding: 'utf8' });
    initState(stateRoot, '2026-07-11-0700', [{ path: '/tmp/b', decision: 'advance', reason: null }]);
    const state = readState(stateRoot);
    expect(state.run).toBe('2026-07-11-0700');
  });
});

describe('riff-conductor stop-check', () => {
  test('exit 0 with no STOP file anywhere', () => {
    const stateRoot = tempDir('riff-conductor-state-');
    const stdout = execFileSync(process.execPath, [
      script, 'stop-check', '--state-root', stateRoot,
    ], { encoding: 'utf8' });
    expect(JSON.parse(stdout).stop).toBe(false);
  });

  test('exit 3 when the global STOP file exists', () => {
    const stateRoot = tempDir('riff-conductor-state-');
    mkdirSync(path.join(stateRoot, '.planning/autonomy'), { recursive: true });
    writeFileSync(path.join(stateRoot, '.planning/autonomy/STOP'), '');
    let code = 0;
    try {
      execFileSync(process.execPath, [script, 'stop-check', '--state-root', stateRoot], { encoding: 'utf8' });
    } catch (error) {
      code = error.status;
    }
    expect(code).toBe(3);
  });

  test('exit 3 when the per-project STOP file exists', () => {
    const stateRoot = tempDir('riff-conductor-state-');
    const project = tempProject();
    mkdirSync(path.join(project, '.planning/autonomy'), { recursive: true });
    writeFileSync(path.join(project, '.planning/autonomy/STOP'), '');
    let code = 0;
    try {
      execFileSync(process.execPath, [
        script, 'stop-check', '--state-root', stateRoot, '--project', project,
      ], { encoding: 'utf8' });
    } catch (error) {
      code = error.status;
    }
    expect(code).toBe(3);
  });
});

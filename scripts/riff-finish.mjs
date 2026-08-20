#!/usr/bin/env node
// Explicit, token-bound Git finishing for completed native RIFF waves.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createHash, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveFrameworkRoot, resolveProjectRoot, roadmapTextWithPhaseStatus } from './lib/roadmap-workflow.mjs';
import { resolveRuntimeProfile } from './lib/runtime-provider.mjs';
import { assertWaveRunId, readWaveState, secureWaveRoot } from './lib/wave-state.mjs';
import { checkBranch } from './finisher-guard.mjs';
import { inspectCompletedWaveEvidence } from './riff-wave.mjs';
import { validateActionDelivery } from './lib/git-delivery.mjs';

const scriptFrameworkRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SHA256 = /^[a-f0-9]{64}$/;

function fail(message) { throw new Error(message); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function parseArgs(argv) {
  const options = { json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    const next = () => {
      const result = argv[index + 1];
      if (!result || result.startsWith('--')) fail(`${value} requires a value`);
      index += 1;
      return result;
    };
    if (value === '--check') options.check = true;
    else if (value === '--confirm') options.confirm = next();
    else if (value === '--run') options.runId = next();
    else if (value === '--project-root') options.projectRoot = next();
    else if (value === '--base') options.base = next();
    else if (value === '--json') options.json = true;
    else if (value === '-h' || value === '--help') options.help = true;
    else fail(`unknown riff finish option: ${value}`);
  }
  if (!options.help && (options.check ? 1 : 0) + (options.confirm ? 1 : 0) !== 1) fail('riff finish requires exactly one of --check or --confirm TOKEN');
  if (options.runId) assertWaveRunId(options.runId);
  return options;
}

function usage() {
  return 'Usage:\n  riff finish --check [--run ID] [--project-root PATH] [--base BRANCH] [--json]\n  riff finish --confirm TOKEN [--run ID] [--project-root PATH] [--base BRANCH] [--json]\n';
}

function isolatedGitEnvironment() {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE']) delete env[key];
  return env;
}

function git(projectRoot, args, { input, allowFailure = false } = {}) {
  const result = spawnSync('git', ['-c', 'push.followTags=false', ...args], {
    cwd: projectRoot, encoding: 'buffer', shell: false, input,
    env: isolatedGitEnvironment(), maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000, killSignal: 'SIGKILL', stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) fail(`git ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) fail(`git ${args.join(' ')} failed: ${Buffer.from(result.stderr || '').toString('utf8').trim() || `exit ${result.status}`}`);
  return result;
}
function rawGit(projectRoot, args) {
  const result = spawnSync('git', args, { cwd: projectRoot, encoding: 'utf8', shell: false, env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.status !== 0) fail(`cannot read Git operator identity`);
  return result.stdout.trim();
}
function gitText(projectRoot, args) { return Buffer.from(git(projectRoot, args).stdout || '').toString('utf8').trim(); }
function nulPaths(buffer) {
  const values = Buffer.from(buffer || '').toString('utf8').split('\0');
  values.pop();
  return values;
}
function uniqueSorted(values) { return [...new Set(values)].sort(); }
function posixQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'`; }

function safeRelative(relative) {
  return typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative)
    && !relative.split('/').some((part) => !part || part === '.' || part === '..')
    && !relative.split('/').includes('.git');
}
function lstatOrNull(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
}
function assertSafePath(projectRoot, relative) {
  if (!safeRelative(relative)) fail(`unsafe finish path: ${relative}`);
  let current = projectRoot;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    const stat = lstatOrNull(current);
    if (!stat) break; // a deletion is safe only after all existing ancestors were checked
    if (stat.isSymbolicLink()) fail(`unsafe finish path is a symlink: ${relative}`);
    if (current !== path.join(projectRoot, relative) && !stat.isDirectory()) fail(`unsafe finish path ancestor is not a directory: ${relative}`);
    const nestedGit = lstatOrNull(path.join(current, '.git'));
    if (nestedGit) fail(`unsafe finish path is inside a nested repository: ${relative}`);
  }
  const staged = nulPaths(git(projectRoot, ['ls-files', '--stage', '-z', '--', relative]).stdout);
  if (staged.some((line) => /^160000\s/.test(line))) fail(`unsafe finish path is a submodule: ${relative}`);
}

function currentChanges(projectRoot) {
  const args = ['--literal-pathspecs'];
  const unstaged = nulPaths(git(projectRoot, [...args, 'diff', '--name-only', '-z', '--no-ext-diff', '--no-textconv']).stdout);
  const staged = nulPaths(git(projectRoot, [...args, 'diff', '--cached', '--name-only', '-z', '--no-ext-diff', '--no-textconv']).stdout);
  const untracked = nulPaths(git(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']).stdout);
  const conflicts = nulPaths(git(projectRoot, [...args, 'diff', '--name-only', '-z', '--diff-filter=U']).stdout);
  if (conflicts.length) fail(`merge conflicts are present: ${conflicts.join(', ')}`);
  return uniqueSorted([...unstaged, ...staged, ...untracked]);
}

function hasPreStagedChanges(projectRoot) {
  return git(projectRoot, ['diff', '--cached', '--quiet'], { allowFailure: true }).status === 1;
}

function contentRecord(projectRoot, relative) {
  const absolute = path.join(projectRoot, relative);
  const stat = lstatOrNull(absolute);
  if (!stat) return { path: relative, kind: 'deleted' };
  if (!stat.isFile()) fail(`unsafe finish path is not a regular file: ${relative}`);
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile()) fail(`unsafe finish path changed while reading: ${relative}`);
    return { path: relative, kind: 'regular', mode: (opened.mode & 0o111) ? 0o755 : 0o644, sha256: sha256(fs.readFileSync(descriptor)) };
  } finally { fs.closeSync(descriptor); }
}

function indexContentRecord(projectRoot, relative) {
  const records = nulPaths(git(projectRoot, ['ls-files', '--stage', '-z', '--', relative]).stdout);
  if (!records.length) return { path: relative, kind: 'deleted' };
  if (records.length !== 1) fail(`index has ambiguous entries for ${relative}`);
  const match = records[0].match(/^(\d+)\s+([0-9a-f]{40,64})\s+\d+\t/);
  if (!match || match[1] === '160000') fail(`index has unsafe entry for ${relative}`);
  return { path: relative, kind: 'regular', mode: Number.parseInt(match[1], 8) & 0o7777, sha256: sha256(git(projectRoot, ['cat-file', 'blob', match[2]]).stdout) };
}
function committedContentRecord(projectRoot, ref, relative) {
  const records = nulPaths(git(projectRoot, ['ls-tree', '-z', ref, '--', relative]).stdout);
  if (!records.length) return { path: relative, kind: 'deleted' };
  if (records.length !== 1) fail(`commit has ambiguous entries for ${relative}`);
  const match = records[0].match(/^(\d+)\s+(\w+)\s+([0-9a-f]{40,64})\t/);
  if (!match || match[1] === '160000' || match[2] !== 'blob') fail(`commit has unsafe entry for ${relative}`);
  return { path: relative, kind: 'regular', mode: Number.parseInt(match[1], 8) & 0o7777, sha256: sha256(git(projectRoot, ['cat-file', 'blob', match[3]]).stdout) };
}
function contentEvidenceHash(head, records) { return sha256(canonical({ head, paths: records })); }

function latestCompletedRun(projectRoot) {
  const root = secureWaveRoot(projectRoot);
  const ids = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'active.json')
    .map((entry) => entry.name.slice(0, -'.json'.length))
    .filter((id) => { try { assertWaveRunId(id); return true; } catch { return false; } });
  if (ids.length > 64) fail('too many RIFF wave state candidates; select an explicit --run after cleanup');
  const candidates = ids
    .map((id) => { try { return readWaveState(projectRoot, id); } catch { return null; } })
    .filter((state) => state?.state === 'completed')
    .sort((left, right) => `${left.updated_at}|${left.run}`.localeCompare(`${right.updated_at}|${right.run}`));
  if (!candidates.length) fail('no completed RIFF wave exists; pass --run to select an eligible run');
  return candidates.at(-1).run;
}

function resolveBase(projectRoot, explicitBase) {
  let base = explicitBase;
  if (base?.startsWith('origin/')) base = base.slice('origin/'.length);
  if (!base) {
    const symbolic = git(projectRoot, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { allowFailure: true });
    if (symbolic.status !== 0) fail('cannot resolve base branch: origin/HEAD is absent or ambiguous; pass --base BRANCH');
    const ref = Buffer.from(symbolic.stdout || '').toString('utf8').trim();
    if (!ref.startsWith('refs/remotes/origin/')) fail('cannot resolve base branch from origin/HEAD');
    base = ref.slice('refs/remotes/origin/'.length);
  }
  if (!base || git(projectRoot, ['check-ref-format', '--branch', base], { allowFailure: true }).status !== 0) fail(`invalid base branch: ${base}`);
  if (git(projectRoot, ['show-ref', '--verify', '--quiet', `refs/remotes/origin/${base}`], { allowFailure: true }).status !== 0) fail(`origin base branch is missing: origin/${base}`);
  return base;
}

function remoteUrlLines(projectRoot, args) { return Buffer.from(git(projectRoot, args).stdout || '').toString('utf8').split('\n').map((value) => value.trim()).filter(Boolean); }
function assertSafeRemoteUrl(value) {
  if (!value || value.startsWith('-') || /[\x00-\x1f\x7f]/.test(value) || value.startsWith('ext::') || /^https?:\/\/[^/\s@]+@/i.test(value)) fail('origin URL is unsafe');
  if (!(/^(?:https?|ssh|git):\/\//i.test(value) || /^[^\s@:]+@[^\s:]+:.+/.test(value) || path.isAbsolute(value) || value.startsWith('file://'))) fail('origin URL uses an unsupported scheme');
  return value;
}
function githubRepo(value) {
  const match = value.match(/(?:github\.com[/:])([^/\s]+)\/([^/\s#]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : null;
}
function resolveDestination(projectRoot, base) {
  for (const pattern of ['^url\\..*\\.(insteadOf|pushInsteadOf)$']) if (git(projectRoot, ['config', '--local', '--get-regexp', pattern], { allowFailure: true }).status === 0) fail('local URL rewrite configuration blocks riff finish');
  const fetch = remoteUrlLines(projectRoot, ['remote', 'get-url', '--all', 'origin']);
  const push = remoteUrlLines(projectRoot, ['remote', 'get-url', '--push', '--all', 'origin']);
  if (fetch.length !== 1 || push.length !== 1) fail('origin fetch and push URLs must each be unambiguous');
  const fetchUrl = assertSafeRemoteUrl(fetch[0]); const pushUrl = assertSafeRemoteUrl(push[0]);
  const lines = remoteUrlLines(projectRoot, ['ls-remote', '--refs', pushUrl, `refs/heads/${base}`]);
  if (lines.length !== 1 || !/^[0-9a-f]{40,64}\s+refs\/heads\//.test(lines[0])) fail(`remote base branch is missing or ambiguous: ${base}`);
  return { fetch_url: fetchUrl, push_url: pushUrl, remote_base_oid: lines[0].split(/\s+/)[0], github_repo: githubRepo(fetchUrl) };
}

function assertGuard(projectRoot, branch) {
  const guard = checkBranch(projectRoot, branch);
  if (!guard.allowed) fail(`finisher guard blocks ${branch}`);
}

function remoteBranchOid(projectRoot, remoteUrl, branch) {
  const lines = remoteUrlLines(projectRoot, ['ls-remote', '--refs', remoteUrl, `refs/heads/${branch}`]);
  if (!lines.length) return null;
  if (lines.length !== 1 || !/^[0-9a-f]{40,64}\s+refs\/heads\//.test(lines[0])) fail(`remote phase branch is ambiguous: ${branch}`);
  return lines[0].split(/\s+/)[0];
}

function nativePromotionPlan({ projectRoot, state, evidence, explicitBase }) {
  if (state.git.schema_version !== 1 || state.git.topology !== 'stacked_phase_branches') fail(`RIFF wave ${state.run} has an unsupported Git topology`);
  const base = state.git.base_branch;
  if (explicitBase && explicitBase.replace(/^origin\//, '') !== base) fail(`selected base does not match the evidence-bound wave base: ${base}`);
  const destination = resolveDestination(projectRoot, base);
  if (!destination.github_repo) fail('native phase promotion requires a GitHub origin');
  if (githubBranchOid(projectRoot, destination.github_repo, base) !== destination.remote_base_oid) fail('GitHub and push-remote base identities differ');
  const dirty = currentChanges(projectRoot);
  if (hasPreStagedChanges(projectRoot) || dirty.some((entry) => entry !== 'ROADMAP.yaml')) fail(`dirty or staged paths block phase promotion: ${dirty.join(', ')}`);
  const headRoadmap = Buffer.from(git(projectRoot, ['show', `${state.git.tip_oid}:ROADMAP.yaml`]).stdout || '').toString('utf8');
  let expectedRoadmap = headRoadmap;
  for (const phaseId of evidence.phase_ids) expectedRoadmap = roadmapTextWithPhaseStatus(expectedRoadmap, phaseId, 'done');
  const currentRoadmap = fs.readFileSync(path.join(projectRoot, 'ROADMAP.yaml'), 'utf8');
  if (currentRoadmap !== expectedRoadmap) fail('ROADMAP.yaml contains changes not produced by the completed wave');

  for (let index = 0; index < state.phases.length; index += 1) {
    const record = state.phases[index];
    const attempt = record.attempts?.at(-1);
    if (record.status !== 'completed' || attempt?.delivery?.state !== 'committed'
      || attempt.delivery.publication?.state !== 'pr_open' || !attempt.delivery.publication.url) {
      fail(`phase PR publication evidence is incomplete: ${record.id}`);
    }
    const { ledger, head } = validateActionDelivery(projectRoot, attempt.native_phase);
    if (ledger.branch !== attempt.delivery.branch || head !== attempt.delivery.head_oid) fail(`phase delivery changed after publication: ${record.id}`);
    assertGuard(projectRoot, ledger.branch);
    const viewed = runGh(projectRoot, ['pr', 'view', attempt.delivery.publication.url, '-R', destination.github_repo, '--json', 'url,state,headRefOid,headRefName,baseRefName,isDraft']);
    let pull;
    try { pull = JSON.parse(viewed.stdout); } catch { fail(`GitHub returned malformed phase PR data: ${record.id}`); }
    if (!pull || pull.url !== attempt.delivery.publication.url || pull.headRefOid !== head || pull.headRefName !== ledger.branch) fail(`phase PR identity is stale or tampered: ${record.id}`);
    if (pull.state === 'MERGED') {
      if (pull.baseRefName !== base) fail(`merged phase PR was not promoted to the evidence-bound base: ${record.id}`);
      if (!githubContainsCommit(projectRoot, destination.github_repo, head, destination.remote_base_oid)) fail(`merged phase PR did not preserve its action commits on ${base}: ${record.id}`);
      continue;
    }
    if (remoteBranchOid(projectRoot, destination.push_url, ledger.branch) !== head) fail(`remote phase branch is missing, stale, or tampered: ${ledger.branch}`);
    if (pull.state !== 'OPEN' || pull.isDraft) fail(`phase PR is not eligible for explicit promotion: ${record.id}`);
    if (![ledger.base_branch, base].includes(pull.baseRefName)) fail(`phase PR base is stale or tampered: ${record.id}`);
    const plan = {
      schema_version: 2,
      mode: 'phase_pr_promotion',
      run: evidence.run,
      provider: evidence.provider,
      strategy: 'github_button',
      phase_id: record.id,
      phase_index: index + 1,
      phase_count: state.phases.length,
      branch: ledger.branch,
      base,
      pr_base: pull.baseRefName,
      required_base: base,
      head,
      remote_base_oid: destination.remote_base_oid,
      url: pull.url,
      action_count: ledger.actions.length,
      action_commits: ledger.actions.map((action) => action.commit_oid),
      phase_evidence_commit: ledger.phase_commit_oid,
      completion_evidence_sha256: evidence.completion_evidence_sha256,
      mechanical_evidence_sha256: evidence.mechanical.artifact_sha256,
      semantic_evidence_sha256: evidence.semantic.artifact_sha256,
      roadmap_sha256: sha256(currentRoadmap),
      required_merge_method: 'merge_commit',
      intended_actions: pull.baseRefName === base ? ['merge_pr_with_merge_commit_in_github'] : ['retarget_pr_to_promoted_base', 'merge_pr_with_merge_commit_in_github'],
    };
    return { projectRoot, plan, token: sha256(canonical(plan)) };
  }
  fail(`all phase pull requests for RIFF wave ${state.run} are already merged`);
}

export function buildFinishPlan({ projectRoot: requestedRoot = process.cwd(), runId, base: explicitBase } = {}) {
  const projectRoot = resolveProjectRoot(requestedRoot);
  const frameworkRoot = resolveFrameworkRoot(projectRoot);
  if (path.resolve(frameworkRoot) !== path.resolve(scriptFrameworkRoot)) fail('project .riff link does not match this RIFF finisher');
  const selectedRun = runId || latestCompletedRun(projectRoot);
  const state = readWaveState(projectRoot, selectedRun);
  const evidence = inspectCompletedWaveEvidence({ projectRoot, frameworkRoot, runId: selectedRun });
  if (!state.git) {
    fail(`RIFF wave ${selectedRun} predates action delivery; per-action commits and hook receipts cannot be reconstructed safely. Rerun the phases from a clean planning baseline`);
  }
  return nativePromotionPlan({ projectRoot, state, evidence, explicitBase });
}

function runGh(projectRoot, args, allowFailure = false) {
  const result = spawnSync(process.env.RIFF_GH_BIN || 'gh', args, { cwd: projectRoot, encoding: 'utf8', shell: false, timeout: 30_000, maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error) fail(`gh ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) fail(`gh ${args.join(' ')} failed: ${(result.stderr || '').trim() || `exit ${result.status}`}`);
  return result;
}

function githubBranchOid(projectRoot, repo, branch) {
  const result = runGh(projectRoot, ['api', `repos/${repo}/git/ref/heads/${encodeURIComponent(branch)}`, '--jq', '.object.sha']);
  const oid = result.stdout.trim();
  if (!/^[a-f0-9]{40,64}$/.test(oid)) fail(`GitHub returned an invalid base OID: ${branch}`);
  return oid;
}

function githubContainsCommit(projectRoot, repo, ancestor, descendant) {
  const result = runGh(projectRoot, ['api', `repos/${repo}/compare/${ancestor}...${descendant}`, '--jq', '.status']);
  return ['ahead', 'identical'].includes(result.stdout.trim());
}

function confirm(planResult, suppliedToken) {
  if (!SHA256.test(suppliedToken || '')) fail('confirmation token must be a SHA-256 value');
  const actual = Buffer.from(planResult.token, 'utf8');
  const supplied = Buffer.from(suppliedToken, 'utf8');
  if (actual.length !== supplied.length || !timingSafeEqual(actual, supplied)) fail('confirmation token is stale or does not match the current finish plan; run --check again');
  const { plan } = planResult;
  return {
    action: 'awaiting_github_merge',
    url: plan.url,
    boundary: plan.pr_base === plan.required_base
      ? 'Merge this evidence-bound phase pull request in GitHub using the merge-commit method. Do not squash or rebase it. RIFF did not merge it.'
      : `Retarget this pull request to ${plan.required_base}, verify the resulting diff, then merge it in GitHub using the merge-commit method. Do not squash or rebase it. RIFF did not retarget or merge it.`,
  };
}

export function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.help) { process.stdout.write(usage()); return; }
  const result = buildFinishPlan({ projectRoot: options.projectRoot, runId: options.runId, base: options.base });
  if (options.check) {
    const next = [path.join(result.projectRoot, '.riff', 'riff'), 'finish', '--confirm', result.token, '--run', result.plan.run, '--project-root', result.projectRoot, '--base', result.plan.base].map(posixQuote).join(' ');
    if (options.json) process.stdout.write(`${JSON.stringify({ ok: true, no_action: true, plan: result.plan, token: result.token, next_command: next }, null, 2)}\n`);
    else process.stdout.write(`RIFF finish check passed. No action occurred.\nRun: ${result.plan.run}\nPhase: ${result.plan.phase_id}\nPR: ${result.plan.url}\nStrategy: ${result.plan.strategy}\nConfirmation token: ${result.token}\nNext command: ${next}\n`);
    return;
  }
  const outcome = confirm(result, options.confirm);
  if (options.json) process.stdout.write(`${JSON.stringify({ ok: true, plan: result.plan, outcome }, null, 2)}\n`);
  else process.stdout.write(`RIFF finish completed: ${outcome.action}\n${outcome.url ? `PR: ${outcome.url}\n${outcome.boundary}\n` : ''}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { process.stderr.write(`riff finish: ${error.message}\n`); process.exitCode = 1; }
}

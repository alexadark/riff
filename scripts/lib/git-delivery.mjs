import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { assertGitHookDispatchers } from './git-hooks.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const OID = /^[a-f0-9]{40,64}$/;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fail(message) { throw new Error(message); }
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
export function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

function gitEnvironment(extra = {}) {
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ...extra };
  for (const key of ['GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_AUTHOR_DATE', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL', 'GIT_COMMITTER_DATE']) delete env[key];
  return env;
}

function git(projectRoot, args, { input, allowFailure = false, env = {} } = {}) {
  const result = spawnSync('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd: projectRoot,
    encoding: 'buffer',
    input,
    env: gitEnvironment(env),
    timeout: 120_000,
    killSignal: 'SIGKILL',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (result.error) fail(`git ${args[0]} failed: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) {
    fail(`git ${args.join(' ')} failed: ${Buffer.from(result.stderr || '').toString('utf8').trim() || `exit ${result.status}`}`);
  }
  return result;
}
function gitText(projectRoot, args, options) { return Buffer.from(git(projectRoot, args, options).stdout || '').toString('utf8').trim(); }
function nul(buffer) { const values = Buffer.from(buffer || '').toString('utf8').split('\0'); values.pop(); return values; }
function unique(values) { return [...new Set(values)].sort(); }

function safeRelative(relative) {
  return typeof relative === 'string' && relative.length > 0 && !path.isAbsolute(relative)
    && !relative.split('/').some((part) => !part || part === '.' || part === '..')
    && !relative.split('/').includes('.git');
}

function lstatOrNull(file) {
  try { return fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
}

function assertSafeAncestors(root, relative, { allowLeafSymlink = false } = {}) {
  if (!safeRelative(relative)) fail(`unsafe delivery path: ${relative}`);
  let current = root;
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = lstatOrNull(current);
    if (!stat) break;
    if (stat.isSymbolicLink() && !(allowLeafSymlink && index === parts.length - 1)) fail(`delivery path contains a symlink ancestor: ${relative}`);
    if (index < parts.length - 1 && !stat.isDirectory()) fail(`delivery path ancestor is not a directory: ${relative}`);
  }
  return path.join(root, relative);
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const existing = lstatOrNull(file);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) fail(`delivery state must be a regular file: ${file}`);
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const descriptor = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
}

export function actionLedgerPath(projectRoot, phase) {
  if (!SAFE_ID.test(phase)) fail(`invalid delivery phase: ${phase}`);
  return path.join(projectRoot, '.planning', 'riff-next', `${phase}.actions.json`);
}
export function deliveryEvidencePath(projectRoot, phase) {
  if (!SAFE_ID.test(phase)) fail(`invalid delivery phase: ${phase}`);
  return path.join(projectRoot, '.planning', 'phases', phase, 'DELIVERY.json');
}

export function readActionLedger(projectRoot, phase) {
  const file = actionLedgerPath(projectRoot, phase);
  const stat = lstatOrNull(file);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail(`action ledger is missing or unsafe: ${phase}`);
  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { fail(`action ledger is malformed: ${phase}`); }
  if (!ledger || ledger.schema_version !== 1 || ledger.phase !== phase || !OID.test(ledger.base_oid)
    || !Array.isArray(ledger.actions) || typeof ledger.branch !== 'string' || !ledger.branch.startsWith('riff/phase-')) {
    fail(`action ledger is invalid: ${phase}`);
  }
  for (const action of ledger.actions) {
    const { evidence_sha256: evidenceSha256, commit_oid, hook_receipts, commit_attempt, ...evidence } = action;
    if (!SHA256.test(evidenceSha256) || evidenceSha256 !== sha256(canonical(evidence))) fail(`action evidence hash is invalid: ${action.action_id || phase}`);
  }
  if (['validated', 'committing', 'committed'].includes(ledger.state)) {
    const validated = {
      phase: ledger.phase,
      branch: ledger.branch,
      base_oid: ledger.base_oid,
      provider: ledger.provider,
      model: ledger.model,
      agent: ledger.agent,
      plan_path: ledger.plan_path,
      route: ledger.route,
      plan_sha256: ledger.plan_sha256,
      routing_sha256: ledger.routing_sha256,
      validation_evidence: ledger.validation_evidence,
      actions: ledger.actions.map(({ commit_oid, hook_receipts, commit_attempt, ...action }) => action),
    };
    if (!SHA256.test(ledger.validated_evidence_sha256) || ledger.validated_evidence_sha256 !== sha256(canonical(validated))) fail(`validated action ledger hash is invalid: ${phase}`);
  }
  return ledger;
}

export function initializeActionLedger({ projectRoot, phase, branch, baseBranch, baseOid, provider, model, agent = 'worker', planPath, planSha256, routingSha256, route }) {
  if (!SAFE_ID.test(phase) || typeof branch !== 'string' || !branch.startsWith('riff/phase-')) fail('invalid action ledger identity');
  if (!OID.test(baseOid) || !SHA256.test(planSha256) || !SHA256.test(routingSha256)) fail('invalid action ledger hashes');
  const file = actionLedgerPath(projectRoot, phase);
  if (lstatOrNull(file)) fail(`action ledger already exists: ${phase}`);
  const ledger = {
    schema_version: 1,
    phase,
    branch,
    base_branch: baseBranch,
    base_oid: baseOid,
    provider,
    model,
    agent,
    plan_path: planPath,
    route,
    plan_sha256: planSha256,
    routing_sha256: routingSha256,
    state: 'capturing',
    actions: [],
    phase_commit_oid: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  atomicJson(file, ledger);
  return ledger;
}

function blobRecord(projectRoot, sourceRoot, relative) {
  const absolute = assertSafeAncestors(sourceRoot, relative, { allowLeafSymlink: true });
  const stat = lstatOrNull(absolute);
  if (!stat) return { path: relative, kind: 'deleted' };
  let bytes;
  let mode;
  if (stat.isSymbolicLink()) { bytes = Buffer.from(fs.readlinkSync(absolute)); mode = '120000'; }
  else if (stat.isFile()) { bytes = fs.readFileSync(absolute); mode = (stat.mode & 0o111) ? '100755' : '100644'; }
  else return null;
  const oid = gitText(projectRoot, ['hash-object', '-w', '--stdin'], { input: bytes });
  if (!OID.test(oid)) fail(`Git returned an invalid blob OID for ${relative}`);
  return { path: relative, kind: 'blob', mode, oid, sha256: sha256(bytes) };
}

function walkOwned(projectRoot, sourceRoot, relative, records) {
  const absolute = assertSafeAncestors(sourceRoot, relative, { allowLeafSymlink: true });
  const stat = lstatOrNull(absolute);
  if (!stat) return;
  if (stat.isDirectory() && !stat.isSymbolicLink()) {
    for (const entry of fs.readdirSync(absolute).sort()) walkOwned(projectRoot, sourceRoot, `${relative}/${entry}`, records);
    return;
  }
  const record = blobRecord(projectRoot, sourceRoot, relative);
  if (record) records[relative] = record;
}

export function captureOwnedState({ projectRoot, sourceRoot, ownedPaths }) {
  const records = {};
  for (const relative of unique(ownedPaths)) walkOwned(projectRoot, sourceRoot, relative, records);
  return records;
}

function recordForPath(projectRoot, sourceRoot, relative, capturedBefore) {
  const after = blobRecord(projectRoot, sourceRoot, relative);
  const before = capturedBefore[relative] || { path: relative, kind: 'deleted' };
  if (!after && !before) return null;
  return { before, after: after || { path: relative, kind: 'deleted' } };
}

export function appendActionEvidence({ projectRoot, phase, task, waveNumber, ordinal, ownedPaths, changedPaths, beforeState, afterRoot, workerOutputSha256 }) {
  const ledger = readActionLedger(projectRoot, phase);
  if (ledger.state !== 'capturing') fail(`action ledger is not capturing: ${phase}`);
  const actionId = `task-${task.number}`;
  if (ledger.actions.some((action) => action.action_id === actionId)) fail(`duplicate action evidence: ${actionId}`);
  const records = {};
  for (const relative of unique(changedPaths)) {
    const record = recordForPath(projectRoot, afterRoot, relative, beforeState);
    if (record && (record.before.kind === 'blob' || record.after.kind === 'blob')) records[relative] = record;
  }
  const paths = Object.keys(records).sort();
  if (!paths.length) fail(`action ${actionId} has no Git-addressable file delta`);
  const evidence = {
    action_id: actionId,
    task_number: task.number,
    label: task.label,
    wave_number: waveNumber,
    ordinal,
    owned_paths: unique(ownedPaths),
    changed_paths: paths,
    records,
    worker_output_sha256: workerOutputSha256,
  };
  const action = { ...evidence, evidence_sha256: sha256(canonical(evidence)), commit_oid: null, hook_receipts: null };
  ledger.actions.push(action);
  ledger.updated_at = new Date().toISOString();
  atomicJson(actionLedgerPath(projectRoot, phase), ledger);
  return action;
}

export function freezeActionLedger(projectRoot, phase, { validationEvidencePaths = [] } = {}) {
  const ledger = readActionLedger(projectRoot, phase);
  if (ledger.state !== 'capturing' || !ledger.actions.length) fail(`action ledger cannot be frozen: ${phase}`);
  ledger.actions.sort((left, right) => left.ordinal - right.ordinal);
  ledger.validation_evidence = Object.fromEntries(unique(validationEvidencePaths).map((relative) => {
    if (!safeRelative(relative)) fail(`unsafe validation evidence path: ${relative}`);
    const file = assertSafeAncestors(projectRoot, relative);
    const stat = lstatOrNull(file);
    if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail(`validation evidence is missing or unsafe: ${relative}`);
    return [relative, sha256(fs.readFileSync(file))];
  }));
  ledger.state = 'validated';
  ledger.validated_evidence_sha256 = sha256(canonical({
    phase: ledger.phase,
    branch: ledger.branch,
    base_oid: ledger.base_oid,
    provider: ledger.provider,
    model: ledger.model,
    agent: ledger.agent,
    plan_path: ledger.plan_path,
    route: ledger.route,
    plan_sha256: ledger.plan_sha256,
    routing_sha256: ledger.routing_sha256,
    validation_evidence: ledger.validation_evidence,
    actions: ledger.actions.map(({ commit_oid, hook_receipts, commit_attempt, ...action }) => action),
  }));
  ledger.updated_at = new Date().toISOString();
  atomicJson(actionLedgerPath(projectRoot, phase), ledger);
  return ledger;
}

function currentChanges(projectRoot) {
  const unstaged = nul(git(projectRoot, ['diff', '--name-only', '-z', '--no-ext-diff']).stdout);
  const staged = nul(git(projectRoot, ['diff', '--cached', '--name-only', '-z', '--no-ext-diff']).stdout);
  const untracked = nul(git(projectRoot, ['ls-files', '--others', '--exclude-standard', '-z']).stdout);
  const conflicts = nul(git(projectRoot, ['diff', '--name-only', '-z', '--diff-filter=U']).stdout);
  if (conflicts.length) fail(`merge conflicts block delivery: ${conflicts.join(', ')}`);
  return { all: unique([...unstaged, ...staged, ...untracked]), staged: unique(staged) };
}

export function assertCleanDeliveryStart(projectRoot, { allowed = [] } = {}) {
  const changes = currentChanges(projectRoot);
  if (changes.staged.length) fail(`pre-staged paths block RIFF delivery: ${changes.staged.join(', ')}`);
  const permitted = (candidate) => allowed.some((entry) => candidate === entry || candidate.startsWith(`${entry}/`));
  const unrelated = changes.all.filter((candidate) => !permitted(candidate));
  if (unrelated.length) fail(`dirty paths outside runner authority block RIFF delivery: ${unrelated.join(', ')}`);
  return changes;
}

export function preparePhaseBranch({ projectRoot, branch, baseBranch, baseOid, resume = false }) {
  if (typeof branch !== 'string' || !branch.startsWith('riff/phase-')) fail(`invalid phase branch: ${branch}`);
  if (git(projectRoot, ['check-ref-format', '--branch', branch], { allowFailure: true }).status !== 0) fail(`invalid phase branch: ${branch}`);
  if (!OID.test(baseOid)) fail('invalid phase base OID');
  const currentBranch = gitText(projectRoot, ['branch', '--show-current']);
  const head = gitText(projectRoot, ['rev-parse', 'HEAD']);
  const exists = git(projectRoot, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { allowFailure: true }).status === 0;
  if (resume) {
    if (!exists) fail(`resume phase branch is missing: ${branch}`);
    if (currentBranch !== branch) git(projectRoot, ['switch', branch]);
    return { branch, base_branch: baseBranch, base_oid: baseOid, head: gitText(projectRoot, ['rev-parse', 'HEAD']) };
  }
  if (exists) fail(`phase branch already exists and will not be rewritten: ${branch}`);
  if (head !== baseOid) fail(`phase base changed before branch creation: expected ${baseOid}, found ${head}`);
  git(projectRoot, ['switch', '-c', branch]);
  return { branch, base_branch: baseBranch, base_oid: baseOid, head: baseOid };
}

function committedRecord(projectRoot, ref, relative) {
  const rows = nul(git(projectRoot, ['ls-tree', '-z', ref, '--', relative]).stdout);
  if (!rows.length) return { path: relative, kind: 'deleted' };
  if (rows.length !== 1) fail(`commit contains an ambiguous path: ${relative}`);
  const match = rows[0].match(/^(\d+)\s+blob\s+([a-f0-9]{40,64})\t/);
  if (!match) fail(`commit contains an unsafe path entry: ${relative}`);
  const bytes = git(projectRoot, ['cat-file', 'blob', match[2]]).stdout;
  return { path: relative, kind: 'blob', mode: match[1], oid: match[2], sha256: sha256(bytes) };
}

function sameRecord(left, right) {
  return left.kind === right.kind && (left.kind === 'deleted'
    || left.mode === right.mode && left.oid === right.oid && left.sha256 === right.sha256);
}

function writeRecord(projectRoot, record) {
  const target = assertSafeAncestors(projectRoot, record.path, { allowLeafSymlink: true });
  const existing = lstatOrNull(target);
  if (record.kind === 'deleted') {
    if (!existing) return;
    if (existing.isDirectory() && !existing.isSymbolicLink()) fs.rmSync(target, { recursive: true });
    else fs.unlinkSync(target);
    return;
  }
  const bytes = git(projectRoot, ['cat-file', 'blob', record.oid]).stdout;
  if (sha256(bytes) !== record.sha256) fail(`Git blob changed for ${record.path}`);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o755 });
  const parentRelative = path.posix.dirname(record.path);
  if (parentRelative !== '.') assertSafeAncestors(projectRoot, parentRelative);
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(5).toString('hex')}.tmp`;
  if (record.mode === '120000') fs.symlinkSync(bytes.toString('utf8'), temporary);
  else {
    const descriptor = fs.openSync(temporary, 'wx', record.mode === '100755' ? 0o755 : 0o644);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    fs.chmodSync(temporary, record.mode === '100755' ? 0o755 : 0o644);
  }
  if (existing) {
    if (existing.isDirectory() && !existing.isSymbolicLink()) fs.rmSync(target, { recursive: true });
    else fs.unlinkSync(target);
  }
  fs.renameSync(temporary, target);
}

function commitMatchesAction(projectRoot, oid, parent, action) {
  if (!OID.test(oid) || gitText(projectRoot, ['rev-parse', `${oid}^`]) !== parent) return false;
  const changed = unique(nul(git(projectRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', oid]).stdout));
  if (JSON.stringify(changed) !== JSON.stringify(action.changed_paths)) return false;
  return action.changed_paths.every((relative) => sameRecord(committedRecord(projectRoot, oid, relative), action.records[relative].after));
}

function validateReceipt(projectRoot, file, expected) {
  const stat = lstatOrNull(file);
  if (!stat || !stat.isFile() || stat.isSymbolicLink()) fail(`Git hook receipt is missing: ${path.basename(file)}`);
  const bytes = fs.readFileSync(file);
  let receipt;
  try { receipt = JSON.parse(bytes.toString('utf8')); } catch { fail(`Git hook receipt is malformed: ${path.basename(file)}`); }
  if (receipt.schema_version !== 1 || receipt.event !== expected.event || !/^[a-f0-9]{32}$/.test(receipt.nonce || '')
    || sha256(receipt.nonce) !== expected.nonceSha256 || receipt.action_id !== expected.actionId
    || receipt.tree_oid !== expected.treeOid || !SHA256.test(receipt.riff_hook_sha256 || '')) {
    fail(`Git hook receipt does not match ${expected.actionId}: ${expected.event}`);
  }
  return { ...receipt, receipt_sha256: sha256(bytes) };
}

function actionCommitMessage(ledger, action) {
  const title = action.label.replace(/^Task\s+[0-9]+:\s*/, '').trim();
  return `feat: ${title}\n\nPhase: ${ledger.phase}\nWave: ${action.wave_number}\nAction: ${action.action_id}\nAgent: ${ledger.agent || 'worker'}\nModel: ${ledger.model || 'unknown'}\nPlan: ${ledger.plan_path || `.planning/phases/${ledger.phase}/PLAN.md`}\nProvider: ${ledger.provider}\nRoute: ${ledger.route}\nPlan-SHA256: ${ledger.plan_sha256}\nAction-Evidence-SHA256: ${action.evidence_sha256}\nRouting-Receipt-SHA256: ${ledger.routing_sha256}`;
}

function receiptDirectory(projectRoot, ledger, action) {
  return path.join(projectRoot, '.planning', 'riff-next', 'hook-receipts', ledger.phase, action.action_id);
}

function newCommitAttempt(projectRoot, ledger, action, parentOid, paths) {
  const treeOid = gitText(projectRoot, ['write-tree']);
  const nonce = crypto.randomBytes(16).toString('hex');
  return { nonce, attempt: {
    nonce_sha256: sha256(nonce),
    parent_oid: parentOid,
    tree_oid: treeOid,
    paths: unique(paths),
  } };
}

function assertCommitAttempt(attempt, parentOid, paths) {
  if (!attempt || !SHA256.test(attempt.nonce_sha256 || '')
    || attempt.parent_oid !== parentOid || !OID.test(attempt.tree_oid)
    || JSON.stringify(attempt.paths) !== JSON.stringify(unique(paths))) {
    fail('persisted Git commit attempt does not match the authoritative transaction');
  }
  return attempt;
}

function commitMatchesAttempt(projectRoot, oid, attempt) {
  if (!OID.test(oid) || gitText(projectRoot, ['rev-parse', `${oid}^`]) !== attempt.parent_oid) return false;
  if (gitText(projectRoot, ['show', '-s', '--format=%T', oid]) !== attempt.tree_oid) return false;
  const changed = unique(nul(git(projectRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', oid]).stdout));
  return JSON.stringify(changed) === JSON.stringify(attempt.paths);
}

function receiptsForAttempt(projectRoot, ledger, action, attempt, oid) {
  if (!commitMatchesAttempt(projectRoot, oid, attempt)) fail(`created commit does not match persisted transaction: ${action.action_id}`);
  const receiptDir = receiptDirectory(projectRoot, ledger, action);
  return Object.fromEntries(['pre-commit', 'commit-msg'].map((event) => [event, validateReceipt(
    projectRoot,
    path.join(receiptDir, `${event}.json`),
    { event, nonceSha256: attempt.nonce_sha256, actionId: action.action_id, treeOid: attempt.tree_oid },
  )]));
}

function commitOne(projectRoot, ledger, action, message, attempt, nonce) {
  assertCommitAttempt(attempt, attempt.parent_oid, attempt.paths);
  if (gitText(projectRoot, ['write-tree']) !== attempt.tree_oid) fail(`staged tree changed before commit: ${action.action_id}`);
  const receiptDir = receiptDirectory(projectRoot, ledger, action);
  fs.mkdirSync(receiptDir, { recursive: true, mode: 0o700 });
  for (const event of ['pre-commit', 'commit-msg']) fs.rmSync(path.join(receiptDir, `${event}.json`), { force: true });
  const env = {
    RIFF_GIT_HOOK_RECEIPT_DIR: receiptDir,
    RIFF_GIT_HOOK_NONCE: nonce,
    RIFF_GIT_ACTION_ID: action.action_id,
    RIFF_GIT_EXPECTED_TREE_OID: attempt.tree_oid,
  };
  git(projectRoot, ['commit', '--no-gpg-sign', '-m', message], { env });
  const oid = gitText(projectRoot, ['rev-parse', 'HEAD']);
  const receipts = receiptsForAttempt(projectRoot, ledger, action, attempt, oid);
  for (const [event, receipt] of Object.entries(receipts)) {
    const hookName = event === 'pre-commit' ? 'security-scan.sh' : 'commit-msg.sh';
    const hookPath = path.join(projectRoot, '.riff', 'hooks', hookName);
    const hookStat = lstatOrNull(hookPath);
    if (!hookStat?.isFile() || hookStat.isSymbolicLink() || receipt.riff_hook_sha256 !== sha256(fs.readFileSync(hookPath))) {
      fail(`Git hook source changed during commit: ${action.action_id}:${event}`);
    }
  }
  return { oid, receipts };
}

function stageExact(projectRoot, paths) {
  git(projectRoot, ['reset', '-q', 'HEAD', '--', ...paths], { allowFailure: true });
  git(projectRoot, ['add', '-A', '--', ...paths]);
  const staged = unique(nul(git(projectRoot, ['diff', '--cached', '--name-only', '-z']).stdout));
  if (JSON.stringify(staged) !== JSON.stringify(unique(paths))) fail(`staged paths differ from the action boundary: ${staged.join(', ')}`);
}

function deliveryEvidenceFromLedger(ledger) {
  return {
    schema_version: 1,
    phase: ledger.phase,
    branch: ledger.branch,
    base_branch: ledger.base_branch,
    base_oid: ledger.base_oid,
    provider: ledger.provider,
    model: ledger.model,
    agent: ledger.agent,
    plan_path: ledger.plan_path,
    route: ledger.route,
    plan_sha256: ledger.plan_sha256,
    routing_sha256: ledger.routing_sha256,
    validated_evidence_sha256: ledger.validated_evidence_sha256,
    actions: ledger.actions.map((action) => ({
      action_id: action.action_id,
      label: action.label,
      wave_number: action.wave_number,
      changed_paths: action.changed_paths,
      evidence_sha256: action.evidence_sha256,
      commit_oid: action.commit_oid,
      hook_receipts: action.hook_receipts,
    })),
  };
}

export function commitActionLedger({ projectRoot, phase, evidencePaths = [], expectedValidatedSha256, testHooks = {} }) {
  assertGitHookDispatchers(projectRoot);
  let ledger = readActionLedger(projectRoot, phase);
  if (!['validated', 'committing', 'committed'].includes(ledger.state)) fail(`action ledger is not validated: ${phase}`);
  if (expectedValidatedSha256 && ledger.validated_evidence_sha256 !== expectedValidatedSha256) fail(`action ledger no longer matches runner state: ${phase}`);
  for (const [relative, expected] of Object.entries(ledger.validation_evidence || {})) {
    if (!safeRelative(relative) || !SHA256.test(expected)) fail(`validation evidence binding is invalid: ${relative}`);
    const file = assertSafeAncestors(projectRoot, relative);
    const stat = lstatOrNull(file);
    if (!stat?.isFile() || stat.isSymbolicLink() || sha256(fs.readFileSync(file)) !== expected) fail(`validated evidence changed before delivery: ${relative}`);
  }
  if (ledger.state === 'validated') {
    const finalRecords = new Map();
    for (const action of ledger.actions) for (const relative of action.changed_paths) finalRecords.set(relative, action.records[relative].after);
    for (const [relative, expected] of finalRecords) {
      const current = blobRecord(projectRoot, projectRoot, relative) || { path: relative, kind: 'deleted' };
      if (!sameRecord(current, expected)) fail(`reviewed aggregate changed before delivery: ${relative}`);
    }
  }
  if (ledger.state === 'committed') return validateActionDelivery(projectRoot, phase).ledger;
  const productPaths = unique(ledger.actions.flatMap((action) => action.changed_paths));
  const exactRunnerPaths = new Set([
    'ROADMAP.yaml',
    ...evidencePaths,
    path.relative(projectRoot, actionLedgerPath(projectRoot, phase)).replaceAll(path.sep, '/'),
    path.relative(projectRoot, deliveryEvidencePath(projectRoot, phase)).replaceAll(path.sep, '/'),
    `.planning/riff-next/${phase}.json`,
  ]);
  for (const candidate of ledger.phase_commit_attempt?.paths || []) exactRunnerPaths.add(candidate);
  const receiptPrefix = `.planning/riff-next/hook-receipts/${phase}/`;
  const runnerOwned = (candidate) => exactRunnerPaths.has(candidate) || candidate.startsWith(receiptPrefix);
  const dirty = currentChanges(projectRoot);
  if (dirty.staged.length) {
    const outside = dirty.staged.filter((candidate) => !productPaths.includes(candidate) && !runnerOwned(candidate));
    if (outside.length) fail(`pre-staged paths outside the pending action block delivery: ${outside.join(', ')}`);
  }
  const unrelated = dirty.all.filter((candidate) => !productPaths.includes(candidate)
    && !runnerOwned(candidate));
  if (unrelated.length) fail(`dirty paths outside runner authority block action commits: ${unrelated.join(', ')}`);

  ledger.state = 'committing';
  ledger.updated_at = new Date().toISOString();
  atomicJson(actionLedgerPath(projectRoot, phase), ledger);
  let parent = ledger.base_oid;
  let firstPending = ledger.actions.findIndex((action) => !action.commit_oid);
  for (let index = 0; index < ledger.actions.length; index += 1) {
    const action = ledger.actions[index];
    if (!action.commit_oid) break;
    if (!commitMatchesAction(projectRoot, action.commit_oid, parent, action)) fail(`recorded action commit is invalid: ${action.action_id}`);
    const attempt = assertCommitAttempt(action.commit_attempt, parent, action.changed_paths);
    const diskReceipts = receiptsForAttempt(projectRoot, ledger, action, attempt, action.commit_oid);
    if (canonical(diskReceipts) !== canonical(action.hook_receipts)) fail(`recorded Git hook receipts changed: ${action.action_id}`);
    parent = action.commit_oid;
  }
  if (firstPending < 0) firstPending = ledger.actions.length;
  let head = gitText(projectRoot, ['rev-parse', 'HEAD']);
  if (firstPending < ledger.actions.length && head !== parent) {
    const pending = ledger.actions[firstPending];
    const attempt = assertCommitAttempt(pending.commit_attempt, parent, pending.changed_paths);
    if (!commitMatchesAction(projectRoot, head, parent, pending) || !commitMatchesAttempt(projectRoot, head, attempt)) fail(`Git HEAD diverged during action commit recovery: ${head}`);
    pending.commit_oid = head;
    pending.hook_receipts = receiptsForAttempt(projectRoot, ledger, pending, attempt, head);
    parent = head;
    firstPending += 1;
    ledger.updated_at = new Date().toISOString();
    atomicJson(actionLedgerPath(projectRoot, phase), ledger);
  }

  if (firstPending === 0) {
    const initial = new Map();
    for (const action of ledger.actions) for (const relative of action.changed_paths) if (!initial.has(relative)) initial.set(relative, action.records[relative].before);
    for (const record of initial.values()) writeRecord(projectRoot, record);
    git(projectRoot, ['reset', '-q', 'HEAD', '--', ...productPaths], { allowFailure: true });
  }

  for (let index = firstPending; index < ledger.actions.length; index += 1) {
    const action = ledger.actions[index];
    for (const relative of action.changed_paths) {
      const before = committedRecord(projectRoot, 'HEAD', relative);
      if (!sameRecord(before, action.records[relative].before)) fail(`action before-state does not match HEAD: ${action.action_id}:${relative}`);
      writeRecord(projectRoot, action.records[relative].after);
    }
    stageExact(projectRoot, action.changed_paths);
    const treeOid = gitText(projectRoot, ['write-tree']);
    const createdAttempt = newCommitAttempt(projectRoot, ledger, action, parent, action.changed_paths);
    action.commit_attempt = createdAttempt.attempt;
    ledger.updated_at = new Date().toISOString();
    atomicJson(actionLedgerPath(projectRoot, phase), ledger);
    const attempt = assertCommitAttempt(action.commit_attempt, parent, action.changed_paths);
    if (attempt.tree_oid !== treeOid) fail(`action staged tree differs from its persisted attempt: ${action.action_id}`);
    const committed = commitOne(projectRoot, ledger, action, actionCommitMessage(ledger, action), attempt, createdAttempt.nonce);
    testHooks.afterCommit?.({ kind: 'action', actionId: action.action_id, oid: committed.oid });
    if (!commitMatchesAction(projectRoot, committed.oid, parent, action)) fail(`created commit does not match action evidence: ${action.action_id}`);
    action.commit_oid = committed.oid;
    action.hook_receipts = committed.receipts;
    parent = committed.oid;
    ledger.updated_at = new Date().toISOString();
    atomicJson(actionLedgerPath(projectRoot, phase), ledger);
  }

  const evidence = deliveryEvidenceFromLedger(ledger);
  atomicJson(deliveryEvidencePath(projectRoot, phase), evidence);
  const existingEvidence = evidencePaths.filter((relative) => lstatOrNull(path.join(projectRoot, relative)));
  const metadataPaths = unique([...existingEvidence, path.relative(projectRoot, deliveryEvidencePath(projectRoot, phase)).replaceAll(path.sep, '/')]);
  const metadataAction = { action_id: 'phase-evidence' };
  const metadataMessage = `docs: record ${phase} delivery evidence\n\nPhase: ${phase}\nAction: phase-evidence\nAgent: runner\nModel: deterministic\nPlan: ${ledger.plan_path || `.planning/phases/${phase}/PLAN.md`}\nProvider: ${ledger.provider}\nPlan-SHA256: ${ledger.plan_sha256}\nRouting-Receipt-SHA256: ${ledger.routing_sha256}\nAction-Ledger-SHA256: ${sha256(canonical(evidence))}`;
  head = gitText(projectRoot, ['rev-parse', 'HEAD']);
  if (head !== parent) {
    const attempt = assertCommitAttempt(ledger.phase_commit_attempt, parent, metadataPaths);
    if (!commitMatchesAttempt(projectRoot, head, attempt)) fail(`Git HEAD diverged during phase evidence recovery: ${head}`);
    ledger.phase_commit_oid = head;
    ledger.phase_hook_receipts = receiptsForAttempt(projectRoot, ledger, metadataAction, attempt, head);
  } else {
    git(projectRoot, ['add', '-f', '--', ...metadataPaths]);
    const staged = unique(nul(git(projectRoot, ['diff', '--cached', '--name-only', '-z']).stdout));
    if (JSON.stringify(staged) !== JSON.stringify(metadataPaths)) fail(`phase evidence staging differs from the authoritative list: ${staged.join(', ')}`);
    const treeOid = gitText(projectRoot, ['write-tree']);
    const createdAttempt = newCommitAttempt(projectRoot, ledger, metadataAction, parent, metadataPaths);
    ledger.phase_commit_attempt = createdAttempt.attempt;
    ledger.updated_at = new Date().toISOString();
    atomicJson(actionLedgerPath(projectRoot, phase), ledger);
    const attempt = assertCommitAttempt(ledger.phase_commit_attempt, parent, metadataPaths);
    if (attempt.tree_oid !== treeOid) fail('phase evidence staged tree differs from its persisted attempt');
    const committedMetadata = commitOne(projectRoot, ledger, metadataAction, metadataMessage, attempt, createdAttempt.nonce);
    testHooks.afterCommit?.({ kind: 'phase-evidence', actionId: metadataAction.action_id, oid: committedMetadata.oid });
    ledger.phase_commit_oid = committedMetadata.oid;
    ledger.phase_hook_receipts = committedMetadata.receipts;
  }
  ledger.state = 'committed';
  ledger.updated_at = new Date().toISOString();
  atomicJson(actionLedgerPath(projectRoot, phase), ledger);
  return ledger;
}

export function branchHeadFromLedger(projectRoot, phase) {
  const ledger = readActionLedger(projectRoot, phase);
  if (ledger.state !== 'committed' || !OID.test(ledger.phase_commit_oid)) fail(`phase delivery is not committed: ${phase}`);
  const head = gitText(projectRoot, ['rev-parse', ledger.branch]);
  if (head !== ledger.phase_commit_oid) fail(`phase branch head does not match delivery evidence: ${ledger.branch}`);
  return { ledger, head };
}

function assertStoredReceipts(projectRoot, actionId, oid, receipts) {
  const treeOid = gitText(projectRoot, ['show', '-s', '--format=%T', oid]);
  for (const event of ['pre-commit', 'commit-msg']) {
    const receipt = receipts?.[event];
    if (!receipt || receipt.schema_version !== 1 || receipt.event !== event || receipt.action_id !== actionId
      || receipt.tree_oid !== treeOid || !SHA256.test(receipt.riff_hook_sha256) || !SHA256.test(receipt.receipt_sha256)) {
      fail(`stored Git hook receipt is invalid: ${actionId}:${event}`);
    }
  }
}

export function validateActionDelivery(projectRoot, phase) {
  const { ledger, head } = branchHeadFromLedger(projectRoot, phase);
  let parent = ledger.base_oid;
  for (const action of ledger.actions) {
    if (!commitMatchesAction(projectRoot, action.commit_oid, parent, action)) fail(`action commit is invalid before PR preparation: ${action.action_id}`);
    const attempt = assertCommitAttempt(action.commit_attempt, parent, action.changed_paths);
    if (!commitMatchesAttempt(projectRoot, action.commit_oid, attempt)) fail(`action transaction marker is invalid before PR preparation: ${action.action_id}`);
    assertStoredReceipts(projectRoot, action.action_id, action.commit_oid, action.hook_receipts);
    const diskReceipts = receiptsForAttempt(projectRoot, ledger, action, attempt, action.commit_oid);
    if (canonical(diskReceipts) !== canonical(action.hook_receipts)) fail(`action hook receipt files changed before PR preparation: ${action.action_id}`);
    parent = action.commit_oid;
  }
  const deliveryRelative = path.relative(projectRoot, deliveryEvidencePath(projectRoot, phase)).replaceAll(path.sep, '/');
  const phasePaths = ledger.phase_commit_attempt?.paths;
  if (!Array.isArray(phasePaths) || !phasePaths.includes(deliveryRelative)
    || phasePaths.some((entry) => !safeRelative(entry) || !(entry === 'ROADMAP.yaml' || entry.startsWith('.planning/riff-next/') || entry.startsWith(`.planning/phases/${phase}/`)))) {
    fail(`phase evidence transaction paths are invalid: ${phase}`);
  }
  const phaseAttempt = assertCommitAttempt(ledger.phase_commit_attempt, parent, phasePaths);
  if (!commitMatchesAttempt(projectRoot, head, phaseAttempt)) fail(`phase evidence commit is invalid before PR preparation: ${phase}`);
  assertStoredReceipts(projectRoot, 'phase-evidence', head, ledger.phase_hook_receipts);
  const phaseReceipts = receiptsForAttempt(projectRoot, ledger, { action_id: 'phase-evidence' }, phaseAttempt, head);
  if (canonical(phaseReceipts) !== canonical(ledger.phase_hook_receipts)) fail(`phase hook receipt files changed before PR preparation: ${phase}`);
  let committedEvidence;
  try { committedEvidence = JSON.parse(Buffer.from(git(projectRoot, ['show', `${head}:${deliveryRelative}`]).stdout).toString('utf8')); }
  catch { fail(`committed phase delivery evidence is missing or malformed: ${phase}`); }
  if (canonical(committedEvidence) !== canonical(deliveryEvidenceFromLedger(ledger))) fail(`committed phase delivery evidence does not match the action ledger: ${phase}`);
  return { ledger, head };
}

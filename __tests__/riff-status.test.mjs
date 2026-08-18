import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { afterEach, expect, test } from 'vitest';
import { projectStatus } from '../scripts/riff-status.mjs';
import { loadRoadmap, phaseVerificationMetadataSha256 } from '../scripts/lib/roadmap-workflow.mjs';

const fixtures = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test('status JSON and text expose the active verification request and approval command', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'riff-status-test-'));
  fixtures.push(root);
  fs.writeFileSync(path.join(root, 'ROADMAP.yaml'), `name: Status\nphases:\n  - id: 1\n    slug: visual-check\n    title: Visual Check\n    status: todo\n    priority: P1\n    mode: HITL\n    tags: [visual-verification]\n    depends_on: []\n    goal: Verify the visual result.\n    tasks:\n      - Inspect the rendered screen.\n`);
  fs.mkdirSync(path.join(root, '.planning/riff-wave'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  const phaseMetadataSha256 = phaseVerificationMetadataSha256(loadRoadmap(root).phases[0]);
  const request = {
    schema_version: 1, run: 'W-status-verification', provider: 'codex', phase_id: '1', phase_metadata_sha256: phaseMetadataSha256, reason: 'confirmation_required:1', checks: ['Inspect the rendered screen.'], nonce: '0123456789abcdef0123456789abcdef', requested_at: '2026-01-01T00:00:00Z',
  };
  const requestBytes = Buffer.from(`${JSON.stringify(request, null, 2)}\n`);
  fs.writeFileSync(path.join(root, '.planning/riff-wave/request.json'), requestBytes);
  const wave = {
    schema_version: 1, run: 'W-status-verification', state: 'awaiting_human', mode: 'loop', provider_override: null, selected_provider: 'codex', requested_phase_ids: [], max_phases: null, max_runs: null, waves: [], current: null, stop_reason: 'confirmation_required:1', started_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', phases: [{ id: '1', title: 'Visual Check', status: 'pending', attempts: [], verification: { status: 'pending', reason: 'confirmation_required:1', checks: request.checks, phase_metadata_sha256: request.phase_metadata_sha256, request_path: '.planning/riff-wave/request.json', request_sha256: createHash('sha256').update(requestBytes).digest('hex') } }],
  };
  fs.writeFileSync(path.join(root, '.planning/riff-wave/W-status-verification.json'), `${JSON.stringify(wave)}\n`);
  fs.writeFileSync(path.join(root, '.planning/riff-wave/active.json'), '{"run":"W-status-verification"}\n');
  const status = projectStatus(root);
  expect(status.active_verification).toMatchObject({ phase_id: '1', status: 'pending', reason: 'confirmation_required:1' });
  expect(status.active_verification.approval_command).toBe('riff wave --approve --run W-status-verification --phase 1 --evidence "Checked: <scope>; Observed: <result>; Expected: <expected result>"');
  const text = execFileSync(process.execPath, [path.resolve(import.meta.dirname, '../scripts/riff-status.mjs'), '--project-root', root], { encoding: 'utf8' });
  expect(text).toContain('Approve: riff wave --approve --run W-status-verification --phase 1 --evidence "Checked: <scope>; Observed: <result>; Expected: <expected result>"');
  const json = JSON.parse(execFileSync(process.execPath, [path.resolve(import.meta.dirname, '../scripts/riff-status.mjs'), '--json', '--project-root', root], { encoding: 'utf8' }));
  expect(json.active_verification.phase_id).toBe('1');
  const approval = { schema_version: 1, run: wave.run, provider: 'codex', phase_id: '1', phase_metadata_sha256: phaseMetadataSha256, request_sha256: wave.phases[0].verification.request_sha256, evidence_note: 'Checked: browser confirmation screen; Observed: success result showed the order identifier; Expected: confirmation shows the expected order identifier', evidence_sha256: '', approved_at: '2026-01-01T00:01:00Z' };
  approval.evidence_sha256 = createHash('sha256').update(approval.evidence_note).digest('hex');
  const approvalBytes = Buffer.from(`${JSON.stringify(approval, null, 2)}\n`); const approvalPath = path.join(root, '.planning/riff-wave/approval.json'); fs.writeFileSync(approvalPath, approvalBytes);
  wave.phases[0].verification.status = 'approved'; wave.phases[0].verification.receipt_path = '.planning/riff-wave/approval.json'; wave.phases[0].verification.receipt_sha256 = createHash('sha256').update(approvalBytes).digest('hex'); fs.writeFileSync(path.join(root, '.planning/riff-wave/W-status-verification.json'), `${JSON.stringify(wave)}\n`);
  expect(projectStatus(root).active_verification).toMatchObject({ status: 'approved', approval_command: null });
  fs.rmSync(approvalPath); fs.symlinkSync('/dev/null', approvalPath);
  expect(projectStatus(root).active_verification).toMatchObject({ status: 'invalid', approval_command: null });
  fs.rmSync(approvalPath); fs.writeFileSync(approvalPath, approvalBytes);
  const roadmapPath = path.join(root, 'ROADMAP.yaml'); fs.writeFileSync(roadmapPath, fs.readFileSync(roadmapPath, 'utf8').replace('Visual Check', 'Changed Visual Check'));
  expect(projectStatus(root).active_verification).toMatchObject({ status: 'invalid', reason: 'request metadata is stale', approval_command: null });
  fs.unlinkSync(path.join(root, '.planning/riff-wave/request.json'));
  expect(projectStatus(root).active_verification).toMatchObject({ status: 'invalid', phase_id: '1', approval_command: null });
});

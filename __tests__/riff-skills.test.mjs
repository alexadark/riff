import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { runArtifactChecks } from '../scripts/artifact-check.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function skill(name) {
  return read(`skills/${name}/SKILL.md`);
}

function skillConfig(name) {
  return read(`skills/${name}/agents/openai.yaml`);
}

describe('active conversational skill split', () => {
  test('incident logging and incident review have exact, exclusive protocol ownership', () => {
    const logging = skill('incident');
    const review = skill('incident-review');
    const index = read('protocols/INCIDENT.md');

    expect(logging).toContain('.riff/protocols/INCIDENT-LOG.md');
    expect(logging).not.toContain('INCIDENT-REVIEW.md');
    const loggingDescription = logging.match(/^description:.*$/m)?.[0] || '';
    const reviewDescription = review.match(/^description:.*$/m)?.[0] || '';
    expect(loggingDescription).not.toMatch(/"incident review"|"quarterly incident review"/i);
    expect(review).toContain('.riff/protocols/INCIDENT-REVIEW.md');
    expect(review).not.toContain('INCIDENT-LOG.md');
    expect(reviewDescription).not.toMatch(/"log incident"|"log this as an incident"|"production bug"/i);
    expect(index).toContain('.riff/protocols/INCIDENT-LOG.md');
    expect(index).toContain('.riff/protocols/INCIDENT-REVIEW.md');
    expect(read('protocols/INCIDENT-LOG.md')).toMatch(/append only|append-only/i);
    expect(read('protocols/INCIDENT-REVIEW.md')).toMatch(/never edits `INCIDENTS\.md`|never edit `INCIDENTS\.md`/i);
  });
});

describe('active skill runtime contracts', () => {
  test('every owned active skill has an explicit runtime prompt and disabled implicit invocation', () => {
    for (const name of ['dashboard', 'deep-audit', 'finish', 'improve', 'incident', 'incident-review', 'map', 'next', 'phase', 'promote', 'resync', 'start', 'status', 'wave']) {
      const config = skillConfig(name);
      expect(config).toContain(`$riff:${name}`);
      expect(config).toMatch(/allow_implicit_invocation:\s*false/);
    }
  });

  test('resync is explicitly invoked and delegates only to the project-local CLI', () => {
    const resync = skill('resync');
    const config = skillConfig('resync');
    const explicitlyInvokesResync = (prompt) => /\$(?:riff:)?resync\b/.test(prompt);

    expect(explicitlyInvokesResync('$resync')).toBe(true);
    expect(explicitlyInvokesResync('Please run $riff:resync now.')).toBe(true);
    expect(explicitlyInvokesResync('resync this RIFF project')).toBe(false);
    expect(explicitlyInvokesResync('run riff resync')).toBe(false);
    expect(resync).toContain('Run only when explicitly invoked as `$resync` in a project installation or `$riff:resync` in a namespaced plugin installation.');
    expect(resync).toContain('`git rev-parse --show-toplevel`');
    expect(resync).toContain('`<git-root>/.riff/riff resync`');
    expect(resync).toContain('Do not invoke `riff-resync.sh` directly');
    expect(config).toContain('$riff:resync');
    expect(config).toMatch(/allow_implicit_invocation:\s*false/);
  });

  test('wave explicitly invokes the project-local autonomous engine', () => {
    const text = skill('wave');
    const config = skillConfig('wave');
    expect(text).toContain('`riff wave --autonomous --loop`');
    expect(text).toContain('`riff wave --resume`');
    expect(text).toMatch(/doesn't ask for confirmation\s+between ordinary phases/);
    expect(text).toMatch(/Security hooks run once\s+after the product phases/);
    expect(text).toContain('never commits, merges, deploys, or promotes implicitly');
    expect(config).toContain('$riff:wave');
  });

  test('finish is explicit, shows a no-action plan, and waits for confirmation', () => {
    const text = skill('finish');
    const config = skillConfig('finish');
    const explicitlyInvokesFinish = (prompt) => /\$(?:riff:)?finish\b/.test(prompt);
    expect(explicitlyInvokesFinish('$finish')).toBe(true);
    expect(explicitlyInvokesFinish('finish this RIFF project')).toBe(false);
    expect(text).toContain('`<git-root>/.riff/riff finish --check --project-root <git-root>`');
    expect(text).toContain('Ask the user to confirm that exact plan');
    expect(text).toContain('`riff finish --confirm <token>`');
    expect(text).toMatch(/never deploys or promotes/i);
    expect(config).toContain('$riff:finish');
    expect(config).toMatch(/allow_implicit_invocation:\s*false/);
  });

  test('single-project entry skills expose native Codex workflows', () => {
    expect(skill('start')).toContain('`ROADMAP.yaml`');
    expect(skill('start')).toContain('`riff wave --autonomous --loop`');
    expect(skill('map')).toContain('`.planning/architecture.md`');
    expect(skill('map')).toContain('Do not edit application code');
    expect(skill('phase')).toContain('`<git-root>/.riff/riff phase add');
    expect(skill('status')).toContain('`<git-root>/.riff/riff status');
    expect(skill('dashboard')).toContain('`<git-root>/.riff/riff dashboard`');
  });

  test('deep audit and promotion protocols use the shared reviewer adapter without provider names', () => {
    const deepAudit = read('protocols/DEEP-AUDIT.md');
    const promote = read('protocols/PROMOTE.md');
    const forbidden = /\b(?:codex|claude|opus|gpt(?:-[0-9.]+)?|rescue)\b/i;

    for (const text of [deepAudit, promote]) expect(text).not.toMatch(forbidden);
    expect(deepAudit).toContain('active runtime adapter');
    expect(deepAudit).toContain('fresh, independent context');
    expect(deepAudit).toContain('`mode` to `milestone`');
    expect(promote).toContain('active runtime adapter');
    expect(promote).toContain('`mode=architecture`');
    expect(promote).toContain('`mode=roadmap`');
    expect(promote).toContain('fresh independent context');
  });

  test('sensitive shared-review stages fail closed and preserve drafts', () => {
    const deepAudit = read('protocols/DEEP-AUDIT.md');
    const incidentReview = read('protocols/INCIDENT-REVIEW.md');
    const promote = read('protocols/PROMOTE.md');

    expect(deepAudit).toMatch(/adapter or shared reviewer.*stop/i);
    expect(deepAudit).toMatch(/Preserve any audit draft.*report the blocker/i);
    expect(deepAudit).not.toContain('skip the audit, and leave the pipeline unblocked');
    expect(incidentReview).toContain('The independent review is mandatory. Do not offer an opt-out.');
    expect(incidentReview).toMatch(/preserve the draft.*report the blocker.*stop/i);
    expect(incidentReview).not.toContain('continue without blocking');
    expect(promote).toContain('Do not continue to Step 6 until the architecture review returns `PROCEED`.');
    expect(promote).toContain('Do not continue to Step 8 until the roadmap review returns `PROCEED`.');
    expect(promote).toMatch(/Preserve architecture draft artifacts.*leave `scope: scratch`/i);
    expect(promote).toMatch(/Preserve roadmap draft artifacts.*leave `scope: scratch`/i);
  });

  test('promotion waits to flip scope and describes only the implemented next slice', () => {
    const promote = read('protocols/PROMOTE.md');
    const architectureGate = promote.indexOf('Do not continue to Step 6 until the architecture review returns `PROCEED`.');
    const roadmapGate = promote.indexOf('Do not continue to Step 8 until the roadmap review returns `PROCEED`.');
    const scopeFlip = promote.indexOf('### Step 8: Flip the scope flag');

    expect(scopeFlip).toBeGreaterThan(architectureGate);
    expect(scopeFlip).toBeGreaterThan(roadmapGate);
    expect(promote).toContain('currently implemented native next vertical slice');
    expect(promote).not.toMatch(/planner adversarial|simplifier|security-reviewer/i);
  });
});

describe('promotion and improver safety contracts', () => {
  test('promotion confirmation appears before the first scope write', () => {
    const protocol = read('protocols/PROMOTE.md');
    const confirmation = protocol.indexOf('AskUserQuestion: `proceed` / `cancel`');
    const scopeWrite = protocol.indexOf('Update `.planning/config.json`');

    expect(confirmation).toBeGreaterThan(-1);
    expect(scopeWrite).toBeGreaterThan(confirmation);
    expect(protocol).toContain('before any file write');
  });

  test('improver dispatch uses the skill and the legacy agent is absent', () => {
    const postPhase = read('protocols/POST-PHASE.md');

    expect(existsSync(path.join(repositoryRoot, 'agents/improver.md'))).toBe(false);
    expect(existsSync(path.join(repositoryRoot, 'skills/improve/SKILL.md'))).toBe(true);
    expect(postPhase).toContain('$riff:improve');
    expect(postPhase).toContain('after the phase is complete');
    expect(postPhase).not.toContain('subagent_type: improver');
    expect(postPhase).not.toContain('model: "haiku"');
    expect(postPhase).not.toContain('run_in_background');
  });
});

describe('owned skill references', () => {
  test('all protocol paths referenced by owned skills exist', () => {
    for (const name of ['dashboard', 'deep-audit', 'finish', 'improve', 'incident', 'incident-review', 'map', 'next', 'phase', 'promote', 'resync', 'start', 'status', 'wave']) {
      const text = skill(name);
      const references = [...text.matchAll(/`\.riff\/(protocols\/[^`]+)`/g)].map((match) => match[1]);
      for (const reference of references) expect(existsSync(path.join(repositoryRoot, reference))).toBe(true);
      expect(existsSync(path.join(repositoryRoot, `skills/${name}/agents/openai.yaml`))).toBe(true);
    }
    expect(skill('next')).toContain('scripts/riff-next.mjs');
  });

  test('rejects a structurally valid undeclared top-level skill directory', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-extra-skill-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      cpSync(path.join(temporaryRoot, 'skills', 'next'), path.join(temporaryRoot, 'skills', 'seventh'), { recursive: true });
      const findings = runArtifactChecks({ projectRoot: temporaryRoot });
      expect(findings).toContainEqual(expect.objectContaining({
        file: 'skills/seventh',
        message: 'undeclared top-level skill directory: seventh',
      }));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 15_000);

  test('rejects a missing active skill directory', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-missing-skill-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      rmSync(path.join(temporaryRoot, 'skills', 'next'), { recursive: true, force: true });
      const findings = runArtifactChecks({ projectRoot: temporaryRoot });
      expect(findings).toContainEqual(expect.objectContaining({
        file: 'skills/next',
        message: 'missing active skill directory: next',
      }));
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 15_000);
});

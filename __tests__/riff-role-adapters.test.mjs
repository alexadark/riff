import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { describe, expect, test } from 'vitest';
import { runArtifactChecks } from '../scripts/artifact-check.mjs';
import { ROUTE_PORTFOLIO, loadCodexRoutes, parseRouteText } from '../scripts/lib/runtime-routes.mjs';
import { validateSecurityReview } from '../scripts/lib/artifact-contracts.mjs';
import { dispatchReadOnlyRole } from '../scripts/lib/read-only-role-dispatch.mjs';
import { dispatchModel } from '../scripts/lib/model-dispatch.mjs';
import { CLAUDE_ROUTE_MATRIX, claudeRuntimeEnvironment, claudeSettings, loadClaudeRoutes, resolveRuntimeProfile } from '../scripts/lib/runtime-provider.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalRoles = ['planner', 'worker', 'reviewer', 'debugger', 'security-reviewer', 'red-teamer', 'load-tester'];
const aliases = ['executor', 'simplifier', 'debugger-max', 'adversarial-reviewer', 'plan-adversarial-reviewer', 'architecture-adversarial-reviewer', 'roadmap-adversarial-reviewer', 'incident-adversarial-reviewer', 'deep-auditor'];

function read(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
}

function frontmatter(relativePath) {
  const match = read(relativePath).match(/^---\s*\n([\s\S]*?)\n---/);
  return yaml.load(match?.[1] || '') || {};
}

describe('RIFF role adapter migration', () => {
  test('keeps the literal adaptive route portfolio intact', () => {
    const expected = [
      ['controller-routine.toml', 'controller', 'routine', 'gpt-5.6-sol', 'medium', 'read-only', 'protocols/RIFF-NEXT.md'],
      ['controller-architecture.toml', 'controller', 'architecture', 'gpt-5.6-sol', 'xhigh', 'read-only', 'protocols/RIFF-NEXT.md'],
      ['planner-routine.toml', 'planner', 'routine', 'gpt-5.6-sol', 'medium', 'read-only', 'agents/roles/planner.md'],
      ['planner-architecture.toml', 'planner', 'architecture', 'gpt-5.6-sol', 'xhigh', 'read-only', 'agents/roles/planner.md'],
      ['worker-inventory.toml', 'worker', 'inventory', 'gpt-5.6-luna', 'low', 'workspace-write', 'agents/roles/worker.md'],
      ['worker-repeatable.toml', 'worker', 'repeatable', 'gpt-5.6-luna', 'xhigh', 'workspace-write', 'agents/roles/worker.md'],
      ['worker-bounded.toml', 'worker', 'bounded', 'gpt-5.6-terra', 'high', 'workspace-write', 'agents/roles/worker.md'],
      ['reviewer-routine.toml', 'reviewer', 'routine', 'gpt-5.6-sol', 'medium', 'read-only', 'agents/roles/reviewer.md'],
      ['reviewer-critical.toml', 'reviewer', 'critical', 'gpt-5.6-sol', 'xhigh', 'read-only', 'agents/roles/reviewer.md'],
      ['reviewer-escalation.toml', 'reviewer', 'escalation', 'gpt-5.6-sol', 'max', 'read-only', 'agents/roles/reviewer.md'],
      ['debugger.toml', 'debugger', 'fixed', 'gpt-5.6-sol', 'xhigh', 'read-only', 'agents/roles/debugger.md'],
      ['security-reviewer.toml', 'security-reviewer', 'fixed', 'gpt-5.6-sol', 'xhigh', 'read-only', 'agents/roles/security-reviewer.md'],
      ['red-teamer.toml', 'red-teamer', 'fixed', 'gpt-5.6-sol', 'xhigh', 'read-only', 'agents/roles/red-teamer.md'],
      ['load-tester.toml', 'load-tester', 'fixed', 'gpt-5.6-luna', 'xhigh', 'read-only', 'agents/roles/load-tester.md'],
    ];
    for (const [file, semanticRole, routeClass, model, effort, sandbox, roleSpec] of expected) {
      const text = read(`agents/codex/${file}`);
      expect(text).toContain(`semantic_role = "${semanticRole}"`);
      expect(text).toContain(`route_class = "${routeClass}"`);
      expect(text).toContain(`model = "${model}"`);
      expect(text).toContain(`model_reasoning_effort = "${effort}"`);
      expect(text).toContain(`sandbox_mode = "${sandbox}"`);
      expect(text).toContain(`role_spec_path = "${roleSpec}"`);
      if (model === 'gpt-5.6-luna') expect(text).toContain('service_tier = "priority"');
      else expect(text).not.toContain('service_tier =');
    }
  });

  test('fails closed on malformed route grammar', () => {
    const valid = read('agents/codex/controller-routine.toml');
    const cases = [
      valid.replace('model = "gpt-5.6-sol"', 'model = "gpt-5.6-sol"\nmodel = "gpt-5.6-sol"'),
      valid.replace('role_spec_path =', 'role\\u005fspec_path ='),
      valid.replace('sandbox_mode = "read-only"', 'sandbox_mode = "read-only"\nsandbox = "workspace-write"'),
      valid.replace('role_spec_path =', 'unknown = "x"\nrole_spec_path ='),
      valid.replace('[features]', '[other]\nvalue = false\n\n[features]'),
      `${valid}\ntrailing`,
      valid.replace('role_spec_path = "protocols/RIFF-NEXT.md"', 'role_spec_path = "protocols/RIFF-NEXT.md"\nrole_spec_path = "protocols/RIFF-NEXT.md"'),
      valid.replace('developer_instructions = """', 'developer_instructions = """broken').replace('\n"""\n\n[features]', '\n[features]'),
    ];
    for (const malformed of cases) expect(parseRouteText(malformed).errors.length).toBeGreaterThan(0);
  });
  test('has exactly seven canonical role specifications', () => {
    const actual = canonicalRoles
      .map((role) => `${role}.md`)
      .filter((name) => read(`agents/roles/${name}`));
    expect(actual).toEqual(canonicalRoles.map((role) => `${role}.md`));
    expect(runArtifactChecks({ projectRoot: repositoryRoot })).toEqual([]);
  }, 60_000);

  test('canonical specifications contain the shared semantic contracts', () => {
    const required = {
      planner: ['confidence', 'assumptions', 'dependencies', 'waves', 'acceptance criteria', 'provider_mode', 'improver', 'owned paths', 'stdout_includes', 'test traceability', 'input class', 'edge case', 'preservation constraint', 'explicit test case', 'alphanumeric', 'digits', 'observed and stable', 'test-reporter formatting', '`exit_code` only'],
      worker: ['implement', 'fix', 'simplify', 'allowed paths', 'TDD', 'documentation', 'scope: scratch', 'SUMMARY'],
      reviewer: ['code', 'plan', 'architecture', 'roadmap', 'incident', 'milestone', 'fresh context', 'read-only', 'PLAN SHA-256', 'worker delta SHA-256', 'path:line'],
      debugger: ['normal', 'high', 'max', 'falsifiable', 'evidence', 'DEBUG', 'bounded fix assignment'],
      'security-reviewer': ['scratch', 'diff', 'full', 'OWASP', 'auth', 'IDOR', 'input', 'error', 'secrets', 'transactions', 'tenant isolation', 'SECURITY'],
      'red-teamer': ['auth', 'injection', 'idor', 'ratelimit', 'config', 'non-production', 'redirect', 'destructive', 'bounded', 'proof', 'repository-read-only', 'report-only', 'never write repository files', 'stdout', 'artifact response', 'active network access', 'disposable runtime scratch', 'orchestrator'],
      'load-tester': ['static', 'active', 'approved', 'ramp', 'breaking point', 'invent measurements', 'SCALE', 'repository-read-only', 'report-only', 'never write repository files', 'stdout', 'artifact response', 'active network access', 'disposable runtime scratch', 'orchestrator'],
    };
    for (const [role, terms] of Object.entries(required)) {
      const text = read(`agents/roles/${role}.md`).toLowerCase();
      for (const term of terms) expect(text).toContain(term.toLowerCase());
    }
    const forbidden = /\b(?:gpt-\d[\w.-]*|claude|codex|sonnet|opus|haiku|terra|luna|fable|model|effort|tools?|permission|delegation)\b/i;
    for (const role of canonicalRoles) expect(read(`agents/roles/${role}.md`).replaceAll('provider_mode', '')).not.toMatch(forbidden);
  });

  test('auto-debug uses the shared debugger and active runtime adapters', () => {
    const postPhase = read('protocols/POST-PHASE.md');
    const autoDebug = postPhase.split('## Auto-debug pattern')[1]?.split('## Codex usage tracking')[0] || '';
    expect(autoDebug).toContain('agents/roles/debugger.md');
    expect(autoDebug).toContain('active runtime adapter');
    expect(autoDebug).toContain('worker role');
    expect(autoDebug).toContain('bounded fix assignment');
    for (const intensity of ['normal', 'high', 'max']) expect(autoDebug).toContain(`\`${intensity}\``);
    for (const forbidden of [
      /\bdebugger-max\b/i,
      /\bsubagent_type:\s*debugger\b/i,
      /\bfable\b/i,
      /\bopus\b/i,
      /\bsonnet\b/i,
      /\bmodel:/i,
      /\b(?:nested|delegate|delegation)\b/i,
      /\btiers?\b/i,
      /\bstep\b/i,
    ]) expect(autoDebug).not.toMatch(forbidden);
  });

  test('primary and compatibility Claude adapters are thin and cannot nest roles', () => {
    for (const role of canonicalRoles) {
      const metadata = frontmatter(`agents/${role}.md`);
      const body = read(`agents/${role}.md`).split(/^---\s*$/m).slice(2).join('---').trim();
      expect(metadata.model).toBe('inherit');
      expect(metadata.permissionMode).toBeTruthy();
      expect(String(metadata.tools)).not.toMatch(/\bAgent\b/i);
      expect(body).toContain(`.riff/agents/roles/${role}.md`);
      expect(body).toContain(`agents/roles/${role}.md`);
      expect(body.split('\n').filter(Boolean).length).toBeLessThanOrEqual(3);
    }
    for (const role of ['red-teamer', 'load-tester']) {
      const metadata = frontmatter(`agents/${role}.md`);
      expect(metadata.permissionMode).toBe('default');
      expect(String(metadata.tools)).toContain('Read');
      expect(String(metadata.tools)).toContain('Glob');
      expect(String(metadata.tools)).toContain('Grep');
      expect(String(metadata.tools)).toContain('Bash');
      expect(String(metadata.tools)).not.toMatch(/\b(?:Write|Edit)\b/i);
    }
    for (const alias of aliases) {
      const metadata = frontmatter(`agents/${alias}.md`);
      const body = read(`agents/${alias}.md`).split(/^---\s*$/m).slice(2).join('---').trim();
      expect(metadata.model).toBe('inherit');
      expect(metadata.permissionMode).toBeTruthy();
      expect(String(metadata.tools)).not.toMatch(/\bAgent\b/i);
      expect(body).toContain('.riff/agents/roles/');
      expect(body).toContain('agents/roles/');
      expect(body.split('\n').filter(Boolean).length).toBeLessThanOrEqual(3);
    }
  });

  test('mappings preserve primary routes and compatibility aliases', () => {
    const openai = yaml.load(read('agents/openai.yaml'));
    const claude = yaml.load(read('agents/claude.yaml'));
    expect(Object.keys(openai.roles).sort()).toEqual(['controller', ...canonicalRoles].sort());
    expect(Object.keys(claude.roles).sort()).toEqual(canonicalRoles.sort());
    expect(Object.keys(claude.aliases).sort()).toEqual([...aliases].sort());
    expect(openai.roles.planner).toEqual({ semantic_spec: 'agents/roles/planner.md', variants: { routine: 'agents/codex/planner-routine.toml', architecture: 'agents/codex/planner-architecture.toml' } });
    expect(claude.aliases.executor).toMatchObject({ role: 'worker', assignment: 'implement' });
    expect(claude.aliases['debugger-max']).toMatchObject({ role: 'debugger', intensity: 'max' });
    expect(claude.aliases['deep-auditor']).toMatchObject({ role: 'reviewer', mode: 'milestone' });
  });

  test('Claude native route matrix is explicit and provider-neutral specs stay untouched', () => {
    const claude = yaml.load(read('agents/claude.yaml'));
    expect(Object.keys(claude.roles).sort()).toEqual(canonicalRoles.sort());
    expect(claude.native_roles.controller.semantic_spec).toBe('protocols/RIFF-NEXT.md');
    const routes = loadClaudeRoutes(repositoryRoot);
    for (const [role, variants] of Object.entries(CLAUDE_ROUTE_MATRIX)) {
      for (const [routeClass, expected] of Object.entries(variants)) {
        expect(routes[role][routeClass]).toMatchObject({
          provider: 'claude', semanticRole: role, routeClass,
          model: expected.model, effort: expected.effort, sandbox: expected.sandbox,
        });
        expect(routes[role][routeClass].tools).toEqual(expected.tools);
        expect(routes[role][routeClass].developerInstructions).not.toContain(repositoryRoot);
      }
    }
  });

  test('Codex and Claude select the fixed security-reviewer route', () => {
    expect(loadCodexRoutes(repositoryRoot)['security-reviewer'].fixed).toMatchObject({ provider: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh', sandbox: 'read-only' });
    expect(loadClaudeRoutes(repositoryRoot)['security-reviewer'].fixed).toMatchObject({ provider: 'claude', model: 'opus', effort: 'xhigh', sandbox: 'read-only' });
  });

  test('strict semantic security contract enforces paths and verdict consistency', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'riff-security-contract-'));
    try {
      mkdirSync(path.join(root, 'src')); writeFileSync(path.join(root, 'src/a.mjs'), 'export const a = 1;\n');
      const valid = '---\nphase: final-security\ngenerated_at: 2026-01-01T00:00:00Z\nverdict: PASS-WITH-WARNINGS\n---\n## Verdict\nPASS-WITH-WARNINGS\n## Findings\n### [MEDIUM] Missing validation\nLocation: src/a.mjs:1\nOWASP category: A03 Injection\nDescription: Input validation is incomplete.\nProof: The value flows without validation.\nFix: Validate the value before use.\n## Resolved Findings\nNone.\n## Notes\nReview completed.';
      expect(validateSecurityReview(valid, { phase: 'final-security', projectRoot: root }).valid).toBe(true);
      expect(validateSecurityReview(valid.replace('PASS-WITH-WARNINGS', 'PASS'), { phase: 'final-security', projectRoot: root }).valid).toBe(false);
      expect(validateSecurityReview(valid.replace('src/a.mjs:1', '/tmp/a.mjs:1'), { phase: 'final-security', projectRoot: root }).valid).toBe(false);
      expect(validateSecurityReview(valid.replace('Fix: Validate', 'Fix: TODO\n\nFix: Validate'), { phase: 'final-security', projectRoot: root }).valid).toBe(false);
      expect(validateSecurityReview(valid.replace('## Resolved Findings\nNone.', '## Resolved Findings\n### [HIGH] Wrong section\nNone.'), { phase: 'final-security', projectRoot: root }).valid).toBe(false);
      expect(validateSecurityReview(valid.replace('## Notes\nReview completed.', '## Notes\n### [HIGH] Wrong section\nReview completed.'), { phase: 'final-security', projectRoot: root }).valid).toBe(false);
      expect(validateSecurityReview(valid.replace('## Resolved Findings\nNone.', '## Resolved Findings\n### [high] Wrong section\nNone.'), { phase: 'final-security', projectRoot: root }).valid).toBe(false);
      expect(validateSecurityReview(valid.replace('## Notes\nReview completed.', '## Notes\n### [high] Wrong section\nReview completed.'), { phase: 'final-security', projectRoot: root }).valid).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('fresh read-only role dispatch rejects a fake adapter mutation of the consumer', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'riff-readonly-consumer-'));
    try {
      writeFileSync(path.join(root, 'README.md'), '# test\n');
      execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root }); execFileSync('git', ['add', 'README.md'], { cwd: root }); execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
      expect(() => dispatchReadOnlyRole({ consumerRoot: root, frameworkRoot: repositoryRoot, provider: 'codex', semanticRole: 'security-reviewer', routeClass: 'fixed', codexBin: process.execPath, internalTestAllowNonDarwinSandbox: true, promptBuilder: () => 'portable prompt only', modelDispatch: () => { writeFileSync(path.join(root, 'tampered.txt'), 'no'); return { stdout: 'safe', argv: [] }; } })).toThrow(/mutated consumer workspace/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  test('read-only mutation takes precedence when the adapter also throws', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'riff-readonly-throw-'));
    try {
      writeFileSync(path.join(root, 'README.md'), '# test\n'); execFileSync('git', ['init', '-q'], { cwd: root }); execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root }); execFileSync('git', ['config', 'user.name', 'Test'], { cwd: root }); execFileSync('git', ['add', 'README.md'], { cwd: root }); execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
      try { dispatchReadOnlyRole({ consumerRoot: root, frameworkRoot: repositoryRoot, provider: 'codex', semanticRole: 'security-reviewer', routeClass: 'fixed', codexBin: process.execPath, internalTestAllowNonDarwinSandbox: true, promptBuilder: () => 'portable prompt only', modelDispatch: () => { writeFileSync(path.join(root, 'tampered.txt'), 'no'); throw new Error('provider failed'); } }); throw new Error('expected dispatch failure'); }
      catch (error) { expect(error.message).toMatch(/mutated consumer workspace/); expect(error.cause?.message).toBe('provider failed'); }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30_000);

  test('extracted Codex and Claude dispatches retain closed argv and environment', () => {
    const calls = [];
    const spawn = (binary, argv, options) => { calls.push({ binary, argv, options }); return { status: 0, stdout: 'ok', stderr: '' }; };
    const base = { role: 'security-reviewer', sandbox: 'read-only', model: 'test', effort: 'xhigh', developerInstructions: 'closed contract', provider: 'codex' };
    dispatchModel({ root: '/private/riff-dispatch', readPaths: ['/private/evidence'], protectedPaths: ['/private/secret'], binary: '/bin/true', route: base, prompt: 'review', shellPath: '/bin', spawn });
    dispatchModel({ root: '/private/riff-dispatch', readPaths: ['/private/evidence'], protectedPaths: ['/private/secret'], binary: '/bin/true', route: { ...base, provider: 'claude', tools: ['Read', 'Glob', 'Grep'] }, prompt: 'review', shellPath: '/bin', spawn });
    expect(calls[0].argv).toEqual(expect.arrayContaining(['--strict-config', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--disable', 'multi_agent', '--ask-for-approval', 'never']));
    expect(calls[0].options).toMatchObject({ shell: false, timeout: 900000, killSignal: 'SIGKILL' });
    expect(calls[0].options.env.GIT_TERMINAL_PROMPT).toBe('0');
    expect(calls[1].argv).toEqual(expect.arrayContaining(['--permission-mode', 'dontAsk', '--strict-mcp-config', '--safe-mode', '--disable-slash-commands', '--no-session-persistence']));
    expect(calls[1].options).toMatchObject({ shell: false, timeout: 900000, killSignal: 'SIGKILL' });
    expect(calls[1].options.env.GIT_TERMINAL_PROMPT).toBe('0');
  });

  test('runtime provider profile resolution uses exact precedence and fails closed', () => {
    const frameworkRoot = mkdtempSync(path.join(tmpdir(), 'riff-provider-profile-'));
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'riff-provider-project-'));
    try {
      mkdirSync(path.join(frameworkRoot, 'templates'), { recursive: true });
      writeFileSync(path.join(frameworkRoot, 'profile.yaml'), 'runtime:\n  provider: claude\n');
      writeFileSync(path.join(frameworkRoot, 'templates/profile.default.yaml'), 'runtime:\n  provider: codex\n');
      expect(resolveRuntimeProfile({ projectRoot, frameworkRoot })).toMatchObject({ provider: 'claude', profilePath: 'framework:profile.yaml' });
      mkdirSync(path.join(projectRoot, '.planning'), { recursive: true });
      writeFileSync(path.join(projectRoot, '.planning/profile.yaml'), 'runtime:\n  provider: codex\n');
      expect(resolveRuntimeProfile({ projectRoot, frameworkRoot })).toMatchObject({ provider: 'codex', profilePath: 'project:.planning/profile.yaml' });
      expect(resolveRuntimeProfile({ projectRoot, frameworkRoot, provider: 'claude' })).toMatchObject({ provider: 'claude', explicitOverride: true });
      writeFileSync(path.join(projectRoot, '.planning/profile.yaml'), 'runtime:\n  provider: terra\n');
      expect(() => resolveRuntimeProfile({ projectRoot, frameworkRoot })).toThrow(/invalid runtime provider/);
      writeFileSync(path.join(projectRoot, '.planning/profile.yaml'), 'runtime:\n  provider: codex\n');
      rmSync(path.join(frameworkRoot, 'profile.yaml'));
      rmSync(path.join(projectRoot, '.planning/profile.yaml'));
      expect(resolveRuntimeProfile({ projectRoot, frameworkRoot })).toMatchObject({ provider: 'codex', profilePath: 'framework:templates/profile.default.yaml' });
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(frameworkRoot, { recursive: true, force: true });
    }
  });

  test('Claude settings close the tool surface and cannot re-allow a denied parent', () => {
    const settings = claudeSettings({
      root: '/private/runtime/dispatch',
      readPaths: ['/private/runtime/evidence', '/private/runtime/bundle'],
      writeRoot: '/private/runtime/workspace',
      deniedPaths: ['/Users/operator', '/private/runtime'],
    });
    expect(settings.mcpServers).toEqual({});
    expect(settings.permissions.defaultMode).toBe('dontAsk');
    expect(settings.permissions.deny).toEqual(expect.arrayContaining(['Read(//Users/operator/**)', 'Read(//private/runtime/**)']));
    expect(settings.permissions.allow).not.toContain('Read(//private/runtime/evidence/**)');
    expect(settings.permissions.allow.join(' ')).not.toMatch(/\b(?:Bash|Agent|WebFetch|WebSearch)\b/);
    expect(settings.permissions.allow.join(' ')).not.toContain('Write(//private/runtime/workspace/**)');
    const worker = claudeSettings({
      root: '/private/runtime/dispatch',
      readPaths: ['/private/runtime/bundle'],
      writeRoot: '/private/runtime/workspace',
      deniedPaths: ['/Users/operator', '/tmp'],
    });
    expect(worker.permissions.allow).toEqual(expect.arrayContaining([
      'Read(//private/runtime/workspace/**)',
      'Write(//private/runtime/workspace/**)',
      'Edit(//private/runtime/workspace/**)',
      'Read(//private/runtime/bundle/**)',
    ]));
  });

  test('Claude runtime preserves explicit provider authentication without inheriting arbitrary secrets', () => {
    const previousAnthropic = process.env.ANTHROPIC_API_KEY;
    const previousUnrelated = process.env.RIFF_UNRELATED_SECRET;
    process.env.ANTHROPIC_API_KEY = 'provider-auth-sentinel';
    process.env.RIFF_UNRELATED_SECRET = 'must-not-pass';
    try {
      const environment = claudeRuntimeEnvironment({ PATH: '/usr/bin:/bin', HOME: '/private/runtime/home' });
      expect(environment.ANTHROPIC_API_KEY).toBe('provider-auth-sentinel');
      expect(environment.RIFF_UNRELATED_SECRET).toBeUndefined();
      expect(environment.HOME).toBe(process.env.HOME);
      for (const name of ['USER', 'LOGNAME', 'SHELL', 'TMPDIR']) {
        if (process.env[name]) expect(environment[name]).toBe(process.env[name]);
      }
    } finally {
      if (previousAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = previousAnthropic;
      if (previousUnrelated === undefined) delete process.env.RIFF_UNRELATED_SECRET;
      else process.env.RIFF_UNRELATED_SECRET = previousUnrelated;
    }
  });

  test('Codex source routes use portable canonical specification paths', () => {
    for (const route of ROUTE_PORTFOLIO) {
      const text = read(`agents/codex/${route.file}`);
      expect(text).not.toContain(repositoryRoot);
      expect(text).toContain(`semantic_role = "${route.semanticRole}"`);
      expect(text).toContain(`route_class = "${route.routeClass}"`);
      expect(text).toContain(`role_spec_path = "${route.roleSpec}"`);
    }
    for (const role of ['red-teamer', 'load-tester']) {
      expect(read(`agents/codex/${role}.toml`)).toContain('sandbox_mode = "read-only"');
    }
  });

  test('rejects write-enabled report-only adapters', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-report-only-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      const codexRoute = path.join(temporaryRoot, 'agents/codex/red-teamer.toml');
      writeFileSync(codexRoute, readFileSync(codexRoute, 'utf8').replace('sandbox_mode = "read-only"', 'sandbox_mode = "workspace-write"'), 'utf8');
      const claudeAdapter = path.join(temporaryRoot, 'agents/red-teamer.md');
      writeFileSync(claudeAdapter, readFileSync(claudeAdapter, 'utf8').replace('tools: Read, Glob, Grep, Bash', 'tools: Read, Write, Edit, Glob, Grep, Bash').replace('permissionMode: default', 'permissionMode: acceptEdits'), 'utf8');
      const findings = runArtifactChecks({ projectRoot: temporaryRoot });
      expect(findings.some((item) => item.file === 'agents/codex/red-teamer.toml' && /sandbox(?:_mode)? must be read-only/.test(item.message))).toBe(true);
      expect(findings.some((item) => item.file === 'agents/red-teamer.md' && /permissionMode default|Write or Edit/.test(item.message))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test('requires the exact Codex multi-agent disable feature', () => {
    for (const variant of ['missing', 'true', 'legacy']) {
      const temporaryRoot = mkdtempSync(path.join(tmpdir(), `riff-route-feature-${variant}-`));
      try {
        cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
        const controller = path.join(temporaryRoot, 'agents/codex/controller-routine.toml');
        let text = readFileSync(controller, 'utf8');
        if (variant === 'missing') text = text.replace(/\n\[features\][\s\S]*$/, '');
        if (variant === 'true') text = text.replace('multi_agent = false', 'multi_agent = true');
        if (variant === 'legacy') text = text.replace('[features]\nmulti_agent = false', '[agents]\nenabled = false');
        writeFileSync(controller, text, 'utf8');
        expect(runArtifactChecks({ projectRoot: temporaryRoot }).some((item) => item.file === 'agents/codex/controller-routine.toml' && /multi_agent|\[features\]|legacy/.test(item.message))).toBe(true);
      } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
      }
    }
  }, 60_000);

  test('rejects route metadata and model-effort mutations', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-route-metadata-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      const bounded = path.join(temporaryRoot, 'agents/codex/worker-bounded.toml');
      writeFileSync(bounded, readFileSync(bounded, 'utf8').replace('route_class = "bounded"', 'route_class = "repeatable"').replace('model_reasoning_effort = "high"', 'model_reasoning_effort = "medium"'));
      const findings = runArtifactChecks({ projectRoot: temporaryRoot });
      expect(findings.some((item) => item.file === 'agents/codex/worker-bounded.toml' && /route_class|effort/.test(item.message))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test.each([
    ['missing Luna tier', 'worker-repeatable.toml', (text) => text.replace('service_tier = "priority"\n', '')],
    ['wrong Luna tier', 'worker-repeatable.toml', (text) => text.replace('service_tier = "priority"', 'service_tier = "default"')],
    ['duplicate Luna tier', 'worker-repeatable.toml', (text) => text.replace('service_tier = "priority"', 'service_tier = "priority"\nservice_tier = "priority"')],
    ['unexpected non-Luna tier', 'worker-bounded.toml', (text) => text.replace('sandbox_mode = "workspace-write"', 'service_tier = "priority"\nsandbox_mode = "workspace-write"')],
  ])('fails closed on %s', (_caseName, routeFile, mutate) => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-service-tier-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      const route = path.join(temporaryRoot, 'agents/codex', routeFile);
      writeFileSync(route, mutate(readFileSync(route, 'utf8')), 'utf8');
      const findings = runArtifactChecks({ projectRoot: temporaryRoot });
      expect(findings.some((item) => item.file === `agents/codex/${routeFile}` && /service_tier|duplicate top-level field/.test(item.message))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test('rejects a canonical runtime identifier mutation', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-role-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      const planner = path.join(temporaryRoot, 'agents/roles/planner.md');
      writeFileSync(planner, `${readFileSync(planner, 'utf8')}\nmodel: gpt-5.6-sol\n`, 'utf8');
      expect(runArtifactChecks({ projectRoot: temporaryRoot }).some((item) => item.file === 'agents/roles/planner.md' && /runtime|selection/.test(item.message))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test('requires the planner Owned paths contract', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-planner-contract-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      const planner = path.join(temporaryRoot, 'agents/roles/planner.md');
      const text = readFileSync(planner, 'utf8').replaceAll(/owned paths/gi, 'declared product files');
      writeFileSync(planner, text, 'utf8');
      expect(runArtifactChecks({ projectRoot: temporaryRoot }).some((item) => item.file === 'agents/roles/planner.md' && /owned paths/i.test(item.message))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test('requires the planner test traceability contract', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-planner-traceability-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      const planner = path.join(temporaryRoot, 'agents/roles/planner.md');
      const text = readFileSync(planner, 'utf8').replace('## Test traceability', '## Test planning');
      writeFileSync(planner, text, 'utf8');
      expect(runArtifactChecks({ projectRoot: temporaryRoot }).some((item) => item.file === 'agents/roles/planner.md' && /test traceability/i.test(item.message))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test('requires evidence-backed optional Smoke output fragments', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-planner-smoke-output-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      const planner = path.join(temporaryRoot, 'agents/roles/planner.md');
      const text = readFileSync(planner, 'utf8').replace('prefer `exit_code` only unless the request or existing executable output provides a stable fragment.', 'prefer inferred output unless the request provides a fragment.');
      writeFileSync(planner, text, 'utf8');
      expect(runArtifactChecks({ projectRoot: temporaryRoot }).some((item) => item.file === 'agents/roles/planner.md' && /exit_code.*only/i.test(item.message))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);

  test('rejects Agent nesting in a Claude adapter', () => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'riff-adapter-'));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      const reviewer = path.join(temporaryRoot, 'agents/reviewer.md');
      writeFileSync(reviewer, readFileSync(reviewer, 'utf8').replace('tools: Read, Glob, Grep', 'tools: Read, Glob, Grep, Agent'), 'utf8');
      expect(runArtifactChecks({ projectRoot: temporaryRoot }).some((item) => item.file === 'agents/reviewer.md' && /Agent/.test(item.message))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }, 60_000);
  });

  test.each(['in-root', 'external'])('rejects %s route and role-spec symlink boundaries', (location) => {
    const temporaryRoot = mkdtempSync(path.join(tmpdir(), `riff-route-symlink-${location}-`));
    const outside = mkdtempSync(path.join(tmpdir(), `riff-route-symlink-outside-${location}-`));
    try {
      cpSync(repositoryRoot, temporaryRoot, { recursive: true, filter: (source) => !source.includes(`${path.sep}node_modules${path.sep}`) });
      const targetRoot = location === 'in-root' ? path.join(temporaryRoot, 'safe-targets') : outside;
      mkdirSync(targetRoot, { recursive: true });
      const route = path.join(temporaryRoot, 'agents/codex/controller-routine.toml');
      const roleSpec = path.join(temporaryRoot, 'agents/roles/planner.md');
      const routeTarget = path.join(targetRoot, 'route.toml');
      const specTarget = path.join(targetRoot, 'planner.md');
      writeFileSync(routeTarget, readFileSync(route, 'utf8'));
      writeFileSync(specTarget, readFileSync(roleSpec, 'utf8'));
      rmSync(route);
      rmSync(roleSpec);
      symlinkSync(routeTarget, route);
      symlinkSync(specTarget, roleSpec);
      const findings = runArtifactChecks({ projectRoot: temporaryRoot });
      expect(findings.some((item) => /controller-routine\.toml|planner\.md/.test(item.file) && /symlink|lexical/i.test(item.message))).toBe(true);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

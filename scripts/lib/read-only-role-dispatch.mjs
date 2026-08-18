import path from 'node:path';
import { loadCodexRoutes } from './runtime-routes.mjs';
import { loadClaudeRoutes, providerAdapterIdentity, resolveClaudeBinary, resolveCodexBinaryFromProvider } from './runtime-provider.mjs';
import { dispatchModel } from './model-dispatch.mjs';
import { compareSnapshots, snapshotWorktree } from './worktree-snapshot.mjs';
import { cleanupControlDispatchSnapshot, cleanupPrivateCodexRuntime, createControlDispatchSnapshot, createPrivateCodexRuntime, verifyControlDispatchSnapshot } from './worker-staging.mjs';

function fail(message) { throw new Error(message); }
function routeFor({ frameworkRoot, provider, semanticRole, routeClass }) {
  const routes = provider === 'claude' ? loadClaudeRoutes(frameworkRoot) : loadCodexRoutes(frameworkRoot);
  const route = routes?.[semanticRole]?.[routeClass];
  if (!route) fail(`missing exact runtime route: ${semanticRole}:${routeClass}`);
  if (route.provider !== provider || route.sandbox !== 'read-only') fail(`route is not an exact read-only ${provider} route: ${semanticRole}:${routeClass}`);
  return route;
}
function leaks(value, roots) {
  const text = String(value || '');
  return roots.find((root) => root && text.includes(path.resolve(root)));
}

/** Execute one semantic role against an isolated, disposable read-only snapshot. */
export function dispatchReadOnlyRole({ consumerRoot, frameworkRoot, provider, semanticRole, routeClass, evidenceFiles = [], removePaths = [], protectedPaths = [], artifactPaths = [], promptBuilder, codexBin, claudeBin, timeoutMs, maxBuffer, internalTestAllowNonDarwinSandbox = false, modelDispatch = dispatchModel }) {
  if (!['codex', 'claude'].includes(provider)) fail(`invalid fixed provider: ${provider}`);
  if (typeof promptBuilder !== 'function') fail('read-only role dispatch requires a prompt builder');
  const consumer = path.resolve(consumerRoot);
  const framework = path.resolve(frameworkRoot);
  const route = routeFor({ frameworkRoot: framework, provider, semanticRole, routeClass });
  const before = snapshotWorktree({ root: consumer, explicitPaths: artifactPaths });
  const binary = provider === 'claude' ? resolveClaudeBinary(claudeBin) : resolveCodexBinaryFromProvider(codexBin);
  let runtime; let snapshot; let result; let thrown;
  try {
    runtime = createPrivateCodexRuntime({ prefix: 'riff-read-only-role-', consumerRoot: consumer, frameworkRoot: framework, internalTestAllowNonDarwinSandbox });
    snapshot = createControlDispatchSnapshot({ runtime, consumerRoot: consumer, frameworkRoot: framework, roleSpecPath: route.roleSpecPath, name: 'codeReviewer', removePaths, evidenceFiles });
    const prompt = String(promptBuilder({ projectRoot: snapshot.projectRoot, roleSpecPath: snapshot.roleBundle.roleSpecPath, evidenceFiles: snapshot.evidenceFiles, route }));
    // The role must receive its isolated evidence paths, but never host roots.
    const hostLeak = leaks(prompt, [consumer, framework]);
    const runtimeLeak = String(prompt).includes(runtime.containerRoot) && !String(prompt).includes(snapshot.evidenceRoot);
    const leaked = hostLeak || (runtimeLeak ? runtime.containerRoot : undefined);
    if (leaked) fail(`read-only role prompt leaks an absolute runtime path: ${leaked}`);
    result = modelDispatch({ root: runtime.dispatchRoots.codeReviewer, readPaths: [snapshot.projectRoot, snapshot.roleBundle.bundleRoot, runtime.toolchainRoot], protectedPaths: [...runtime.protectedPaths, ...protectedPaths], binary, route, prompt, roleSpecPathForPrompt: snapshot.roleBundle.roleSpecPath, timeoutMs, maxBuffer, env: runtime.runtimeEnv, shellPath: runtime.toolchainPath });
    const outputLeak = leaks(result.stdout, [consumer, framework, runtime.containerRoot, snapshot.evidenceRoot]);
    if (outputLeak) fail(`read-only role output leaks an absolute runtime path: ${outputLeak}`);
    verifyControlDispatchSnapshot(snapshot);
  } catch (error) { thrown = error; }
  try {
    if (snapshot) cleanupControlDispatchSnapshot(snapshot);
  } catch (error) { if (!thrown) thrown = error; }
  try {
    if (runtime) cleanupPrivateCodexRuntime(runtime);
  } catch (error) { if (!thrown) thrown = error; }
  const after = snapshotWorktree({ root: consumer, explicitPaths: artifactPaths });
  const mutation = compareSnapshots(before, after);
  if (mutation.changed.length || mutation.git_metadata_changed || mutation.git_metadata_root_changed || mutation.staged_diff_changed || mutation.status_changed) {
    const mutationError = new Error(`read-only role mutated consumer workspace: ${mutation.changed.join(', ') || 'Git metadata'}`);
    if (thrown) mutationError.cause = thrown;
    thrown = mutationError;
  }
  if (thrown) throw thrown;
  return { stdout: result.stdout, route: { provider: route.provider, adapter: providerAdapterIdentity(route, framework), model: route.model, effort: route.effort, serviceTier: route.serviceTier || null, semanticRole: route.semanticRole, routeClass: route.routeClass }, argv: result.argv };
}

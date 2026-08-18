import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  addProject,
  findFrameworkRoot,
  loadProfile,
  removeProject,
  resolveProjectConfig,
  resolveRegistry,
  type DashboardConfig,
  type DashboardLevel,
  type RegistryEntry,
} from "./parsers/profile.ts";
import { parseRoadmap, phaseDir, type Roadmap, type RoadmapPhase } from "./parsers/roadmap.ts";
import {
  availableExplainLevels,
  extractDuration,
  readGates,
  resolvePhaseFiles,
  safeRead,
  type GateEntry,
} from "./parsers/phase.ts";
import { parseProjectState } from "./parsers/state.ts";
import { parseNativeWave } from "./parsers/wave.ts";
import {
  BootstrapRunner,
  generateExplanation,
  type BootstrapEvent,
} from "./services/bootstrap.ts";
import { ProjectWatcher, type WatcherEvent } from "./services/watcher.ts";
import { ClaudeNotFoundError, isClaudeAvailable, type ExplainKind, type ExplainLevel } from "./services/claude.ts";
import { diffStatForPhase } from "./services/git.ts";

// ---------- Resolve framework root ----------

const FRAMEWORK_ROOT = findFrameworkRoot(import.meta.dir);
if (!FRAMEWORK_ROOT) {
  console.warn(
    "[server] could not locate RIFF framework root (no profile.yaml.example found above " +
      `${import.meta.dir}). Falling back to dashboard parent.`,
  );
}
const RESOLVED_FRAMEWORK_ROOT = FRAMEWORK_ROOT ?? join(import.meta.dir, "..");

// Boot-time snapshot used only for the startup banner. All API responses
// re-resolve the profile per request so edits to profile.yaml take effect
// without a server restart.
const { config: BOOT_CONFIG } = loadProfile(RESOLVED_FRAMEWORK_ROOT);

console.log(`[server] framework root: ${RESOLVED_FRAMEWORK_ROOT}`);
console.log(`[server] dashboard config: level=${BOOT_CONFIG.level} language=${BOOT_CONFIG.language}`);
console.log(`[server] registry: ${BOOT_CONFIG.projects.length} project(s)`);
if (!isClaudeAvailable()) {
  console.warn("[server] claude CLI not on PATH — generation endpoints will return errors.");
}

// ---------- Shared event bus ----------

type ProjectScopedEvent = (WatcherEvent | BootstrapEvent) & { project: string };

const sseSubscribers = new Set<(event: ProjectScopedEvent) => void>();

function broadcast(event: ProjectScopedEvent): void {
  for (const sub of sseSubscribers) {
    try {
      sub(event);
    } catch (err) {
      console.warn(`[sse] subscriber error:`, err);
    }
  }
}

// ---------- Project contexts ----------

interface ProjectContext {
  slug: string;
  root: string;
  watcher: ProjectWatcher;
  bootstrap: BootstrapRunner;
  bootstrapped: boolean;
}

/**
 * Build a per-project DashboardConfig. Level + language come from the
 * project override (if any), framework profile, or default baseline.
 * `projects` stays empty because the registry is framework-scoped.
 *
 * Called per request so that edits to `.planning/profile.yaml` (or to the
 * framework `profile.yaml`) take effect without a server restart. Cheap:
 * resolveProfile reads two short YAML files from disk.
 */
function projectConfigFor(projectRoot: string): DashboardConfig {
  const project = resolveProjectConfig(projectRoot, RESOLVED_FRAMEWORK_ROOT);
  return {
    level: project.level,
    language: project.language,
    projects: [],
  };
}

const contexts = new Map<string, ProjectContext>();

function buildContexts(registry: RegistryEntry[]): void {
  // Tear down any contexts that are no longer in the registry.
  const wantedSlugs = new Set(registry.filter((e) => e.exists).map((e) => e.slug));
  for (const [slug, ctx] of contexts) {
    if (!wantedSlugs.has(slug)) {
      void ctx.watcher.stop();
      contexts.delete(slug);
    }
  }
  // Spin up any new contexts.
  for (const entry of registry) {
    if (!entry.exists) continue;
    if (contexts.has(entry.slug)) continue;
    const watcher = new ProjectWatcher(entry.root);
    watcher.subscribe((event) => broadcast({ ...event, project: entry.slug }));
    watcher.start();
    // Bootstrap is constructed with the current per-project config. If level
    // or language changes mid-session, in-flight bootstrap keeps the old
    // value. Subsequent API renders use the fresh value via projectConfigFor.
    const bootstrap = new BootstrapRunner(entry.root, projectConfigFor(entry.root));
    bootstrap.subscribe((event) => broadcast({ ...event, project: entry.slug }));
    contexts.set(entry.slug, {
      slug: entry.slug,
      root: entry.root,
      watcher,
      bootstrap,
      bootstrapped: false,
    });
  }
}

function currentRegistry(): RegistryEntry[] {
  // Re-read from disk on every call so add/remove are immediately visible.
  const { config } = loadProfile(RESOLVED_FRAMEWORK_ROOT);
  return resolveRegistry(config.projects);
}

// Initial wiring.
buildContexts(currentRegistry());

/**
 * Trigger bootstrap on first interaction with a project (lazy).
 *
 * Only marks `bootstrapped = true` once we have a valid roadmap to feed it.
 * If ROADMAP.yaml does not exist yet (e.g. project freshly registered before
 * `/riff:start` runs), the next request retries.
 */
function ensureBootstrapped(ctx: ProjectContext): void {
  if (ctx.bootstrapped) return;
  const roadmap = parseRoadmap(ctx.root);
  if (!roadmap) return;
  ctx.bootstrapped = true;
  ctx.bootstrap.start(roadmap);
}

// ---------- Helpers ----------

function findPhase(roadmap: Roadmap | null, id: number): RoadmapPhase | null {
  if (!roadmap) return null;
  return roadmap.phases.find((p) => p.id === id) ?? null;
}

function phaseStatus(
  projectRoot: string,
  phase: RoadmapPhase,
  level: DashboardLevel,
): {
  has_explain: boolean;
  has_explain_post: boolean;
  available_levels: string[];
} {
  const files = resolvePhaseFiles(projectRoot, phase, level);
  return {
    has_explain: !!files.explain,
    has_explain_post: !!files.explain_post,
    available_levels: availableExplainLevels(projectRoot, phase),
  };
}

function firstContentLine(content: string | null): string | null {
  if (!content) return null;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("```")) continue;
    return trimmed;
  }
  return null;
}

function explainPreview(projectRoot: string, phase: RoadmapPhase, level: DashboardLevel): string | null {
  const files = resolvePhaseFiles(projectRoot, phase, level);
  const sourcePath = files.explain_post ?? files.explain;
  if (!sourcePath) return null;
  return firstContentLine(safeRead(sourcePath));
}

function projectName(projectRoot: string, roadmap: Roadmap | null): string {
  if (roadmap?.name) return roadmap.name;
  return basename(projectRoot);
}

function isValidLevel(value: string | undefined): value is ExplainLevel {
  return value === "technical" || value === "simple" || value === "eli5";
}

function isValidKind(value: string | undefined): value is ExplainKind {
  return value === "pre" || value === "post";
}

interface ProgressBreakdown {
  total: number;
  done: number;
  in_progress: number;
  todo: number;
  blocked: number;
  skipped: number;
}

function progressOf(roadmap: Roadmap | null): ProgressBreakdown {
  const out: ProgressBreakdown = { total: 0, done: 0, in_progress: 0, todo: 0, blocked: 0, skipped: 0 };
  if (!roadmap) return out;
  for (const p of roadmap.phases) {
    out.total += 1;
    if (p.status === "done") out.done += 1;
    else if (p.status === "in-progress") out.in_progress += 1;
    else if (p.status === "todo") out.todo += 1;
    else if (p.status === "blocked") out.blocked += 1;
    else if (p.status === "skipped") out.skipped += 1;
  }
  return out;
}

function activePhase(roadmap: Roadmap | null): { id: number; slug: string; title: string } | null {
  if (!roadmap) return null;
  const inProgress = roadmap.phases.find((p) => p.status === "in-progress");
  const target = inProgress ?? roadmap.phases.find((p) => p.status === "todo");
  if (!target) return null;
  return { id: target.id, slug: target.slug, title: target.title };
}

function lastModifiedMs(projectRoot: string): number | null {
  // Use the freshest mtime across ROADMAP.yaml, STATE.md, and the phases dir.
  const candidates = [
    join(projectRoot, "ROADMAP.yaml"),
    join(projectRoot, "STATE.md"),
    join(projectRoot, ".planning"),
    join(projectRoot, ".uxtest", "runs"),
  ];
  let latest: number | null = null;
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const m = statSync(p).mtimeMs;
      if (latest === null || m > latest) latest = m;
    } catch {
      /* ignore */
    }
  }
  return latest;
}

function hasUxRuns(projectRoot: string): boolean {
  const runsPath = join(projectRoot, ".uxtest", "runs");
  try {
    return existsSync(runsPath) && statSync(runsPath).isDirectory();
  } catch {
    return false;
  }
}

function safeRunDir(projectRoot: string, runId: string): string | null {
  const runsRoot = resolve(projectRoot, ".uxtest", "runs");
  const candidate = resolve(runsRoot, runId);
  return candidate === runsRoot || candidate.startsWith(`${runsRoot}${sep}`) ? candidate : null;
}

function safeArtifactPath(runDir: string, artifactPath: string): string | null {
  const candidate = resolve(runDir, artifactPath);
  return candidate === runDir || candidate.startsWith(`${runDir}${sep}`) ? candidate : null;
}

function listUxRuns(projectRoot: string): { has_runs_dir: boolean; runs: unknown[] } {
  const runsRoot = join(projectRoot, ".uxtest", "runs");
  if (!hasUxRuns(projectRoot)) return { has_runs_dir: false, runs: [] };

  const runs: unknown[] = [];
  for (const entry of readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runDir = join(runsRoot, entry.name);
    const jsonPath = join(runDir, "run.json");
    if (!existsSync(jsonPath)) continue;
    try {
      const parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
      if (!parsed || typeof parsed !== "object") continue;
      const run = parsed as Record<string, unknown>;
      const stat = statSync(jsonPath);
      runs.push({
        ...run,
        run_id: typeof run.run_id === "string" && run.run_id ? run.run_id : entry.name,
        run_dir: entry.name,
        mtime_ms: stat.mtimeMs,
        flows: Array.isArray(run.flows) ? run.flows : [],
      });
    } catch {
      // Malformed run.json files are ignored so one bad run cannot break the dashboard.
    }
  }

  runs.sort((a, b) => {
    const left = a as { run_id?: unknown; mtime_ms?: unknown };
    const right = b as { run_id?: unknown; mtime_ms?: unknown };
    const byId = String(right.run_id ?? "").localeCompare(String(left.run_id ?? ""));
    if (byId !== 0) return byId;
    return Number(right.mtime_ms ?? 0) - Number(left.mtime_ms ?? 0);
  });
  return { has_runs_dir: true, runs };
}

// ---------- App ----------

const app = new Hono();

/** GET /api/projects — overview list of all registered projects. */
app.get("/api/projects", (c) => {
  const registry = currentRegistry();
  buildContexts(registry); // make sure contexts match registry
  const projects = registry.map((entry) => {
    if (!entry.exists) {
      return {
        slug: entry.slug,
        root: entry.root,
        name: basename(entry.root),
        exists: false,
        progress: progressOf(null),
        active_phase: null,
        state: null,
        native_wave: null,
        last_modified_ms: null,
      };
    }
    const roadmap = parseRoadmap(entry.root);
    return {
      slug: entry.slug,
      root: entry.root,
      name: projectName(entry.root, roadmap),
      exists: true,
      progress: progressOf(roadmap),
      active_phase: activePhase(roadmap),
      state: parseProjectState(entry.root),
      native_wave: parseNativeWave(entry.root),
      last_modified_ms: lastModifiedMs(entry.root),
    };
  });
  // Fresh per-request profile read so edits to profile.yaml take effect
  // without restarting the server.
  const { config: liveConfig } = loadProfile(RESOLVED_FRAMEWORK_ROOT);
  return c.json({
    projects,
    profile: { dashboard: { level: liveConfig.level, language: liveConfig.language } },
    framework_root: RESOLVED_FRAMEWORK_ROOT,
  });
});

/** POST /api/projects — add a project to the registry. Body: { path: string } */
app.post("/api/projects", async (c) => {
  let body: { path?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const path = typeof body.path === "string" ? body.path.trim() : "";
  if (!path) return c.json({ error: "missing 'path'" }, 400);
  if (!path.startsWith("/")) return c.json({ error: "'path' must be absolute" }, 400);
  if (!existsSync(path)) return c.json({ error: `path does not exist: ${path}` }, 400);

  try {
    const registry = addProject(RESOLVED_FRAMEWORK_ROOT, path);
    buildContexts(registry);
    return c.json({ ok: true, registry });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

/** DELETE /api/projects/:slug — remove a project from the registry. */
app.delete("/api/projects/:slug", (c) => {
  const slug = c.req.param("slug");
  try {
    const registry = removeProject(RESOLVED_FRAMEWORK_ROOT, slug);
    buildContexts(registry);
    return c.json({ ok: true, registry });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

/** POST /api/pick-folder — open native macOS folder picker, return chosen path.
 *  Only works when the dashboard runs on the user's local machine (uses osascript).
 *  Response: { path } on selection, { cancelled: true } if user cancels, { error } otherwise. */
app.post("/api/pick-folder", async (c) => {
  if (process.platform !== "darwin") {
    return c.json({ error: "folder picker is only available on macOS" }, 501);
  }
  const script =
    'try\n' +
    '  set chosen to choose folder with prompt "Select project folder"\n' +
    '  return POSIX path of chosen\n' +
    'on error number -128\n' +
    '  return "__CANCELLED__"\n' +
    'end try';
  try {
    const proc = Bun.spawn(["osascript", "-e", script], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);
    if (exitCode !== 0) {
      return c.json({ error: stderr.trim() || `osascript exited with ${exitCode}` }, 500);
    }
    const result = stdout.trim().replace(/\/$/, "");
    if (result === "__CANCELLED__" || !result) {
      return c.json({ cancelled: true });
    }
    return c.json({ path: result });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

/** GET /api/projects/:slug — single project info + full phase list. */
app.get("/api/projects/:slug", (c) => {
  const slug = c.req.param("slug");
  const ctx = contexts.get(slug);
  if (!ctx) return c.json({ error: "project not found" }, 404);

  ensureBootstrapped(ctx);

  // Fresh per-request profile so a mid-session edit to .planning/profile.yaml
  // (or to the framework profile) takes effect on next render.
  const liveConfig = projectConfigFor(ctx.root);
  const roadmap = parseRoadmap(ctx.root);
  const phases = (roadmap?.phases ?? []).map((p) => {
    const meta = phaseStatus(ctx.root, p, liveConfig.level);
    return {
      id: p.id,
      slug: p.slug,
      title: p.title,
      status: p.status,
      priority: p.priority,
      description: p.description,
      depends_on: p.depends_on,
      has_explain: meta.has_explain,
      has_explain_post: meta.has_explain_post,
      available_levels: meta.available_levels,
      explain_preview: explainPreview(ctx.root, p, liveConfig.level),
    };
  });

  const previewPath = join(ctx.root, ".planning", "preview", "plan-preview.html");
  const has_preview = existsSync(previewPath);

  return c.json({
    slug: ctx.slug,
    root: ctx.root,
    name: projectName(ctx.root, roadmap),
    phases,
    progress: progressOf(roadmap),
    active_phase: activePhase(roadmap),
    state: parseProjectState(ctx.root),
    native_wave: parseNativeWave(ctx.root),
    config: { level: liveConfig.level, language: liveConfig.language },
    bootstrap_status: ctx.bootstrap.getStatus(),
    has_preview,
    has_uxruns: hasUxRuns(ctx.root),
  });
});

/** GET /api/projects/:slug/uxruns — parsed uxtest run indexes, newest first. */
app.get("/api/projects/:slug/uxruns", (c) => {
  const slug = c.req.param("slug");
  const ctx = contexts.get(slug);
  if (!ctx) return c.json({ error: "project not found" }, 404);
  return c.json(listUxRuns(ctx.root));
});

/** GET /api/projects/:slug/uxruns/:runId/artifact?path=... — serve one run artifact. */
app.get("/api/projects/:slug/uxruns/:runId/artifact", (c) => {
  const slug = c.req.param("slug");
  const runId = c.req.param("runId");
  const ctx = contexts.get(slug);
  if (!ctx) return c.json({ error: "project not found" }, 404);

  const artifactPath = c.req.query("path");
  if (!artifactPath) return c.json({ error: "missing artifact path" }, 400);

  const runDir = safeRunDir(ctx.root, runId);
  if (!runDir) return c.text("forbidden", 403);
  const candidate = safeArtifactPath(runDir, artifactPath);
  if (!candidate) return c.text("forbidden", 403);
  if (!existsSync(candidate)) return c.text("not found", 404);
  try {
    const stat = statSync(candidate);
    if (!stat.isFile()) return c.text("not found", 404);
  } catch {
    return c.text("not found", 404);
  }
  return new Response(Bun.file(candidate));
});

/** GET /api/projects/:slug/phase/:id — full detail for one phase. */
app.get("/api/projects/:slug/phase/:id", async (c) => {
  const slug = c.req.param("slug");
  const ctx = contexts.get(slug);
  if (!ctx) return c.json({ error: "project not found" }, 404);

  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) {
    return c.json({ error: "invalid phase id" }, 400);
  }
  const roadmap = parseRoadmap(ctx.root);
  const phase = findPhase(roadmap, id);
  if (!phase) {
    return c.json({ error: "phase not found" }, 404);
  }

  const liveConfig = projectConfigFor(ctx.root);
  const levelQuery = c.req.query("level");
  const requestedLevel: ExplainLevel = isValidLevel(levelQuery) ? levelQuery : liveConfig.level;

  const files = resolvePhaseFiles(ctx.root, phase, requestedLevel);
  const explain = files.explain ? safeRead(files.explain) : null;
  const explain_post = files.explain_post ? safeRead(files.explain_post) : null;

  let metadata: {
    duration: string | null;
    files_stat: string | null;
    gates: GateEntry[];
  } | null = null;

  if (phase.status === "done") {
    const summary = files.summary ? safeRead(files.summary) : null;
    const duration = summary ? extractDuration(summary) : null;
    const phaseFolderRel = relative(ctx.root, phaseDir(ctx.root, phase));
    const filesStat = await diffStatForPhase(ctx.root, phaseFolderRel);
    metadata = {
      duration,
      files_stat: filesStat,
      gates: readGates(files.gates),
    };
  }

  const phaseMeta = phaseStatus(ctx.root, phase, liveConfig.level);

  return c.json({
    project: ctx.slug,
    id: phase.id,
    slug: phase.slug,
    title: phase.title,
    status: phase.status,
    priority: phase.priority,
    description: phase.description,
    depends_on: phase.depends_on,
    explain,
    explain_post,
    current_level: requestedLevel,
    available_levels: phaseMeta.available_levels,
    metadata,
    raw_paths: {
      plan: files.plan,
      summary: files.summary,
      verification: files.verification,
      gates: files.gates,
      refactor: files.refactor,
      plan_review: files.plan_review,
    },
  });
});

/** GET /api/projects/:slug/phase/:id/generate — SSE stream that produces an EXPLAIN file. */
app.get("/api/projects/:slug/phase/:id/generate", (c) => {
  const slug = c.req.param("slug");
  const ctx = contexts.get(slug);
  if (!ctx) return c.json({ error: "project not found" }, 404);

  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) {
    return c.json({ error: "invalid phase id" }, 400);
  }
  const liveConfig = projectConfigFor(ctx.root);
  const levelParam = c.req.query("level") ?? liveConfig.level;
  const kindParam = c.req.query("kind");
  if (!isValidLevel(levelParam)) {
    return c.json({ error: "invalid level (expected technical|simple|eli5)" }, 400);
  }
  if (!isValidKind(kindParam)) {
    return c.json({ error: "invalid kind (expected pre|post)" }, 400);
  }
  const roadmap = parseRoadmap(ctx.root);
  const phase = findPhase(roadmap, id);
  if (!phase) {
    return c.json({ error: "phase not found" }, 404);
  }

  return streamSSE(c, async (s) => {
    s.onAbort(() => {
      // Bun.spawn handles will be garbage-collected; nothing more to do here.
    });

    const send = async (event: { type: string; [k: string]: unknown }) => {
      await s.writeSSE({ event: event.type, data: JSON.stringify(event) });
    };

    await send({ type: "start" });

    if (!isClaudeAvailable()) {
      await send({
        type: "error",
        message: "Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
      });
      return;
    }

    try {
      const filename = await generateExplanation({
        projectRoot: ctx.root,
        phase,
        kind: kindParam,
        config: liveConfig,
        level: levelParam,
        onChunk: (text) => {
          void send({ type: "chunk", text });
        },
      });
      const path = join(phaseDir(ctx.root, phase), filename);
      await send({ type: "done", path });
      // Notify other watchers of the new file (scoped to this project).
      broadcast({ type: "phase_changed", id: phase.id, files: [filename], project: ctx.slug });
    } catch (err) {
      const message =
        err instanceof ClaudeNotFoundError
          ? err.message
          : `generation failed: ${(err as Error).message}`;
      await send({ type: "error", message });
    }
  });
});

/** GET /api/projects/:slug/preview — serve the plan preview HTML if it exists. */
app.get("/api/projects/:slug/preview", (c) => {
  const slug = c.req.param("slug");
  const ctx = contexts.get(slug);
  if (!ctx) return c.json({ error: "project not found" }, 404);

  const previewPath = join(ctx.root, ".planning", "preview", "plan-preview.html");
  if (!existsSync(previewPath)) {
    return c.json({ error: "no preview available", has_preview: false }, 404);
  }
  const file = Bun.file(previewPath);
  return new Response(file, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

/** GET /api/projects/:slug/preview/status — check if a plan preview exists. */
app.get("/api/projects/:slug/preview/status", (c) => {
  const slug = c.req.param("slug");
  const ctx = contexts.get(slug);
  if (!ctx) return c.json({ error: "project not found" }, 404);

  const previewPath = join(ctx.root, ".planning", "preview", "plan-preview.html");
  const exists = existsSync(previewPath);
  let mtime: number | null = null;
  if (exists) {
    try {
      mtime = statSync(previewPath).mtimeMs;
    } catch { /* ignore */ }
  }
  return c.json({ has_preview: exists, mtime });
});

/** GET /api/projects/:slug/bootstrap-status — bootstrap progress for one project. */
app.get("/api/projects/:slug/bootstrap-status", (c) => {
  const slug = c.req.param("slug");
  const ctx = contexts.get(slug);
  if (!ctx) return c.json({ error: "project not found" }, 404);
  return c.json(ctx.bootstrap.getStatus());
});

/** GET /api/events — SSE stream of all project events. */
app.get("/api/events", (c) => {
  return streamSSE(c, async (s) => {
    let closed = false;
    let resolveDone: (() => void) | null = null;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });

    const send = async (event: { type: string; [k: string]: unknown }) => {
      if (closed) return;
      try {
        await s.writeSSE({ event: event.type, data: JSON.stringify(event) });
      } catch {
        closed = true;
        resolveDone?.();
      }
    };

    const subscriber = (event: ProjectScopedEvent) => {
      void send(event);
    };
    sseSubscribers.add(subscriber);

    const heartbeat = setInterval(() => {
      void s.writeSSE({ event: "ping", data: "" }).catch(() => {
        closed = true;
        resolveDone?.();
      });
    }, 30_000);

    s.onAbort(() => {
      closed = true;
      clearInterval(heartbeat);
      sseSubscribers.delete(subscriber);
      resolveDone?.();
    });

    await send({ type: "ready" });

    await done;
    clearInterval(heartbeat);
    sseSubscribers.delete(subscriber);
  });
});

// ---------- Static assets ----------

const PUBLIC_DIR = join(import.meta.dir, "public");

app.get("/", async (c) => {
  const indexPath = join(PUBLIC_DIR, "index.html");
  if (!existsSync(indexPath)) {
    return c.html(
      `<!doctype html><html><body><h1>RIFF dashboard</h1><p>Frontend not built yet. Place files in <code>${PUBLIC_DIR}</code>.</p></body></html>`,
    );
  }
  const file = Bun.file(indexPath);
  return new Response(file, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

app.get("*", async (c) => {
  const url = new URL(c.req.url);
  const requested = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  if (requested.includes("..")) {
    return c.text("forbidden", 403);
  }
  const candidate = join(PUBLIC_DIR, requested);
  if (existsSync(candidate)) {
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) {
        return new Response(Bun.file(candidate));
      }
    } catch {
      /* fall through */
    }
  }
  const indexPath = join(PUBLIC_DIR, "index.html");
  if (existsSync(indexPath)) {
    return new Response(Bun.file(indexPath), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  return c.text("not found", 404);
});

// ---------- Boot ----------

const port = Number(process.env.PORT ?? 4000);

const server = Bun.serve({
  port,
  fetch: app.fetch,
  idleTimeout: 0,
});

console.log(`[server] listening on http://localhost:${server.port}`);

const shutdown = async () => {
  console.log("[server] shutting down");
  for (const ctx of contexts.values()) {
    await ctx.watcher.stop();
  }
  server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

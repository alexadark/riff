import { existsSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { Hono } from "hono";
import { stream, streamSSE } from "hono/streaming";
import { findFrameworkRoot, loadProfile } from "./parsers/profile.ts";
import { parseRoadmap, phaseDir, type Roadmap, type RoadmapPhase } from "./parsers/roadmap.ts";
import {
  availableExplainLevels,
  extractDuration,
  readGates,
  resolvePhaseFiles,
  safeRead,
} from "./parsers/phase.ts";
import {
  BootstrapRunner,
  generateExplanation,
  type BootstrapEvent,
} from "./services/bootstrap.ts";
import { ProjectWatcher, type WatcherEvent } from "./services/watcher.ts";
import { ClaudeNotFoundError, isClaudeAvailable, type ExplainKind, type ExplainLevel } from "./services/claude.ts";
import { diffStatForPhase } from "./services/git.ts";

// ---------- Resolve roots ----------

const PROJECT_ROOT = process.env.PROJECT_ROOT ?? process.cwd();
const FRAMEWORK_ROOT = findFrameworkRoot(import.meta.dir);
if (!FRAMEWORK_ROOT) {
  console.warn(
    "[server] could not locate RIFF framework root (no profile.yaml.example found above " +
      `${import.meta.dir}). Falling back to dashboard parent.`,
  );
}
const RESOLVED_FRAMEWORK_ROOT = FRAMEWORK_ROOT ?? join(import.meta.dir, "..");

const { config: PROFILE_CONFIG } = loadProfile(RESOLVED_FRAMEWORK_ROOT);

console.log(`[server] project root: ${PROJECT_ROOT}`);
console.log(`[server] framework root: ${RESOLVED_FRAMEWORK_ROOT}`);
console.log(`[server] dashboard config: level=${PROFILE_CONFIG.level} language=${PROFILE_CONFIG.language}`);
if (!isClaudeAvailable()) {
  console.warn("[server] claude CLI not on PATH — generation endpoints will return errors.");
}

// ---------- Shared event bus ----------

type SseEvent = WatcherEvent | BootstrapEvent;

const sseSubscribers = new Set<(event: SseEvent) => void>();

function broadcast(event: SseEvent): void {
  for (const sub of sseSubscribers) {
    try {
      sub(event);
    } catch (err) {
      console.warn(`[sse] subscriber error:`, err);
    }
  }
}

// ---------- Watcher + bootstrap ----------

const watcher = new ProjectWatcher(PROJECT_ROOT);
watcher.subscribe((event) => broadcast(event));
watcher.start();

const bootstrap = new BootstrapRunner(PROJECT_ROOT, PROFILE_CONFIG);
bootstrap.subscribe((event) => broadcast(event));

// Kick off bootstrap on startup if we can read the roadmap.
const initialRoadmap = parseRoadmap(PROJECT_ROOT);
if (initialRoadmap) {
  bootstrap.start(initialRoadmap);
} else {
  console.warn(`[server] no ROADMAP.yaml at ${PROJECT_ROOT} — bootstrap skipped`);
}

// ---------- Helpers ----------

function findPhase(roadmap: Roadmap | null, id: number): RoadmapPhase | null {
  if (!roadmap) return null;
  return roadmap.phases.find((p) => p.id === id) ?? null;
}

function phaseStatus(phase: RoadmapPhase): {
  has_explain: boolean;
  has_explain_post: boolean;
  available_levels: string[];
} {
  const files = resolvePhaseFiles(PROJECT_ROOT, phase, PROFILE_CONFIG.level);
  return {
    has_explain: !!files.explain,
    has_explain_post: !!files.explain_post,
    available_levels: availableExplainLevels(PROJECT_ROOT, phase),
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

function explainPreview(phase: RoadmapPhase): string | null {
  const files = resolvePhaseFiles(PROJECT_ROOT, phase, PROFILE_CONFIG.level);
  const sourcePath = files.explain_post ?? files.explain;
  if (!sourcePath) return null;
  return firstContentLine(safeRead(sourcePath));
}

function projectName(roadmap: Roadmap | null): string {
  if (roadmap?.name) return roadmap.name;
  return basename(PROJECT_ROOT);
}

function isValidLevel(value: string | undefined): value is ExplainLevel {
  return value === "technical" || value === "simple" || value === "eli5";
}

function isValidKind(value: string | undefined): value is ExplainKind {
  return value === "pre" || value === "post";
}

// ---------- App ----------

const app = new Hono();

app.get("/api/project", (c) => {
  const roadmap = parseRoadmap(PROJECT_ROOT);
  return c.json({
    name: projectName(roadmap),
    root: PROJECT_ROOT,
    framework_root: RESOLVED_FRAMEWORK_ROOT,
    profile: { dashboard: PROFILE_CONFIG },
  });
});

app.get("/api/phases", (c) => {
  const roadmap = parseRoadmap(PROJECT_ROOT);
  if (!roadmap) {
    return c.json({ phases: [] });
  }
  const phases = roadmap.phases.map((p) => {
    const meta = phaseStatus(p);
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
      explain_preview: explainPreview(p),
    };
  });
  return c.json({ phases });
});

app.get("/api/phase/:id", async (c) => {
  const idParam = c.req.param("id");
  const id = Number(idParam);
  if (!Number.isFinite(id)) {
    return c.json({ error: "invalid phase id" }, 400);
  }
  const roadmap = parseRoadmap(PROJECT_ROOT);
  const phase = findPhase(roadmap, id);
  if (!phase) {
    return c.json({ error: "phase not found" }, 404);
  }

  const levelQuery = c.req.query("level");
  const requestedLevel: ExplainLevel = isValidLevel(levelQuery) ? levelQuery : PROFILE_CONFIG.level;

  const files = resolvePhaseFiles(PROJECT_ROOT, phase, requestedLevel);
  const explain = files.explain ? safeRead(files.explain) : null;
  const explain_post = files.explain_post ? safeRead(files.explain_post) : null;

  let metadata: {
    duration: string | null;
    files_stat: string | null;
    gates: { step: string; status: string; detail: string }[];
  } | null = null;

  if (phase.status === "done") {
    const summary = files.summary ? safeRead(files.summary) : null;
    const duration = summary ? extractDuration(summary) : null;
    const phaseFolderRel = relative(PROJECT_ROOT, phaseDir(PROJECT_ROOT, phase));
    const filesStat = await diffStatForPhase(PROJECT_ROOT, phaseFolderRel);
    metadata = {
      duration,
      files_stat: filesStat,
      gates: readGates(files.gates),
    };
  }

  const phaseMeta = phaseStatus(phase);

  return c.json({
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

app.get("/api/bootstrap-status", (c) => {
  return c.json(bootstrap.getStatus());
});

// EventSource (browser SSE) is GET-only, so this endpoint is GET.
app.get("/api/phase/:id/generate", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isFinite(id)) {
    return c.json({ error: "invalid phase id" }, 400);
  }
  const levelParam = c.req.query("level") ?? PROFILE_CONFIG.level;
  const kindParam = c.req.query("kind");
  if (!isValidLevel(levelParam)) {
    return c.json({ error: "invalid level (expected technical|simple|eli5)" }, 400);
  }
  if (!isValidKind(kindParam)) {
    return c.json({ error: "invalid kind (expected pre|post)" }, 400);
  }
  const roadmap = parseRoadmap(PROJECT_ROOT);
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
        projectRoot: PROJECT_ROOT,
        phase,
        kind: kindParam,
        config: PROFILE_CONFIG,
        level: levelParam,
        onChunk: (text) => {
          void send({ type: "chunk", text });
        },
      });
      const path = join(phaseDir(PROJECT_ROOT, phase), filename);
      await send({ type: "done", path });
      // Notify other watchers of the new file.
      broadcast({ type: "phase_changed", id: phase.id, files: [filename] });
    } catch (err) {
      const message =
        err instanceof ClaudeNotFoundError
          ? err.message
          : `generation failed: ${(err as Error).message}`;
      await send({ type: "error", message });
    }
  });
});

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

    const subscriber = (event: SseEvent) => {
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

    // Initial hello so the client can confirm connection.
    await send({ type: "ready" });

    // Block until the connection closes.
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
  // Serve static files from /public, fall back to index.html for SPA-style routing.
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
  // SPA fallback.
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

// Graceful shutdown.
const shutdown = async () => {
  console.log("[server] shutting down");
  await watcher.stop();
  server.stop();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

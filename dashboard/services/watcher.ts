import { existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";

export type WatcherEvent =
  | { type: "roadmap_changed" }
  | { type: "state_changed" }
  | { type: "phase_changed"; id: number; files: string[] }
  | { type: "uxtest_runs_changed"; files: string[] }
  | { type: "native_wave_changed"; files: string[] };

export type WatcherListener = (event: WatcherEvent) => void;

interface PendingPhaseChange {
  id: number;
  files: Set<string>;
}

/**
 * Watch RIFF artefacts in a project root and broadcast normalised events to
 * subscribed listeners. Events are debounced 500ms per phase / per top-level
 * file so a burst of writes only emits once.
 */
export class ProjectWatcher {
  private listeners = new Set<WatcherListener>();
  private watcher: FSWatcher | null = null;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingPhase = new Map<number, PendingPhaseChange>();
  private pendingTopLevel = new Set<string>();
  private pendingUxRuns = new Set<string>();
  private pendingNativeWave = new Set<string>();

  constructor(private readonly projectRoot: string) {}

  start(): void {
    if (this.watcher) return;

    const targets = [
      join(this.projectRoot, "ROADMAP.yaml"),
      join(this.projectRoot, "STATE.md"),
      // Watch the planning root itself so a later-created riff-wave/riff-next
      // directory is observed too. Chokidar follows children after creation.
      join(this.projectRoot, ".planning"),
      join(this.projectRoot, ".uxtest"),
    ].filter((p) => p === join(this.projectRoot, ".planning") || existsSync(p));

    if (targets.length === 0) {
      console.warn(`[watcher] no targets to watch under ${this.projectRoot}`);
      return;
    }

    this.watcher = chokidar.watch(targets, {
      ignoreInitial: true,
      persistent: true,
      ignored: (path: string) => path.includes(`${sep}node_modules${sep}`),
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    const handle = (path: string) => this.classify(path);
    this.watcher.on("add", handle);
    this.watcher.on("change", handle);
    this.watcher.on("unlink", handle);
    this.watcher.on("error", (err: unknown) => {
      console.warn(`[watcher] error:`, err);
    });
  }

  async stop(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    this.pendingPhase.clear();
    this.pendingTopLevel.clear();
    this.pendingUxRuns.clear();
    this.pendingNativeWave.clear();
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  subscribe(listener: WatcherListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private classify(absPath: string): void {
    const rel = relative(this.projectRoot, absPath);
    if (!rel || rel.startsWith("..")) return;

    if (rel === "ROADMAP.yaml") {
      this.pendingTopLevel.add("roadmap");
      this.scheduleFlush("__top__");
      return;
    }
    if (rel === "STATE.md") {
      this.pendingTopLevel.add("state");
      this.scheduleFlush("__top__");
      return;
    }

    const segments = rel.split(sep);
    if (segments[0] === ".planning" && (segments[1] === "riff-wave" || segments[1] === "riff-next")) {
      this.pendingNativeWave.add(segments.join("/"));
      this.scheduleFlush("native:wave");
      return;
    }
    if (segments[0] === ".planning" && segments[1] === "phases" && segments[2]) {
      const folder = segments[2];
      const filename = segments.slice(3).join("/") || folder;
      const id = this.parsePhaseId(folder);
      if (id === null) return;
      const entry = this.pendingPhase.get(id) ?? { id, files: new Set<string>() };
      if (filename) entry.files.add(filename);
      this.pendingPhase.set(id, entry);
      this.scheduleFlush(`phase:${id}`);
      return;
    }

    if (segments[0] === ".uxtest" && segments[1] === "runs") {
      this.pendingUxRuns.add(segments.slice(2).join("/") || ".uxtest/runs");
      this.scheduleFlush("uxtest:runs");
    }
  }

  private parsePhaseId(folderName: string): number | null {
    const match = /^(\d+)-/.exec(folderName);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) ? n : null;
  }

  private scheduleFlush(key: string): void {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(key);
      this.flush(key);
    }, 500);
    this.timers.set(key, timer);
  }

  private flush(key: string): void {
    if (key === "__top__") {
      const top = this.pendingTopLevel;
      this.pendingTopLevel = new Set<string>();
      if (top.has("roadmap")) this.broadcast({ type: "roadmap_changed" });
      if (top.has("state")) this.broadcast({ type: "state_changed" });
      return;
    }
    if (key.startsWith("phase:")) {
      const id = Number(key.slice("phase:".length));
      const entry = this.pendingPhase.get(id);
      this.pendingPhase.delete(id);
      if (!entry) return;
      this.broadcast({ type: "phase_changed", id, files: [...entry.files] });
      return;
    }
    if (key === "uxtest:runs") {
      const files = [...this.pendingUxRuns];
      this.pendingUxRuns = new Set<string>();
      this.broadcast({ type: "uxtest_runs_changed", files });
      return;
    }
    if (key === "native:wave") {
      const files = [...this.pendingNativeWave];
      this.pendingNativeWave = new Set<string>();
      this.broadcast({ type: "native_wave_changed", files });
    }
  }

  private broadcast(event: WatcherEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn(`[watcher] listener error:`, err);
      }
    }
  }
}

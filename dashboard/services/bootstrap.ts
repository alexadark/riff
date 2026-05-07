import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import type { Roadmap, RoadmapPhase } from "../parsers/roadmap.ts";
import { phaseDir } from "../parsers/roadmap.ts";
import { resolvePhaseFiles, readGates, extractDuration } from "../parsers/phase.ts";
import {
  buildPostPrompt,
  buildPrePrompt,
  isClaudeAvailable,
  runClaude,
  tryReadFile,
  type ExplainKind,
  type ExplainLevel,
} from "./claude.ts";
import { diffStatForPhase } from "./git.ts";
import type { DashboardConfig } from "../parsers/profile.ts";

export interface BootstrapStatus {
  running: boolean;
  total: number;
  done: number;
  failed: number;
  current: string | null;
}

export type BootstrapEvent =
  | { type: "phase_changed"; id: number; files: string[] }
  | { type: "bootstrap_status"; status: BootstrapStatus };

export type BootstrapListener = (event: BootstrapEvent) => void;

interface QueuedJob {
  phase: RoadmapPhase;
  kind: ExplainKind;
}

const CONCURRENCY = 8;

export class BootstrapRunner {
  private status: BootstrapStatus = {
    running: false,
    total: 0,
    done: 0,
    failed: 0,
    current: null,
  };

  private listeners = new Set<BootstrapListener>();

  constructor(
    private readonly projectRoot: string,
    private readonly config: DashboardConfig,
  ) {}

  getStatus(): BootstrapStatus {
    return { ...this.status };
  }

  subscribe(listener: BootstrapListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Scan the roadmap and queue any missing EXPLAIN/EXPLAIN-POST files.
   * Runs in the background; resolves immediately.
   */
  start(roadmap: Roadmap): void {
    if (this.status.running) return;
    const queue = this.buildQueue(roadmap);
    if (queue.length === 0) {
      this.status = { running: false, total: 0, done: 0, failed: 0, current: null };
      this.emit({ type: "bootstrap_status", status: this.getStatus() });
      return;
    }
    if (!isClaudeAvailable()) {
      console.warn(
        "[bootstrap] claude CLI not found; skipping background explanation generation. " +
          "Install with: npm install -g @anthropic-ai/claude-code",
      );
      this.status = { running: false, total: 0, done: 0, failed: 0, current: null };
      this.emit({ type: "bootstrap_status", status: this.getStatus() });
      return;
    }

    this.status = {
      running: true,
      total: queue.length,
      done: 0,
      failed: 0,
      current: queue[0] ? this.label(queue[0]) : null,
    };
    this.emit({ type: "bootstrap_status", status: this.getStatus() });

    // Fire-and-forget worker pool.
    void this.runPool(queue);
  }

  private buildQueue(roadmap: Roadmap): QueuedJob[] {
    const queue: QueuedJob[] = [];
    for (const phase of roadmap.phases) {
      const files = resolvePhaseFiles(this.projectRoot, phase, this.config.level);
      const isPlanned = phase.status === "todo" || phase.status === "in-progress" || phase.status === "blocked";
      // Pre-EXPLAIN works from ROADMAP description alone; PLAN.md enriches it but is not required.
      if (isPlanned && !files.explain) {
        queue.push({ phase, kind: "pre" });
      }
      if (phase.status === "done" && files.summary && !files.explain_post) {
        queue.push({ phase, kind: "post" });
      }
    }
    return queue;
  }

  private label(job: QueuedJob): string {
    return `${job.phase.id}-${job.phase.slug} (${job.kind})`;
  }

  private async runPool(queue: QueuedJob[]): Promise<void> {
    let cursor = 0;
    const next = (): QueuedJob | null => {
      if (cursor >= queue.length) return null;
      return queue[cursor++] ?? null;
    };

    const worker = async () => {
      while (true) {
        const job = next();
        if (!job) return;
        this.status.current = this.label(job);
        this.emit({ type: "bootstrap_status", status: this.getStatus() });
        try {
          const filename = await generateExplanation({
            projectRoot: this.projectRoot,
            phase: job.phase,
            kind: job.kind,
            config: this.config,
          });
          this.status.done += 1;
          this.emit({
            type: "phase_changed",
            id: job.phase.id,
            files: [filename],
          });
        } catch (err) {
          this.status.failed += 1;
          console.warn(
            `[bootstrap] failed to generate ${this.label(job)}:`,
            (err as Error).message,
          );
        }
        this.emit({ type: "bootstrap_status", status: this.getStatus() });
      }
    };

    const workers: Promise<void>[] = [];
    const n = Math.min(CONCURRENCY, queue.length);
    for (let i = 0; i < n; i++) workers.push(worker());
    await Promise.all(workers);

    this.status.running = false;
    this.status.current = null;
    this.emit({ type: "bootstrap_status", status: this.getStatus() });
  }

  private emit(event: BootstrapEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.warn(`[bootstrap] listener error:`, err);
      }
    }
  }
}

export interface GenerateOptions {
  projectRoot: string;
  phase: RoadmapPhase;
  kind: ExplainKind;
  config: DashboardConfig;
  /** Optional override for the level (e.g. switcher-driven). Defaults to config.level. */
  level?: ExplainLevel;
  onChunk?: (text: string) => void;
}

/**
 * Generate an EXPLAIN or EXPLAIN-POST file for a phase by calling `claude --print`.
 * Writes the result to disk and returns the filename written (relative to phase folder).
 */
export async function generateExplanation(opts: GenerateOptions): Promise<string> {
  const level = (opts.level ?? opts.config.level) as ExplainLevel;
  const language = opts.config.language;
  const files = resolvePhaseFiles(opts.projectRoot, opts.phase, level);

  let prompt: string;
  let outputName: string;

  if (opts.kind === "pre") {
    const plan = tryReadFile(files.plan);
    prompt = buildPrePrompt({
      id: opts.phase.id,
      title: opts.phase.title,
      status: opts.phase.status,
      description: opts.phase.description,
      level,
      language,
      plan,
    });
    outputName = `EXPLAIN.${level}.md`;
  } else {
    const summary = tryReadFile(files.summary);
    const planReview = tryReadFile(files.plan_review);
    const refactor = tryReadFile(files.refactor);
    const verification = tryReadFile(files.verification);
    const duration = summary ? extractDuration(summary) ?? "unknown" : "unknown";
    const phaseFolderRel = relative(opts.projectRoot, phaseDir(opts.projectRoot, opts.phase));
    const filesStat = (await diffStatForPhase(opts.projectRoot, phaseFolderRel)) ?? "(unavailable)";
    const gates = readGates(files.gates);
    const gatesSummary =
      gates.length === 0
        ? "(no gates run)"
        : gates.map((g) => `Step ${g.step}: ${g.status}${g.detail ? ` — ${g.detail}` : ""}`).join("\n");

    prompt = buildPostPrompt({
      id: opts.phase.id,
      title: opts.phase.title,
      status: "done",
      description: opts.phase.description,
      level,
      language,
      summary,
      plan_review: planReview,
      refactor,
      verification,
      duration,
      files_stat: filesStat,
      gates_summary: gatesSummary,
    });
    outputName = `EXPLAIN-POST.${level}.md`;
  }

  const { text } = await runClaude({
    prompt,
    model: "haiku",
    onChunk: opts.onChunk,
  });

  const targetDir = phaseDir(opts.projectRoot, opts.phase);
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, outputName);
  // Ensure parent exists in case of unusual layouts.
  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, text.trim() + "\n", "utf8");
  return outputName;
}

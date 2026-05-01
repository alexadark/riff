import { existsSync, readFileSync } from "node:fs";

export type ExplainLevel = "technical" | "simple" | "eli5";
export type ExplainKind = "pre" | "post";

export interface PromptInputs {
  id: number;
  title: string;
  status: string;
  description: string;
  level: ExplainLevel;
  language: string;
  /** PLAN.md content (pre) */
  plan?: string;
  /** SUMMARY.md content (post) */
  summary?: string;
  plan_review?: string;
  refactor?: string;
  verification?: string;
  duration?: string;
  files_stat?: string;
  gates_summary?: string;
}

const COMMON_STYLE = `Style rules (apply to all levels):
- No filler: drop "in order to", "make sure to", "afin de", "dans le cadre de", "au total".
- No marketing words: avoid "robust", "seamless", "leverage", "streamlined", "optimal", "powerful".
- No politeness or transition fluff: avoid "additionally", "moreover", "furthermore", "également", "par ailleurs", "néanmoins", "il est à noter que".
- French: "on" not "nous". "ça" not "cela". Contractions OK.
- English: contractions OK ("we've", "didn't", "it's").
- One sentence per line. Never glue two sentences together.
- Every sentence carries information. No padding to fill a length.
- Length = what the content actually needs. No hard cap. Don't pad, don't cut a useful detail to hit a target.`;

const TECHNICAL_RULES = `Audience level: technical — senior developer reading their own dashboard.
- Name functions, types, files, paths, libraries when they matter (e.g. "buildPrePrompt", "RegistryEntry", "services/claude.ts", "Bun.serve", "Hono router").
- Tech vocabulary is assumed (SSE, registry, slug, watcher, debounce, IPC, schema, migration, etc.). Do not vulgarize.
- Implementation details are welcome when they explain WHAT works differently.
- Surface architecture decisions, not just user-visible behavior.
- Typical length: 5-10 lines. Go longer if the phase touches many parts.`;

const SIMPLE_RULES = `Audience level: simple — the developer at a glance, no jargon.
- Plain words. Replace tech terms with what they mean ("registry" → "list of projects", "SSE" → "live updates", "watcher" → "auto-refresh").
- Focus on WHAT changes for the system or the user, not the how.
- Concrete examples beat abstract descriptions.
- Typical length: 3-7 lines. Add a line if it's needed to stay clear, don't artificially shorten.`;

const ELI5_RULES = `Audience level: eli5 — someone non-technical, or yourself when tired.
- Use one analogy if it helps. Zero tech vocabulary.
- Focus only on the user-visible outcome. Never mention implementation.
- Typical length: 2-4 sentences. No padding.`;

function levelSpec(level: ExplainLevel): string {
  switch (level) {
    case "technical": return TECHNICAL_RULES;
    case "simple": return SIMPLE_RULES;
    case "eli5": return ELI5_RULES;
  }
}

export function buildPrePrompt(inputs: PromptInputs): string {
  const planSection = inputs.plan?.trim() || "(no PLAN.md found)";
  return `You are summarizing a planned development phase. The reader is the developer themselves, looking at their dashboard.

Phase: ${inputs.id} — ${inputs.title}
Status: ${inputs.status}
ROADMAP description: ${inputs.description}

Plan content (read-only):
${planSection}

Write what THIS PHASE WILL DO when it's executed. Language: ${inputs.language}.

${levelSpec(inputs.level)}

${COMMON_STYLE}

Return ONLY the explanation text. One sentence per line. No preamble, no metadata, no markdown headers.`;
}

export function buildPostPrompt(inputs: PromptInputs): string {
  const summary = inputs.summary?.trim() || "(no SUMMARY.md found)";
  const planReview = inputs.plan_review?.trim() || "(none)";
  const refactor = inputs.refactor?.trim() || "(none)";
  const verification = inputs.verification?.trim() || "(none)";
  const duration = inputs.duration?.trim() || "unknown";
  const filesStat = inputs.files_stat?.trim() || "(unavailable)";
  const gates = inputs.gates_summary?.trim() || "(no gates run)";

  return `You are summarizing a completed development phase. The reader is the developer themselves, looking at their dashboard.

Phase: ${inputs.id} — ${inputs.title}
Status: done
ROADMAP description: ${inputs.description}

Summary content (read-only):
${summary}

Plan-review (optional): ${planReview}
Refactor (optional): ${refactor}
Verification (optional): ${verification}

Computed metadata (do not rewrite — will be appended verbatim below):
- Duration: ${duration}
- Files: ${filesStat}
- Gates: ${gates}

Write WHAT WAS BUILT in this phase. Language: ${inputs.language}. Mention deviations or surprises if any.

${levelSpec(inputs.level)}

${COMMON_STYLE}

After the prose, append this metadata block VERBATIM (no changes):

## Metadata
- Duration: ${duration}
- Files: ${filesStat}
- Gates: ${gates}

Return only the prose + metadata block. One sentence per line in the prose. No preamble, no other markdown headers.`;
}

export class ClaudeNotFoundError extends Error {
  constructor() {
    super("Claude Code CLI not found. Install with: npm install -g @anthropic-ai/claude-code");
    this.name = "ClaudeNotFoundError";
  }
}

let cachedClaudeAvailable: boolean | null = null;

/**
 * Cheap PATH lookup for `claude`. Caches the result for the process lifetime.
 */
export function isClaudeAvailable(): boolean {
  if (cachedClaudeAvailable !== null) return cachedClaudeAvailable;
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(":").filter(Boolean);
  for (const dir of dirs) {
    const candidate = `${dir}/claude`;
    if (existsSync(candidate)) {
      cachedClaudeAvailable = true;
      return true;
    }
  }
  cachedClaudeAvailable = false;
  return false;
}

export interface RunOptions {
  prompt: string;
  model?: string;
  /** Called with each stdout chunk as it arrives. */
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  text: string;
  exitCode: number;
}

/**
 * Spawn `claude --print` with the given prompt on stdin. Streams stdout to `onChunk`.
 *
 * Throws ClaudeNotFoundError if the CLI is missing.
 */
export async function runClaude(opts: RunOptions): Promise<RunResult> {
  if (!isClaudeAvailable()) {
    throw new ClaudeNotFoundError();
  }

  const args = ["claude", "--print"];
  if (opts.model) {
    args.push("--model", opts.model);
  }

  const proc = Bun.spawn(args, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  // Push prompt then close stdin.
  const writer = proc.stdin;
  if (writer) {
    writer.write(opts.prompt);
    await writer.end();
  }

  const decoder = new TextDecoder();
  let collected = "";
  const reader = proc.stdout.getReader();

  let aborted = false;
  const abortHandler = () => {
    aborted = true;
    try {
      proc.kill();
    } catch {
      /* ignore */
    }
  };
  if (opts.signal) {
    if (opts.signal.aborted) abortHandler();
    else opts.signal.addEventListener("abort", abortHandler, { once: true });
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      if (text) {
        collected += text;
        opts.onChunk?.(text);
      }
    }
  } finally {
    if (opts.signal) opts.signal.removeEventListener("abort", abortHandler);
  }

  // Drain trailing decoder bytes.
  const tail = decoder.decode();
  if (tail) {
    collected += tail;
    opts.onChunk?.(tail);
  }

  const exitCode = await proc.exited;
  if (exitCode !== 0 && !aborted) {
    let stderr = "";
    try {
      stderr = await new Response(proc.stderr).text();
    } catch {
      /* ignore */
    }
    throw new Error(
      `claude --print exited with code ${exitCode}${stderr ? `: ${stderr.slice(0, 500)}` : ""}`,
    );
  }

  return { text: collected, exitCode };
}

/**
 * Read a file or return undefined; never throws.
 */
export function tryReadFile(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

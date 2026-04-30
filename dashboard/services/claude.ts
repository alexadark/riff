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

const LEVEL_GUIDE = `Audience level (controls VOCABULARY, not style):
- technical: precise terms OK. 3-5 lines.
- simple: everyday words, no jargon. 3-5 lines.
- eli5: analogy-based. 2 short sentences max.`;

const STYLE_RULES = `Writing style (CRITICAL — apply strictly, no exceptions):
- Casual spoken voice. Not formal. Not corporate. Not "neutre".
- French: "on" not "nous". "ça" not "cela". Drop "également / par ailleurs / néanmoins / au total / dans le cadre de".
- English: contractions ("we've", "didn't", "it's"). Drop "additionally / moreover / furthermore / it is worth noting".
- Short sentences. ONE idea per sentence. Max ~12 words per sentence.
- Line break after EACH period. One sentence per line. NEVER glue two sentences together.
- No filler ("in order to", "make sure to"). No marketing words ("robust / seamless / leverage / streamlined").
- Plain facts, plain words.

Example GOOD (fr):
On a viré 1700 lignes de code mort.
L'app marche pareil mais elle est plus légère.
Aucune surprise.

Example BAD (fr) — DO NOT WRITE LIKE THIS:
Cette phase a consisté à nettoyer la base de code en supprimant des fonctionnalités obsolètes.
Au total, nous avons supprimé environ 1700 lignes de code.
L'application fonctionne exactement de la même manière après ces changements.

Example GOOD (en):
Cleaned up 1700 lines of dead code.
App still works the same, just lighter.
No surprises.`;

export function buildPrePrompt(inputs: PromptInputs): string {
  const planSection = inputs.plan?.trim() || "(no PLAN.md found)";
  return `You are summarizing a planned development phase. The reader is the developer themselves, looking at their dashboard.

Phase: ${inputs.id} — ${inputs.title}
Status: ${inputs.status}
ROADMAP description: ${inputs.description}

Plan content (read-only):
${planSection}

Write what THIS PHASE WILL DO when it's executed. Audience level: ${inputs.level}. Language: ${inputs.language}.

${LEVEL_GUIDE}

${STYLE_RULES}

Focus on WHAT changes for the user or system, not implementation details.

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

Write WHAT WAS BUILT in this phase. Audience level: ${inputs.level}. Language: ${inputs.language}. Mention deviations or surprises if any.

${LEVEL_GUIDE}

${STYLE_RULES}

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

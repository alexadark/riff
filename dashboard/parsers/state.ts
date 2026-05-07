import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Parsed shape of `STATE.md`. Every field is optional because STATE.md is
 * human-edited and may contain partial / stale / placeholder data. Consumers
 * (the dashboard UI) decide what to show vs hide.
 */
export interface ProjectState {
  /** Section: ## Current Position. Bullet-list parsed into a key/value map. */
  current_position: {
    command: string | null;
    phase: string | null;
    stage_step: string | null;
    status: string | null;
    last_action: string | null;
  };
  /** Section: ## Active Decisions. Each non-empty, non-comment line, trimmed. */
  active_decisions: string[];
  /** Section: ## Open Buckets. Each non-empty, non-comment line, trimmed. */
  open_buckets: string[];
  /** Section: ## Resume Command (or "## Resume Commands"). First non-empty, non-comment line. */
  resume_command: string | null;
  /** Section: ## Blockers. Each non-empty, non-comment line. */
  blockers: string[];
  /** Section: ## Next Action. First non-empty paragraph, trimmed. */
  next_action: string | null;
}

const EMPTY_STATE: ProjectState = {
  current_position: {
    command: null,
    phase: null,
    stage_step: null,
    status: null,
    last_action: null,
  },
  active_decisions: [],
  open_buckets: [],
  resume_command: null,
  blockers: [],
  next_action: null,
};

/**
 * Read and parse `<projectRoot>/STATE.md`. Returns `null` if the file is
 * missing. Returns `EMPTY_STATE` shape (with all fields null/[]) if the file
 * exists but no recognized sections are found, so the consumer can always
 * destructure safely.
 */
export function parseProjectState(projectRoot: string): ProjectState | null {
  const path = join(projectRoot, "STATE.md");
  if (!existsSync(path)) return null;
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch (err) {
    console.warn(`[state] failed to read ${path}:`, (err as Error).message);
    return null;
  }
  return parseStateContent(content);
}

/**
 * Pure parser, exposed for testing. Splits the file into sections by
 * `## <heading>` markers, then maps each known heading to a typed field.
 * Unknown sections are ignored. Headings are matched case-insensitively after
 * trimming any trailing punctuation.
 */
export function parseStateContent(content: string): ProjectState {
  const sections = splitSections(content);
  const out: ProjectState = {
    current_position: { ...EMPTY_STATE.current_position },
    active_decisions: [],
    open_buckets: [],
    resume_command: null,
    blockers: [],
    next_action: null,
  };

  for (const [heading, body] of sections) {
    const key = normalizeHeading(heading);
    switch (key) {
      case "current position":
        out.current_position = parseCurrentPosition(body);
        break;
      case "active decisions":
        out.active_decisions = parseBulletList(body);
        break;
      case "open buckets":
        out.open_buckets = parseBulletList(body);
        break;
      case "resume command":
      case "resume commands":
        out.resume_command = firstUsefulLine(body);
        break;
      case "blockers":
        out.blockers = parseBulletList(body);
        break;
      case "next action":
        out.next_action = firstUsefulParagraph(body);
        break;
      default:
        // Unknown section, skip. Keeps the parser tolerant to template drift.
        break;
    }
  }

  return out;
}

/**
 * Split a markdown document into [heading, body] pairs at every `## ` line.
 * Anything before the first `## ` is dropped (typically the `# Title` line).
 */
function splitSections(content: string): Array<[string, string]> {
  const lines = content.split(/\r?\n/);
  const sections: Array<[string, string]> = [];
  let currentHeading: string | null = null;
  let currentBody: string[] = [];

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      if (currentHeading !== null) {
        sections.push([currentHeading, currentBody.join("\n")]);
      }
      currentHeading = match[1] ?? "";
      currentBody = [];
    } else if (currentHeading !== null) {
      currentBody.push(line);
    }
  }
  if (currentHeading !== null) {
    sections.push([currentHeading, currentBody.join("\n")]);
  }
  return sections;
}

function normalizeHeading(heading: string): string {
  return heading.toLowerCase().replace(/[:.\s]+$/, "").trim();
}

const COMMENT_OPEN = "<!--";
const COMMENT_CLOSE = "-->";

/**
 * Strip HTML comment blocks (`<!-- ... -->`), including multi-line ones.
 * STATE.md template uses these for guidance text we do NOT want to surface.
 */
function stripComments(body: string): string {
  let out = body;
  while (true) {
    const open = out.indexOf(COMMENT_OPEN);
    if (open === -1) break;
    const close = out.indexOf(COMMENT_CLOSE, open + COMMENT_OPEN.length);
    if (close === -1) {
      out = out.slice(0, open);
      break;
    }
    out = out.slice(0, open) + out.slice(close + COMMENT_CLOSE.length);
  }
  return out;
}

/**
 * Parse a bullet list section. Accepts `-`, `*`, `+`, or numbered prefixes.
 * Lines that are not bullets (separators like `---`, sub-headings, free-form
 * prose) are ignored so the dashboard does not surface them as fake items.
 */
function parseBulletList(body: string): string[] {
  const cleaned = stripComments(body);
  const items: string[] = [];
  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (!match) continue;
    const value = (match[1] ?? "").trim();
    if (!value || value === "-") continue;
    items.push(value);
  }
  return items;
}

/**
 * Parse the Current Position section. Each line is a `**Key**: value` bullet.
 * Recognizes Command, Phase, Stage / Step, Status, Last action.
 */
function parseCurrentPosition(body: string): ProjectState["current_position"] {
  const cleaned = stripComments(body);
  const out: ProjectState["current_position"] = { ...EMPTY_STATE.current_position };
  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim().replace(/^[-*+]\s+/, "");
    if (!line) continue;
    const match = /^\*?\*?([^*:]+?)\*?\*?\s*:\s*(.+)$/.exec(line);
    if (!match) continue;
    const rawKey = (match[1] ?? "").trim().toLowerCase();
    const value = (match[2] ?? "").trim();
    if (!value || value === "-") continue;
    switch (rawKey) {
      case "command":
        out.command = value;
        break;
      case "phase":
        out.phase = value;
        break;
      case "stage / step":
      case "stage/step":
      case "stage":
      case "step":
        out.stage_step = value;
        break;
      case "status":
        out.status = value;
        break;
      case "last action":
        out.last_action = value;
        break;
      default:
        // Unknown key, ignore.
        break;
    }
  }
  return out;
}

/** First non-blank, non-comment line in the body, trimmed. Returns null if none. */
function firstUsefulLine(body: string): string | null {
  const cleaned = stripComments(body);
  for (const rawLine of cleaned.split("\n")) {
    const line = rawLine.trim().replace(/^[-*+]\s+/, "");
    if (!line) continue;
    return line;
  }
  return null;
}

/**
 * First non-empty paragraph (one or more contiguous non-blank lines) after
 * stripping comments. Used for free-form sections like Next Action.
 */
function firstUsefulParagraph(body: string): string | null {
  const cleaned = stripComments(body);
  const paragraphs = cleaned
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  return paragraphs[0] ?? null;
}

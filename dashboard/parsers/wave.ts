import { createHash } from "node:crypto";
import { constants, lstatSync, openSync, readFileSync, opendirSync, closeSync, fstatSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { parseRoadmap } from "./roadmap.ts";

/** A read-only, defensive projection of persisted `riff wave` state. */
export interface NativeWaveView {
  status: "none" | "valid" | "invalid";
  error: string | null;
  source: "active" | "latest" | null;
  run: string | null;
  mode: string | null;
  state: string | null;
  stop_reason: string | null;
  provider: string | null;
  provider_override: string | null;
  current: { phase_id: string | null; native_phase: string | null; attempt: number | null } | null;
  recovery: { cap: number | null; profile: string | null; latest_cycle: number | null };
  frontiers: Array<{ number: number | null; phase_ids: string[]; status: string | null; started_at: string | null; completed_at: string | null }>;
  phase_attempts: Array<{ phase_id: string | null; title: string | null; status: string | null; attempts: Array<{ attempt: number | null; native_phase: string | null; status: string | null; recovery_cycle: number | null; recovery_strategy: string | null }> }>;
  verification: Array<{ phase_id: string | null; status: string | null; reason: string | null; checks: string[]; request: string | null; receipt: string | null; trust: "reported" | "unavailable" | "invalid" }>;
  security: {
    mechanical: { verdict: string | null; artifact: string | null; artifact_sha256: string | null; trust: "reported" | "unavailable" | "invalid" };
    semantic: { verdict: string | null; artifact: string | null; artifact_sha256: string | null; provider: string | null; route: Record<string, unknown> | null; trust: "reported" | "unavailable" | "invalid" };
  };
  latest_native_stage: { phase: string | null; state: string | null; updated_at: string | null; routing: Record<string, unknown> | null; trust: "reported" | "unavailable" | "invalid" } | null;
}

const MAX_JSON_BYTES = 1024 * 1024;
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const NATIVE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const WAVE_STATES = new Set(["running", "awaiting_human", "paused", "blocked", "completed"]);
const WAVE_MODES = new Set(["wave", "loop"]);
const NEXT_STATES = new Set(["initialized", "controller_passed", "plan_validated", "plan_reviewed", "worker_dispatched", "mechanics_passed", "summary_validated", "reviewer_dispatched", "review_passed", "post_review_mechanics_passed", "completed", "failed"]);
const MAX_ENTRIES = 64;
const MAX_PHASES = 128;
const MAX_WAVES = 32;
const MAX_ATTEMPTS = 32;
const MAX_STRING = 4096;
const PHASE_ID = /^[0-9]+(?:\.[0-9]+)?$/;
const PHASE_SLUG = /^[a-z0-9][a-z0-9-]*$/;

function empty(status: NativeWaveView["status"] = "none", error: string | null = null): NativeWaveView {
  return {
    status, error, source: null, run: null, mode: null, state: null, stop_reason: null, provider: null, provider_override: null, current: null,
    recovery: { cap: null, profile: null, latest_cycle: null }, frontiers: [], phase_attempts: [], verification: [],
    security: { mechanical: { verdict: null, artifact: null, artifact_sha256: null, trust: "unavailable" }, semantic: { verdict: null, artifact: null, artifact_sha256: null, provider: null, route: null, trust: "unavailable" } },
    latest_native_stage: null,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function string(value: unknown): string | null { return typeof value === "string" && value.length > 0 && value.length <= MAX_STRING ? value : null; }
function integer(value: unknown): number | null { return Number.isInteger(value) ? value as number : null; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []; }
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

function realDirectory(path: string, optional = false): boolean {
  try {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`state ancestor is not a real directory: ${basename(path)}`);
    return true;
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw new Error(`state ancestor is unavailable: ${basename(path)}`);
  }
}

function regularBytes(path: string, limit: number): Buffer | null {
  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    if (code === "ELOOP") throw new Error(`artifact must be a regular file: ${basename(path)}`);
    throw new Error(`cannot read artifact: ${basename(path)}`);
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error(`artifact is not a bounded regular file: ${basename(path)}`);
    return readFileSync(fd);
  } finally { closeSync(fd); }
}

function regularJson(path: string): { value: Record<string, unknown>; bytes: Buffer } | null {
  const bytes = regularBytes(path, MAX_JSON_BYTES);
  if (!bytes) return null;
  try {
    const value = record(JSON.parse(bytes.toString("utf8")));
    if (!value) throw new Error("not an object");
    return { value, bytes };
  } catch { throw new Error(`artifact is malformed: ${basename(path)}`); }
}

function validWaveState(state: Record<string, unknown>, run: string): boolean {
  return state.schema_version === 1 && state.run === run && typeof state.state === "string" && WAVE_STATES.has(state.state)
    && typeof state.mode === "string" && WAVE_MODES.has(state.mode)
    && (state.selected_provider === null || state.selected_provider === undefined || state.selected_provider === "codex" || state.selected_provider === "claude")
    && (state.provider_override === null || state.provider_override === undefined || state.provider_override === "codex" || state.provider_override === "claude")
    && Array.isArray(state.requested_phase_ids) && state.requested_phase_ids.length <= MAX_PHASES && state.requested_phase_ids.every((id) => typeof id === "string" && id.length <= MAX_STRING)
    && (state.max_phases === null || Number.isInteger(state.max_phases)) && (state.max_runs === null || Number.isInteger(state.max_runs))
    && (state.stop_reason === null || typeof state.stop_reason === "string") && typeof state.started_at === "string" && typeof state.updated_at === "string"
    && Array.isArray(state.waves) && state.waves.length <= MAX_WAVES && state.waves.every((wave) => !Array.isArray(record(wave)?.phase_ids) || (record(wave)?.phase_ids as unknown[]).length <= 128) && Array.isArray(state.phases) && state.phases.length <= MAX_PHASES
    && (state.current === null || record(state.current) !== null);
}

function stateRoot(projectRoot: string): string | null {
  const planning = join(projectRoot, ".planning");
  if (!realDirectory(planning, true)) return null;
  const root = join(planning, "riff-wave");
  return realDirectory(root, true) ? root : null;
}

function verifyPath(projectRoot: string, expected: string, declared: unknown): string | null {
  if (declared !== expected || expected.startsWith("/") || expected.split(/[\\/]/).includes("..")) return null;
  const absolute = join(projectRoot, expected);
  const normalized = relative(projectRoot, absolute);
  return normalized === expected.replaceAll("/", sep) || normalized === expected ? absolute : null;
}

function verificationFor(projectRoot: string, state: Record<string, unknown>, phase: Record<string, unknown>, roadmap: ReturnType<typeof parseRoadmap>): NativeWaveView["verification"][number] | null {
  const verification = record(phase.verification);
  if (!verification) return null;
  const phaseId = string(phase.id);
  const slug = string(phase.slug);
  const run = string(state.run);
  const status = string(verification.status);
  const roadmapPhase = phaseId && slug && PHASE_ID.test(phaseId) && PHASE_SLUG.test(slug) ? roadmap?.phases.find((entry) => String(entry.id) === phaseId && entry.slug === slug) : null;
  const phaseKey = phaseId && slug ? `${phaseId}-${slug}` : null;
  const expectedRequest = run && phaseKey ? `.planning/riff-wave/${run}--${phaseKey}.verification-request.json` : null;
  const expectedReceipt = run && phaseKey ? `.planning/riff-wave/${run}--${phaseKey}.verification-approval.json` : null;
  const base: NativeWaveView["verification"][number] = { phase_id: phaseId, status, reason: string(verification.reason), checks: [], request: null, receipt: null, trust: "invalid" };
  if (!run || !phaseId || !roadmapPhase || !["pending", "approved", "consumed"].includes(status ?? "") || !expectedRequest || !SHA256.test(String(verification.request_sha256))) return base;
  const requestPath = verifyPath(projectRoot, expectedRequest, verification.request_path);
  if (!requestPath) return base;
  try {
    const request = regularJson(requestPath);
    if (!request || digest(request.bytes) !== verification.request_sha256) return base;
    const body = request.value;
    const checks = strings(body.checks);
    const requestValid = body.schema_version === 1 && body.run === run && body.provider === state.selected_provider && body.phase_id === phaseId
      && body.phase_metadata_sha256 === verification.phase_metadata_sha256 && SHA256.test(String(body.phase_metadata_sha256))
      && body.reason === verification.reason && JSON.stringify(checks) === JSON.stringify(strings(verification.checks)) && typeof body.nonce === "string" && body.nonce.length >= 16
      && typeof body.requested_at === "string" && Object.keys(body).sort().join(",") === "checks,nonce,phase_id,phase_metadata_sha256,provider,reason,requested_at,run,schema_version";
    if (!requestValid) return base;
    const exposed = { ...base, checks, request: expectedRequest, trust: "reported" as const };
    if (status === "pending") return exposed;
    const receiptPath = expectedReceipt && verifyPath(projectRoot, expectedReceipt, verification.receipt_path);
    if (!receiptPath || !SHA256.test(String(verification.receipt_sha256))) return base;
    const receipt = regularJson(receiptPath);
    if (!receipt || digest(receipt.bytes) !== verification.receipt_sha256) return base;
    const receiptBody = receipt.value;
    const receiptValid = receiptBody.schema_version === 1 && receiptBody.run === run && receiptBody.provider === state.selected_provider && receiptBody.phase_id === phaseId
      && receiptBody.phase_metadata_sha256 === body.phase_metadata_sha256 && receiptBody.request_sha256 === verification.request_sha256
      && typeof receiptBody.evidence_note === "string" && receiptBody.evidence_sha256 === createHash("sha256").update(receiptBody.evidence_note).digest("hex") && typeof receiptBody.approved_at === "string"
      && Object.keys(receiptBody).sort().join(",") === "approved_at,evidence_note,evidence_sha256,phase_id,phase_metadata_sha256,provider,request_sha256,run,schema_version";
    return receiptValid ? { ...exposed, receipt: expectedReceipt } : base;
  } catch { return base; }
}

function securityFor(projectRoot: string, root: string, state: Record<string, unknown>): NativeWaveView["security"] {
  const run = string(state.run);
  const mechanical = empty().security.mechanical;
  const semantic = empty().security.semantic;
  if (!run) return { mechanical, semantic };
  const mechanicalFile = join(root, `${run}.security.json`); const mechanicalSummary = record(state.final_security);
  try {
    const artifact = regularJson(mechanicalFile);
    if (!artifact) mechanical.trust = "unavailable";
    else if (mechanicalSummary?.artifact === `.planning/riff-wave/${run}.security.json` && mechanicalSummary.artifact_sha256 === digest(artifact.bytes)) { mechanical.verdict = string(artifact.value.verdict); mechanical.artifact = String(mechanicalSummary.artifact); mechanical.artifact_sha256 = String(mechanicalSummary.artifact_sha256); mechanical.trust = "reported"; }
    else mechanical.trust = "invalid";
  } catch { mechanical.trust = "invalid"; }
  const semanticFile = join(root, `${run}.security-review.md`);
  const routingFile = join(root, `${run}.security-review.routing.json`);
  try {
    const text = regularBytes(semanticFile, MAX_TEXT_BYTES); const routing = regularJson(routingFile); const summary = record(state.final_semantic_security);
    if (!text || !routing) semantic.trust = "unavailable";
    else { const route = record(routing.value.route); const linked = summary?.artifact === `.planning/riff-wave/${run}.security-review.md` && summary.artifact_sha256 === digest(text) && routing.value.artifact_sha256 === digest(text) && routing.value.provider === state.selected_provider; if (linked) { semantic.verdict = string(summary.verdict); semantic.artifact = String(summary.artifact); semantic.artifact_sha256 = String(summary.artifact_sha256); semantic.provider = string(summary.provider); semantic.route = route; semantic.trust = "reported"; } else semantic.trust = "invalid"; }
  } catch { semantic.trust = "invalid"; }
  return { mechanical, semantic };
}

function latestNativeStage(projectRoot: string, state: Record<string, unknown>): NativeWaveView["latest_native_stage"] {
  const planning = join(projectRoot, ".planning");
  let nextRoot: string;
  try { if (!realDirectory(planning, true) || !realDirectory(join(planning, "riff-next"), true)) return null; nextRoot = join(planning, "riff-next"); } catch { return { phase: null, state: null, updated_at: null, routing: null, trust: "invalid" }; }
  const phases = Array.isArray(state.phases) ? state.phases : []; const current = record(state.current);
  let selected: string | null = null;
  for (let index = phases.length - 1; index >= 0 && !selected; index--) {
    const phase = record(phases[index]); const attempts = Array.isArray(phase?.attempts) ? phase!.attempts : [];
    const candidate = attempts[attempts.length - 1] && record(attempts[attempts.length - 1]);
    const number = integer(candidate?.attempt); const id = string(phase?.id); const slug = string(phase?.slug);
    if (id && slug && number !== null && PHASE_ID.test(id) && PHASE_SLUG.test(slug)) selected = `${id}-${slug}--${String(state.run).toLowerCase()}-a${number}`;
  }
  if (current?.native_phase && string(current.native_phase) !== selected) return { phase: string(current.native_phase), state: null, updated_at: null, routing: null, trust: "invalid" };
  if (!selected || !NATIVE_ID.test(selected)) return null;
  try {
    const body = regularJson(join(nextRoot, `${selected}.json`));
    if (!body || body.value.schema_version !== 1 || body.value.phase !== selected || !NEXT_STATES.has(String(body.value.state))) return { phase: selected, state: null, updated_at: null, routing: null, trust: "invalid" };
    const routing = regularJson(join(nextRoot, `${selected}.routing.json`)); const hashes = record(body.value.evidence_hashes);
    const routingOk = routing && routing.value.schema_version === 1 && routing.value.phase === selected && routing.value.provider === state.selected_provider && hashes?.routing_receipt === digest(routing.bytes);
    return { phase: selected, state: string(body.value.state), updated_at: string(body.value.updated_at), routing: routingOk ? routing.value : null, trust: routingOk ? "reported" : "invalid" };
  } catch { return { phase: selected, state: null, updated_at: null, routing: null, trust: "invalid" }; }
}

function projectState(projectRoot: string, root: string, state: Record<string, unknown>, source: "active" | "latest"): NativeWaveView {
  const run = String(state.run);
  const view = empty("valid");
  view.source = source; view.run = run; view.mode = string(state.mode); view.state = string(state.state); view.stop_reason = string(state.stop_reason);
  view.provider = string(state.selected_provider); view.provider_override = string(state.provider_override);
  const current = record(state.current);
  view.current = current ? { phase_id: string(current.phase_id), native_phase: string(current.native_phase), attempt: integer(current.attempt) } : null;
  view.recovery = { cap: integer(state.recovery_cycle_cap), profile: string(state.recovery_profile), latest_cycle: null };
  const roadmap = parseRoadmap(projectRoot);
  view.frontiers = (Array.isArray(state.waves) ? state.waves : []).slice(-8).map((item) => {
    const wave = record(item) ?? {}; return { number: integer(wave.number), phase_ids: strings(wave.phase_ids), status: string(wave.status), started_at: string(wave.started_at), completed_at: string(wave.completed_at) };
  });
  view.phase_attempts = (Array.isArray(state.phases) ? state.phases : []).map((item) => {
    const phase = record(item) ?? {}; const rawAttempts = Array.isArray(phase.attempts) ? phase.attempts : [];
    if (rawAttempts.length > MAX_ATTEMPTS) throw new Error("phase attempts exceed parser limit");
    const attempts = rawAttempts.map((a) => {
      const attempt = record(a) ?? {}; const cycle = integer(attempt.recovery_cycle); if (cycle !== null) view.recovery.latest_cycle = Math.max(view.recovery.latest_cycle ?? cycle, cycle);
      return { attempt: integer(attempt.attempt), native_phase: string(attempt.native_phase), status: string(attempt.status), recovery_cycle: cycle, recovery_strategy: string(attempt.recovery_strategy) };
    });
    const verification = verificationFor(projectRoot, state, phase, roadmap); if (verification) view.verification.push(verification);
    return { phase_id: string(phase.id), title: string(phase.title), status: string(phase.status), attempts };
  });
  view.security = securityFor(projectRoot, root, state);
  view.latest_native_stage = latestNativeStage(projectRoot, state);
  return view;
}

/** Parse native wave files without executing commands or mutating the project. */
export function parseNativeWave(projectRoot: string): NativeWaveView {
  let root: string | null;
  try { root = stateRoot(projectRoot); } catch (error) { return empty("invalid", (error as Error).message); }
  if (!root) return empty();
  const activePath = join(root, "active.json");
  let active: { value: Record<string, unknown>; bytes: Buffer } | null;
  try { active = regularJson(activePath); } catch (error) { return empty("invalid", `active pointer invalid: ${(error as Error).message}`); }
  if (active) {
    const keys = Object.keys(active.value);
    const run = string(active.value.run);
    if (keys.length !== 1 || !run || !RUN_ID.test(run)) return empty("invalid", "active pointer invalid");
    try {
      const state = regularJson(join(root, `${run}.json`));
      if (!state || !validWaveState(state.value, run)) return empty("invalid", "active state invalid");
      return projectState(projectRoot, root, state.value, "active");
    } catch (error) { return empty("invalid", `active state invalid: ${(error as Error).message}`); }
  }
  const candidates: Array<{ run: string; mtime: number }> = [];
  try {
    const directory = opendirSync(root);
    let count = 0; let entry;
    while ((entry = directory.readSync()) !== null) {
      if (++count > MAX_ENTRIES) { directory.closeSync(); return empty("invalid", "wave state directory exceeds parser limit"); }
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "active.json") continue;
      const run = entry.name.slice(0, -5); if (!RUN_ID.test(run)) continue;
      candidates.push({ run, mtime: lstatSync(join(root, entry.name)).mtimeMs });
    }
    directory.closeSync();
  } catch (error) { return empty("invalid", `cannot enumerate wave state: ${(error as Error).message}`); }
  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const candidate of candidates) {
    try {
      const state = regularJson(join(root, `${candidate.run}.json`));
      if (state && validWaveState(state.value, candidate.run)) return projectState(projectRoot, root, state.value, "latest");
    } catch { /* malformed historical file is not a valid fallback */ }
  }
  return empty();
}

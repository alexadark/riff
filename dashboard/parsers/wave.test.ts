import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { parseNativeWave } from "./wave.ts";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "riff-dashboard-wave-"));
  mkdirSync(join(root, ".planning", "riff-wave"), { recursive: true });
  writeFileSync(join(root, "ROADMAP.yaml"), "name: Test\nphases:\n  - id: 1\n    slug: check\n    title: Check\n    status: todo\n    priority: P1\n");
  return root;
}
function state(run = "W-test", extra: Record<string, unknown> = {}) {
  const native = `1-check--${run.toLowerCase()}-a1`;
  return { schema_version: 1, run, state: "running", mode: "loop", provider_override: null, selected_provider: "codex", requested_phase_ids: [], max_phases: null, max_runs: null, waves: [{ number: 1, phase_ids: ["1"], status: "running", started_at: "2026-01-01T00:00:00Z" }], phases: [{ id: "1", slug: "check", title: "Check", status: "running", attempts: [{ attempt: 1, native_phase: native, status: "running", recovery_cycle: 0 }] }], current: { phase_id: "1", native_phase: native, attempt: 1 }, stop_reason: null, started_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...extra };
}
function writeJson(path: string, value: unknown) { const text = `${JSON.stringify(value)}\n`; writeFileSync(path, text); return text; }

test("reads an active running native wave", () => {
  const root = fixture(); const run = "W-running";
  writeJson(join(root, ".planning/riff-wave/active.json"), { run });
  writeJson(join(root, `.planning/riff-wave/${run}.json`), state(run));
  const view = parseNativeWave(root);
  expect(view).toMatchObject({ status: "valid", source: "active", run, state: "running", provider: "codex", current: { native_phase: `1-check--${run.toLowerCase()}-a1` } });
  expect(view.frontiers).toHaveLength(1);
});

test("falls back to a completed valid state when no active pointer exists", () => {
  const root = fixture(); const run = "W-completed";
  writeJson(join(root, `.planning/riff-wave/${run}.json`), state(run, { state: "completed", stop_reason: "roadmap_dry" }));
  expect(parseNativeWave(root)).toMatchObject({ status: "valid", source: "latest", run, state: "completed" });
});

test("exposes invalid active pointers and state instead of falling back", () => {
  const root = fixture();
  writeJson(join(root, ".planning/riff-wave/active.json"), { run: "../escape" });
  expect(parseNativeWave(root)).toMatchObject({ status: "invalid" });
  writeJson(join(root, ".planning/riff-wave/active.json"), { run: "W-bad" });
  writeJson(join(root, ".planning/riff-wave/W-bad.json"), { run: "W-other" });
  expect(parseNativeWave(root)).toMatchObject({ status: "invalid" });
});

test("rejects symlinked and oversized active artifacts", () => {
  const root = fixture();
  symlinkSync("/dev/null", join(root, ".planning/riff-wave/active.json"));
  expect(parseNativeWave(root)).toMatchObject({ status: "invalid" });
  const huge = fixture();
  writeFileSync(join(huge, ".planning/riff-wave/active.json"), " ".repeat(1024 * 1024 + 1));
  expect(parseNativeWave(huge)).toMatchObject({ status: "invalid" });
  const malformed = fixture();
  writeFileSync(join(malformed, ".planning/riff-wave/active.json"), "{not json\n");
  expect(parseNativeWave(malformed)).toMatchObject({ status: "invalid" });
  const symlinkRoot = mkdtempSync(join(tmpdir(), "riff-dashboard-wave-root-"));
  mkdirSync(join(symlinkRoot, ".planning"));
  symlinkSync("/tmp", join(symlinkRoot, ".planning/riff-wave"));
  expect(parseNativeWave(symlinkRoot)).toMatchObject({ status: "invalid" });
});

test("only exposes verification details after request and receipt validation", () => {
  const root = fixture(); const run = "W-verify"; const requestPath = `.planning/riff-wave/${run}--1-check.verification-request.json`; const receiptPath = `.planning/riff-wave/${run}--1-check.verification-approval.json`;
  const request = { schema_version: 1, run, provider: "codex", phase_id: "1", phase_metadata_sha256: "a".repeat(64), reason: "manual", checks: ["Inspect the result"], nonce: "0123456789abcdef", requested_at: "2026-01-01T00:00:00Z" };
  const requestText = writeJson(join(root, requestPath), request);
  const evidence_note = "Checked: visible control; Observed: saved result remains; Expected: saved result is visible";
  const receipt = { schema_version: 1, run, provider: "codex", phase_id: "1", phase_metadata_sha256: request.phase_metadata_sha256, request_sha256: sha(requestText), evidence_note, evidence_sha256: sha(evidence_note), approved_at: "2026-01-01T00:01:00Z" };
  const receiptText = writeJson(join(root, receiptPath), receipt);
  const wave = state(run, { state: "awaiting_human" });
  (wave.phases as any)[0].verification = { status: "pending", reason: "manual", checks: request.checks, phase_metadata_sha256: request.phase_metadata_sha256, request_path: requestPath, request_sha256: sha(requestText) };
  writeJson(join(root, ".planning/riff-wave/active.json"), { run }); writeJson(join(root, `.planning/riff-wave/${run}.json`), wave);
  const verification = parseNativeWave(root).verification[0];
  expect(verification).toMatchObject({ trust: "reported", request: requestPath, receipt: null });
  (wave.phases as any)[0].verification = { ...((wave.phases as any)[0].verification), status: "approved", receipt_path: receiptPath, receipt_sha256: sha(receiptText) };
  writeJson(join(root, `.planning/riff-wave/${run}.json`), wave);
  expect(parseNativeWave(root).verification[0]).toMatchObject({ trust: "reported", receipt: receiptPath });
  writeFileSync(join(root, receiptPath), "{}\n");
  expect(parseNativeWave(root).verification[0]).toMatchObject({ trust: "invalid", checks: [] });
});

test("marks stale request paths invalid without exposing their paths", () => {
  const root = fixture(); const run = "W-safe"; const requestPath = `.planning/riff-wave/${run}--1-check.verification-request.json`;
  const request = { schema_version: 1, run, provider: "codex", phase_id: "1", phase_metadata_sha256: "a".repeat(64), reason: "manual", checks: ["Inspect the result"], nonce: "0123456789abcdef", requested_at: "2026-01-01T00:00:00Z" };
  const requestText = writeJson(join(root, requestPath), request); const wave = state(run, { state: "awaiting_human" });
  (wave.phases as any)[0] = { ...(wave.phases as any)[0], id: "1;touch-pwned", verification: { status: "pending", reason: "manual", checks: request.checks, phase_metadata_sha256: request.phase_metadata_sha256, request_path: requestPath, request_sha256: sha(requestText) } };
  writeJson(join(root, ".planning/riff-wave/active.json"), { run }); writeJson(join(root, `.planning/riff-wave/${run}.json`), wave);
  expect(parseNativeWave(root).verification[0]).toMatchObject({ trust: "invalid", request: null });
});

test("rejects capped wave collections instead of partially rendering them", () => {
  const root = fixture(); const run = "W-capped";
  writeJson(join(root, ".planning/riff-wave/active.json"), { run });
  writeJson(join(root, `.planning/riff-wave/${run}.json`), state(run, { phases: Array.from({ length: 129 }, () => ({ id: "1", slug: "check", attempts: [] })) }));
  expect(parseNativeWave(root)).toMatchObject({ status: "invalid" });
});

test("surfaces runner-bound security and selected native stage routing", () => {
  const root = fixture(); const run = "W-security"; const input = "a".repeat(64); const nonce = "security-nonce";
  const mechanical = { schema_version: 1, run, timing: "after_product_phases", changed_paths: [], input_sha256: input, final_security_nonce: nonce, verdict: "PASS", findings: [], completed_at: "2026-01-01T00:00:00Z" };
  const mechanicalText = writeJson(join(root, `.planning/riff-wave/${run}.security.json`), mechanical);
  const semanticAttempt: Record<string, unknown> = { status: "completed", started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z", input_sha256: input, mechanical_artifact_sha256: sha(mechanicalText), nonce: "semantic-nonce", provider: "codex", route: "security-reviewer:fixed" };
  const marker = { run, input_sha256: input, mechanical_artifact_sha256: sha(mechanicalText), mechanical_verdict: "PASS", provider: "codex", nonce: "semantic-nonce" };
  const semanticText = `---\nphase: ${run}\ngenerated_at: 2026-01-01T00:00:00Z\nverdict: PASS\n---\n## Verdict\nPASS\n## Resolved Findings\nNone.\n## Notes\nNone.\n\n<!-- RIFF machine evidence: ${JSON.stringify(marker)} -->\n`;
  writeFileSync(join(root, `.planning/riff-wave/${run}.security-review.md`), semanticText);
  semanticAttempt.artifact_sha256 = sha(semanticText);
  const route = { provider: "codex", semanticRole: "security-reviewer", routeClass: "fixed", adapter: "codex", model: "gpt", effort: "medium" };
  writeJson(join(root, `.planning/riff-wave/${run}.security-review.routing.json`), { schema_version: 1, provider: "codex", route, input_sha256: input, mechanical_artifact_sha256: sha(mechanicalText), nonce: "semantic-nonce", artifact_sha256: sha(semanticText) });
  mkdirSync(join(root, ".planning/riff-next"));
  const native = `1-check--${run.toLowerCase()}-a1`;
  const routingText = writeJson(join(root, `.planning/riff-next/${native}.routing.json`), { schema_version: 1, phase: native, provider: "codex", status: "routes_resolved" });
  writeJson(join(root, `.planning/riff-next/${native}.json`), { schema_version: 1, phase: native, state: "completed", updated_at: "2026-01-01T00:00:00Z", evidence_hashes: { routing_receipt: sha(routingText) } });
  const wave = state(run, { state: "completed", final_security_attempt: { status: "completed", started_at: "2026-01-01T00:00:00Z", completed_at: "2026-01-01T00:01:00Z", input_sha256: input, nonce, artifact_sha256: sha(mechanicalText) }, final_security: { verdict: "PASS", artifact: `.planning/riff-wave/${run}.security.json`, blocking_findings: 0, input_sha256: input, artifact_sha256: sha(mechanicalText) }, final_semantic_security_attempt: semanticAttempt, final_semantic_security: { verdict: "PASS", artifact: `.planning/riff-wave/${run}.security-review.md`, artifact_sha256: sha(semanticText), provider: "codex", adapter: "codex", model: "gpt", effort: "medium" } });
  writeJson(join(root, ".planning/riff-wave/active.json"), { run }); writeJson(join(root, `.planning/riff-wave/${run}.json`), wave);
  const view = parseNativeWave(root);
  expect(view.security.mechanical).toMatchObject({ trust: "reported", verdict: "PASS" });
  expect(view.security.semantic).toMatchObject({ trust: "reported", provider: "codex" });
  expect(view.latest_native_stage).toMatchObject({ trust: "reported", phase: native, state: "completed", routing: { provider: "codex" } });
  writeJson(join(root, `.planning/riff-wave/${run}.security-review.routing.json`), { schema_version: 1 });
  expect(parseNativeWave(root).security.semantic).toMatchObject({ trust: "invalid", verdict: null });
});

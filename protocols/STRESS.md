# STRESS Protocol

Adversarial + load testing for a RIFF app. Answers two questions: **how does it get attacked** and **does it hold under many users**. Static analysis always runs (AFK, no app needed). When a running target is supplied, real attacks and a real load test run on top.

This is distinct from `security-reviewer` (static, diff-scoped, auto-runs every phase). Stress is on-demand, whole-app, and *active* — it sends real payloads and real traffic at a running instance.

Invoked by `/riff:stress`. Read this file in full, then run the flow.

## Inputs

```
/riff:stress [--target <url>] [--security|--scale] [--users <N>] [--seed]
```

- `--target <url>` — running instance to attack/load. Omitted → static-only.
- `--security` / `--scale` — run only that half. Both omitted → both run.
- `--users <N>` — peak concurrent virtual users for the load ramp (default `500`).
- `--seed` — after the report, seed each prioritized fix as a roadmap phase (R4). Default: list fixes, do not seed.

## Model & effort dispatch

The two stress sub-agents are dispatched by `subagent_type` (`red-teamer`, `load-tester`), so their `effort:` frontmatter is the real depth lever; a `model:` override on the call still applies. The inline parent uses session effort + `ultrathink`. Codex steps use `--effort`. Keywords are inert on Opus 4.8 / Claude 4.x. Full rationale: `protocols/MODEL.md` § Effort.

| Phase / agent | Dispatch | Model | Effort |
| --- | --- | --- | --- |
| Phase 0/1 — recon, routing, boot | Inline (parent) | **Reasoning model** (Opus, forced via command frontmatter) | session (`high`); light routing |
| Phase 2 — static security (whole-codebase) | `subagent_type: security-reviewer` | **Sonnet** | `high` (frontmatter) |
| Phase 2 — static scale | `subagent_type: load-tester` | **Sonnet** | `medium` (frontmatter) |
| Phase 3 — `red-teamer` ×5 (auth, injection, idor, ratelimit, config) | `subagent_type: red-teamer` (parallel) | **Sonnet** | `high` (frontmatter); one agent per class |
| Phase 3 — load test, active | `subagent_type: load-tester` | **Sonnet** | `medium` (frontmatter) |
| Phase 3.5 — adversarial verify of CRITICAL/HIGH | `codex:codex-rescue` | **Codex `gpt-5.5`** | `high` (`--effort`) |
| Phase 4 — synthesis + "needs specialist" judgment | Inline (parent) | **Reasoning model** (Opus) | session (`high`); `ultrathink` if the finding set is large/conflicting |

The parent runs at the Opus session default (`high`). Real depth on the attack and verify work comes from the **two-model design** (Sonnet attacks, Codex refutes) plus the agents' frontmatter effort. The load generation (`stress-load.mjs` / autocannon) is a script, not a model call.

Budget shifts:
- **`frugal`** — static scale and the `ratelimit`/`config` red-team classes run on **Haiku** (`model` override). Security-critical classes (`auth`, `injection`, `idor`) stay **Sonnet** at `effort: high`. Phase 3.5 Codex verify is **off**.
- **`max`** — the `auth`, `injection`, `idor` classes run on the **reasoning model (Opus)** (`model` override) at `effort: high`; Phase 3.5 Codex verify runs on **every** active finding, not just CRITICAL/HIGH.

### Why this shape

- **Red team = Sonnet, not Codex.** Five classes fan out in parallel with tight curl/inspect loops. Parallel Sonnet sub-agents are the natural fit; five Codex sessions add orchestration overhead for no gain. More depth on the riskiest classes → override their `model` to Opus (the `max` shift).
- **Adversarial verify = Codex.** Mirrors RIFF Step 6 (post-build adversarial = Codex). An independent model that did not craft the exploit refutes it — kills false positives, confirms exploitability, sanity-checks the breaking-point conclusion. A finding that survives both the Sonnet attacker and the Codex skeptic is real.
- **Parent synthesizes in Phase 4.** Integrating findings across 5+ agents, prioritizing fixes, and deciding escalation is multi-step reasoning — it runs at the parent's `high` session effort, `ultrathink` when the set is large.

## Phase 0 — Scope, target, safety gate

1. Read `.planning/config.json`. If `scope: scratch`, warn once: *"scratch scope — load/attack testing a local script has limited value; running anyway because you invoked it explicitly."* Continue (the user asked).
2. Read `profile.yaml` (resolved per `references/PROFILE-RESOLUTION.md`) for length, explanation level, persona.
3. **Classify the target. This gate is non-negotiable.**

   | Target host | Action |
   | --- | --- |
   | `localhost`, `127.0.0.1`, `0.0.0.0`, `::1`, `*.localhost`, `*.test`, `*.local` | Allowed. Active pass proceeds. |
   | Any other host (a real domain, an IP) | **STOP.** Show the URL and ask the user to type-confirm it is a staging/test environment they own and are authorized to attack. Only then set `STRESS_ALLOW_REMOTE=<url>` for the run. |
   | Host matches `prod`, `www`, the project's known production domain | **REFUSE** active testing. Static only. Active load + injection against production is an outage and possibly a crime. No override in-band. |

   No target supplied → skip the gate, static-only.
4. If `--target` is local but nothing is listening, try to boot the app: read `package.json` scripts for `dev`/`start`, spawn it in the background, wait for the port, tear it down at the end. If boot fails, fall back to static-only and note it in the report.

## Phase 1 — Recon (static, always)

Build the map both later passes consume. Read the code, do not guess.

- **Attack surface**: enumerate every route/endpoint (API handlers, server actions, loaders/actions, form posts). For each: method, path, auth-required?, input shape, what data it touches.
- **Scale-sensitive surface**: list endpoints that (a) return collections, (b) run DB queries, (c) do heavy/sync work, (d) call third parties in the request path.
- **Auth model**: how a request proves identity (session cookie, JWT, header). Needed to craft authenticated attacks and IDOR pairs.
- **Test identities**: find two distinct low-privilege accounts (from `.env.test`, a seed script, or fixtures). Need two to prove cross-tenant IDOR. If none exist and a target is set, ask the user for two test logins once. None available → IDOR runs static-only.

Write the map to `.planning/stress/.recon.json` (endpoints, scale-surface, auth model). Both passes read it.

## Phase 2 — Static pass (always)

Two halves, run as parallel agents (dispatch + effort per § Model & effort dispatch).

**Security (static).** Spawn `subagent_type: security-reviewer` scoped to the **whole codebase** (not the diff) — pass "scope: full tree, not the branch diff" in the context. OWASP + the project-specific and tenant-isolation checks live in its spec. Output feeds the report's Security section.

**Scalability (static).** Spawn `subagent_type: load-tester` in static mode. It scans for the bottlenecks code review can see without traffic:

- N+1 queries (query inside a loop / per-row fetch).
- List endpoints with no pagination or no `LIMIT` → unbounded result sets.
- Filtered/sorted columns with no DB index.
- Heavy synchronous work in the request path (crypto, image processing, large JSON) with no queue/background job.
- In-memory state (counters, caches, sessions, rate-limit buckets) that breaks the moment you run two instances — blocks horizontal scaling.
- Missing or undersized DB connection pool; connection-per-request.
- No caching on hot read paths; no rate limiting on expensive or auth endpoints.

## Phase 3 — Active pass (only with an allowed target)

**Red team — parallel, one agent per attack class.** Spawn `subagent_type: red-teamer` N times concurrently, each pinned to one class, each given `.recon.json`, the target, and the test identities. Effort is `high` (frontmatter); model is Sonnet, overridden to Opus on auth/injection/idor at `max` budget (see § Model & effort dispatch):

1. **Auth & session** — missing auth on routes, broken access control, weak/forgeable session or JWT, password-reset and account-recovery flaws, missing logout invalidation.
2. **Injection** — SQLi, NoSQLi, command injection, XSS (reflected/stored), SSTI, path traversal. Fire real payloads at the discovered inputs; confirm by response behavior, not just presence.
3. **IDOR / authorization** — log in as account A, enumerate/guess resource IDs, attempt to read or mutate account B's data. Cross-tenant access = CRITICAL.
4. **Rate limit / DoS surface** — hammer auth, search, and expensive endpoints; check for rate limiting, lockout, and whether one client can degrade the service.
5. **Config & exposure** — security headers (CSP, HSTS, X-Frame-Options), CORS misconfig, exposed `.env`/source maps/`.git`, verbose error pages leaking stack traces or SQL, default credentials, open debug endpoints.

Each agent sends real requests via Bash (curl/fetch), confirms exploitability, and writes findings in the greppable `### [SEVERITY] Title` format. Only the approved target. No payload that destroys data without an explicit, reversible scope.

**Load test — `load-tester` agent, active mode.** Runs `.riff/scripts/stress-load.mjs` against the target's key endpoints, ramping concurrency (default `10,50,100,200,500`, capped at `--users`). Per level it captures p50/p95/p99 latency, throughput (req/s), and error rate, then finds the **breaking point** — the first level where error rate climbs past 1%, p99 blows past 3× the baseline, or throughput stops scaling. Reports "holds to X concurrent / Y req/s, degrades at Z, because <bottleneck>".

## Phase 3.5 — Adversarial verify (Codex)

Independent refutation of the active findings before they reach the report. Budget-gated: `balanced` → run on CRITICAL/HIGH only; `frugal` → skip; `max` → run on every active finding.

Spawn `codex:codex-rescue` (`gpt-5.5`, `high` effort) with the finding, its proof (request + response), and the target. Task: **try to refute it**. For each finding it returns `confirmed | false-positive | needs-more-proof` with a one-line reason. Also hand it the load-test breaking point to sanity-check the bottleneck attribution.

- `false-positive` → drop the finding from the report (log it under Notes as "refuted by adversarial pass").
- `needs-more-proof` → the original red-teamer agent re-attempts once with the skeptic's note; still unproven → demote to a static observation.
- `confirmed` → keep at its severity.

If the Codex skill is missing or errors: log a one-line warning, keep the unverified findings, mark them `unverified` in the report. Never block on Codex.

## Phase 4 — Synthesize the report

Write `.planning/stress/YYYY-MM-DD-stress.md` from `templates/STRESS.md`. One artifact, both halves.

- **Verdict** (frontmatter, greppable): `PASS | PASS-WITH-WARNINGS | BLOCKED`. `BLOCKED` if any CRITICAL/HIGH security finding OR the app breaks below the `--users` target.
- **Security findings** — by severity, each with location, proof (the request + the response that proves it), and fix.
- **Scalability** — the load curve table, the breaking point, the limiting bottleneck, and the static findings.
- **Top fixes** — prioritized, security and scale interleaved by impact. Tag each `[agent]` (the coding agent fixes it AFK) or `[needs: <role>]`.
- **Human escalation** — set `needs_specialist` in frontmatter. List every item the agent should NOT own alone and the specialist it needs: security engineer (crypto, auth/session protocol design), DBA (index/partition plans tied to real data volume), SRE/infra (horizontal scaling, pool sizing, capacity against real prod infra), compliance/legal (tenant isolation, PII, anything whose correctness lives in a contract not the code), payments (money movement). Default a fix to `[agent]`; escalate only when a wrong fix silently reopens a hole, depends on real prod data/infra, or crosses a legal boundary.
- **Coverage notes** — what was static-only, what was skipped (no target, no test accounts, boot failed). Never imply coverage you did not run.

Keep the returned terminal summary to the verdict, the breaking point, the count of CRITICAL/HIGH findings, and whether a specialist is needed. The detail lives in the artifact.

## Seeding fixes

`--seed` set → for each CRITICAL/HIGH finding and each load fix, append a phase via `commands/add-phase.md` conventions (`depends_on` where ordering matters). No `--seed` → list the fixes and ask whether to seed. Never silently build fixes (R4: seed, do not build).

## Anti-patterns

- Active testing against anything not type-confirmed local or staging. Never production.
- Reporting a vuln from code reading alone as "exploited" — active findings need a real request/response proof.
- Calling parallel agents a load test. Agents divide the *analysis*; load is generated by autocannon.
- Destructive payloads (DROP, mass DELETE, resource exhaustion that doesn't self-recover) without explicit reversible scope.
- Padding the report with theory. One finding, one proof, one fix.

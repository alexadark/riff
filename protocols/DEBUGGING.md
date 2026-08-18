# DEBUGGING

Bug-diagnosis discipline read by the debugger adapter during triage and hypothesis formation. Two modes are gated by one triage call. Misapplying a mode hurts more than skipping this file; see "Origin" below.

---

## Triage: pick the mode

Classify the failure signature before forming any hypothesis.

| Signature | Markers | Mode |
| --- | --- | --- |
| Context-dependent | Works in one environment, fails in another (local vs deployed, CI vs prod); worked before, broke without a code change; touches external services, webhooks, long-running pipelines; touches bundled tools/binaries | **FULL** — Layer sweep and Environment parity, both mandatory |
| Context-free | Deterministic wrong behavior, same everywhere, reproducible from code + inputs alone | **LIGHT** — skip Layer sweep and Environment parity; go signature → discriminator → fix → detection. Default suspect is application logic itself — don't manufacture exotic causes the evidence doesn't demand |

State the chosen mode and the one-sentence reason before proceeding. **When in doubt: FULL.** A LIGHT diagnosis run on a context-dependent bug will chase in-code causes that can't explain the discriminator; a FULL sweep run on a context-free bug burns steps proving layers that were never in play.

---

## Failure signature first

Restate the observable facts as a precise signature — what's intact, what's damaged, what the numbers imply — before naming a single cause. Use the signature to rule out entire failure classes up front (e.g. "the data survived, so the damage is in presentation/assembly, not acquisition").

---

## Layer sweep (FULL mode only)

Propose at least one candidate cause in EACH layer before ranking anything:

- application logic (the code itself)
- data/inputs (malformed, partial, racy upstream data)
- dependencies (libraries, bundled tools — versions, platform builds)
- environment (deployed runtime vs local: OS, binaries, env vars, filesystem)
- external services (upstream API behavior, timing, guarantees)

**Hard rule:** a FULL-mode diagnosis that never leaves the application-logic layer is incomplete by definition. The context-dependence identified in Triage means something OUTSIDE the code differs — the top-ranked cause must account for it.

---

## Discriminator accounting

Identify the discriminator: the single fact that separates working from broken (works locally / fails deployed; works at small scale / fails at scale; worked yesterday / broken today). Every ranked hypothesis MUST explain every observation, and the discriminator carries the most weight. For each hypothesis, state in falsifiable terms why it outranks or underranks its neighbors ("if X were the cause, we'd also see Y, and we don't").

---

## Environment parity list (FULL mode only)

Enumerate what differs between the context where it works and the context where it fails: tool/dependency versions, platform builds, env vars, data sources, timing. The root cause of "works here, breaks there" lives in this list more often than in the code.

---

## Evidence-gated fix

Order: observe → instrument → measure → contain → root-fix. Each step names the signal that confirms or rejects it before advancing — never jump straight to a rewrite.

**Hard rule:** the fix MUST act on the top-ranked cause from § Discriminator accounting. Diagnosing one cause and fixing another is the most common failure mode of an otherwise-good diagnosis.

---

## Detection + scope fence

Any guard added must detect the ACTUAL pathology from § Failure signature first — not a convenient proxy that can pass while the bug persists. Close by stating explicitly what was deliberately left unchanged, and why.

---

## Origin

Distilled 2026-07-12 from model-bench replay evals of real bugs across the operator's three apps. Branch-validated, not theoretical: the FULL branch improved results on an environment-layer bug, while the LIGHT branch improved results on an in-code bug. Misapplied branches hurt, which is why [Triage: pick the mode](#triage-pick-the-mode) is a hard gate rather than a suggestion.

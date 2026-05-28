# Decisions

Durable framework decisions. Protocols may reference these IDs when the rationale matters.

## D25 — Keep Auto-Gates Heuristic and Explicit

`AUTO-TRIGGERS.md` owns path/tag/text heuristics for optional gates. Commands reference those anchors instead of duplicating trigger logic inline.

## D26 — Prefer Mechanical Gates When They Are Good Enough

Deterministic checks such as `scope-check.mjs`, `fallow`, typecheck, tests, and staged-file security scans should run before LLM review. LLM agents are reserved for judgment-heavy review and debugging.

## D27 — Codex Is the Default Executor Runtime, Not an Installed Project Adapter

RIFF installs Claude Code runtime files into projects. Codex execution happens through the configured skill/CLI path and writes normal RIFF artifacts; no `.codex/`, CommandCode, or adapter harness is installed by `riff init`.

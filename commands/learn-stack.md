---
description: Research a language or framework's best practices from multiple sources and synthesize a taste/stacks/<stack>.md rule file
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, AskUserQuestion
args: "[stack] [focus]"
---

# /riff:learn-stack

Build a stack-specific taste file for RIFF by cross-referencing authoritative sources. Output: `references/taste/stacks/<stack>.md`. Consensus filter: a rule only ships if it appears in ≥2 independent sources (exception: official API guidelines from the language maintainers count alone, marked `[official]`).

## Inputs

- `stack` (required): language or framework (e.g. `rust`, `go`, `elixir`, `phoenix`, `fastapi`).
- `focus` (optional): narrows scope to avoid generic bloat.
  - Languages: `cli`, `web-server`, `tui`, `async-service`, `systems`, `wasm`.
  - Frameworks: usually inferred from the framework itself.

If args missing, ask with AskUserQuestion.

## What you do

1. **Scope.** Confirm `stack` + `focus`. If `references/taste/stacks/<stack>.md` already exists, ask: replace, merge, or skip.

2. **Gather sources** (4-6 target, 3 minimum). Mix three categories:
   - **Official guidelines** (1-2): language API guidelines, official book/docs. Prefer Context7 MCP for library docs (`resolve-library-id` then `query-docs`); fall back to WebFetch for language guidelines.
   - **Community-consensus books** (1-2): books that appear across multiple "best X book" lists. Extract from summaries, ToCs, and publicly available excerpts only. Paraphrase, never quote.
   - **Production repos** (2-3): mature, idiomatic OSS projects cited as community references (not just popular). Use `gh` CLI to browse key files.

   Present the source shortlist to the user and confirm before proceeding.

3. **Extract rules per source.** Produce a bullet list of concrete, actionable rules tagged with a source slug. Examples:
   - `[rust-api-guidelines]` "Types eagerly implement common traits (Debug, Clone, Default) where sensible."
   - `[ripgrep]` "CLI args declared via `clap` derive macros; no manual parsing."
   - Reject fluffy rules ("write clean code", "keep functions small") — they're not testable.

4. **Consensus filter.** Merge all rule lists. Keep a rule only if it appears in ≥2 sources (exact or semantic match). Reject single-source rules unless they come from the official guidelines (promote to Core Rules with `[official]` tag). Discard everything else.

5. **Synthesize the taste file.** Write `references/taste/stacks/<stack>.md`:

   ```markdown
   ---
   description: <stack> idiomatic conventions and anti-pattern rules
   paths:
     - "**/*.<ext>"
     - "**/<manifest>"
   ---

   # Taste Reference - <stack>

   > Source: consensus from <N> sources: <short list>.
   > Apply when stack includes <stack>. Read this file on every task touching <stack> files.
   > For API details beyond these rules, use Context7 MCP.

   ## Core Rules (always)

   <numbered consensus rules>

   ## <Theme sections>

   <grouped rules with short code examples>

   ## Gotchas

   <stack-specific traps>

   ## Anti-Pattern Checklist

   | Found | Replace with |
   | ----- | ------------ |

   ## Sources

   - <name> (<type>): <url or ref>
   ```

   Determine `paths:` from the stack: Rust → `**/*.rs`, `**/Cargo.toml`. Go → `**/*.go`, `**/go.mod`. Python → `**/*.py`, `**/pyproject.toml`. Elixir → `**/*.{ex,exs}`, `**/mix.exs`. If unclear, ask.

6. **Update the index.** Append a row to `references/taste/stacks/INDEX.md` with the new file and its "Read when..." trigger.

7. **Report.** Show: stack file path, source list, rule count, and a 3-line preview of Core Rules.

## Rules

- **Consensus filter is non-negotiable.** Single-source rules are opinions; multi-source rules are conventions. Official maintainer guidelines are the sole exception.
- **No fabricated URLs.** If unsure of a source URL, use WebSearch first. Never guess.
- **No copyrighted excerpts.** Paraphrase book content; never paste quotes.
- **English only** in the output file.
- **Concrete rules only.** Every rule must be actionable: "prefer X over Y", "use Z when W", "reject pattern P". Vague advice is cut.
- **Narrow with `focus`.** Unfiltered language scopes produce 500-line files that dilute signal. A focused file beats a comprehensive one.
- **No emojis** in the output file.

## Tips

- Typical runtime: 3-8 minutes depending on source count.
- Re-run when the stack has a major version bump (Rust edition change, Phoenix major, Python minor with new syntax).
- The generated file is a v1. After building 1-2 real projects in the stack, the gotchas you hit become the most valuable additions — update the file then.
- If the stack is too niche for multi-source consensus (fewer than 2 production repos findable), fall back to 1 official doc + 1 repo and mark the file `status: provisional` at the top of the description.

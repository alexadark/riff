---
name: learn-stack
description: >-
  Research explicit language or framework stack-convention requests and
  synthesize a confirmed, source-backed taste file in the invoking project. Use
  only for explicit requests such as "$learn-stack rust cli" or
  "$riff:learn-stack fastapi"; do not trigger for ordinary framework questions
  or incidental mentions.
---

# RIFF Learn Stack

Research a named language or framework and record a focused, source-backed taste
reference in the invoking project. Run this workflow only for an explicit
stack-convention request. Do not use it to answer a normal implementation
question or to react to an incidental mention of a stack.

## Inputs and boundaries

- `stack` is required. Use a lowercase, hyphenated slug such as `rust`, `go`,
  `phoenix`, or `fastapi`.
- `focus` is optional and narrows the research, for example `cli`, `tui`,
  `web-server`, or `async-service`.
- If either the stack is missing or the focus is genuinely ambiguous, ask the
  user before researching.
- Reject slugs containing path separators, `..`, or other path traversal input.
- Resolve the invoking consumer's project root. Write only under that project,
  never under the RIFF framework repository or another consumer.
- The output path is
  `<project-root>/references/taste/stacks/<stack>.md`. The index is
  `<project-root>/references/taste/stacks/INDEX.md`.

## Procedure

1. Confirm the stack and optional focus. If the target taste file already
   exists, ask whether to `replace`, `merge`, or `skip`; do not modify it until
   the choice is explicit. A `skip` choice ends the workflow.
2. Discover a shortlist before doing detailed extraction. Target 4-6 sources,
   with at least 3 usable sources, and mix:
   - official maintainer guidance or official documentation;
   - community references such as established books or conference material;
   - mature production repositories with idiomatic, inspectable code.
3. Use the invoking runtime's available web, documentation, and repository
   research capability. Verify every URL or repository reference before showing
   it. Never guess or fabricate a URL. For books and other copyrighted works,
   use public summaries, tables of contents, and brief excerpts only.
4. Present the shortlist with each source's name, category, verified URL or
   repository path, and reason for inclusion. Wait for explicit confirmation
   before detailed research or writing.
5. After confirmation, extract concrete, actionable rules from each source and
   tag every note with a stable source slug. Paraphrase copyrighted material;
   do not paste long quotations. Reject vague advice that cannot guide a code
   or review decision.
6. Apply the consensus filter. Keep a rule only when it appears in at least two
   independent sources, allowing semantic matches. An official maintainer rule
   may stand alone only when marked `[official]`. Discard unsupported rules.
   Stop and report insufficient evidence instead of filling gaps with opinion.
7. Determine the narrowest useful `paths` frontmatter for the stack. Include
   source and manifest globs, such as `**/*.rs` and `**/Cargo.toml`; ask if the
   correct file patterns cannot be established.
8. Write the English taste file with this structure:

   ```markdown
   ---
   description: <stack> idiomatic conventions and anti-pattern rules
   paths:
     - "<source glob>"
     - "<manifest glob>"
   ---

   # Taste Reference - <stack>

   > Source: consensus from <N> sources: <short list>.
   > Apply when stack includes <stack>.

   ## Core Rules (always)

   ## <Theme sections>

   ## Gotchas

   ## Anti-Pattern Checklist

   | Found | Replace with |
   | ----- | ------------ |

   ## Sources
   ```

   Keep rules specific, concise, and tied to the selected focus. Include the
   verified source links or repository references in `Sources`.
9. Update `INDEX.md` in the invoking project with one row containing the new
   file and a precise “Read when...” trigger. Preserve existing rows and
   formatting. Never update the RIFF framework's index for a consumer's stack.
10. Report the output path, source list, retained rule count, and a short
    preview of the Core Rules. State whether the file was replaced or merged.

Do not modify product code, create commits, push, merge, deploy, or publish
anything automatically. The research shortlist confirmation is the required
human boundary; evidence insufficiency is a stop condition.

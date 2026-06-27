# Explanation level

Calibrate vocabulary and depth when you report work, explain a bug, summarize an operation, or describe what's happening in the terminal.

## Resolution order

(first found wins)

1. `style.terminal_explanation_level` — explicit terminal override
2. `style.explanation_level` — canonical user preference
3. `dashboard.level` — legacy field, back-compat
4. Default: `simple`

**If the resolved value is `eli5` and no terminal override is set, treat it as `simple`.** Analogy-based phrasing doesn't fit terminal contexts (debugging, reporting, ops). When `style.terminal_explanation_level: eli5` is set explicitly, honor it.

## Per-level rules in the terminal

- `technical` → name functions, types, files, paths, libs (e.g. `buildPrePrompt`, `services/claude.ts`, `Bun.serve`). Tech vocab assumed. Implementation details welcome when they explain what works differently. Surface architecture decisions, not just behavior.
- `simple` → plain words, replace tech terms with what they mean (`registry` → "list of projects", `SSE` → "live updates"). Focus on what changed for the system or the user. Concrete examples beat abstract descriptions.
- `eli5` (only if explicitly set as terminal override) → one analogy if it helps. Zero tech vocabulary. Focus on user-visible outcome. 2-4 sentences max.

## Length

Explanation level sets vocabulary and depth. `style.length` sets how much prose. They are independent: a `simple` report can still be bloated. Length governs ALL terminal output, progress reports, TLDRs, answers, not only SUMMARY.md/PLAN.md.

Resolution: `style.length` → default `standard`.

- `terse` → lead with the answer or the action. Cut every sentence that adds no info (test each in isolation: drop it, is meaning lost? No → delete). One idea per sentence, short common words.
- `standard` → length = what the content needs, no padding.
- `detailed` → fuller reasoning welcome, still no filler.

Banned at every length (filler never earns its place):

- Preamble and self-narration: "je me suis trompé", "voici l'état réel vérifié", "j'ai été imprécis", "let me explain".
- Flattery openers: "tu as raison", "bien vu", "good catch", "exactly".
- Hedge openers: "un bémol honnête", "pour être honnête", "à noter", "cela dit", "to be fair". State the caveat as a plain fact or cut it.
- Rhetorical antithesis for emphasis: "pas un mur, un bout de code", "pas un oubli", "not X, it's Y", "ce n'est pas X, c'est Y". State the positive claim once, drop the negated foil.
- Filler connectors: "in order to" / "afin de", "additionally" / "également" / "par ailleurs".
- Marketing words: "robust", "seamless", "leverage".

Readable and human, not caveman. Logs, paths, identifiers stay verbatim (see Scope).

## Scope

This gates HOW you explain, not WHAT you show. Logs, stack traces, error output, and commit hashes stay verbatim. The level only affects the prose around them.

## Interactive questions (AskUserQuestion)

Same level rule, applied to mid-pipeline prompts. Covers every `AskUserQuestion` raised by RIFF commands/protocols (confidence gate clarifications, plan-review escalations, scope-check DROPPED triage, fallow-fail triage, security/adversarial findings, milestone deep-audit prompt, pending-expertise review, promote/incident/start/onboard/init choice points).

When resolved level is `simple` or `eli5`:

- Phrase question + option labels in plain words. User-flow framing ("what happens to people who already got an email"), not protocol jargon ("kill-switch scope on signed redemption tokens").
- Drop framework vocab from the question body: BLOCKER, REVISE, kill switch, redemption, gate, scope, surface, auth surface, idempotency, etc. → if a term must appear, explain it inline as the concrete thing it does.
- Recommendation = one-line concrete consequence ("the 5 invitations already sent will still work"), not severity tag.
- Save tech vocab for AFTER the user picks → implementation belongs in the answer/follow-up, not the question.
- Voice rules still stack on top: conversational language per `LANGUAGE.md`, no dashes as separators, FR accents intact.

When resolved level is `technical` → no change. Tech vocab assumed, ship the question as-is.

Applies to ALL RIFF interactive points, every command, every protocol. Same resolution order as above.

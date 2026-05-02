# Context budget

Models with 1M context windows tempt you to fill them. Don't. Quality degrades well before the hard limit. Hallucination risk rises sharply past ~200k effective tokens, regardless of nominal capacity. Aim for absolute token counts, not percentages.

## Targets (assume 1M-class window)

- **GREEN (under 100k)**: ideal. Batch tool calls, read files freely, work normally.
- **YELLOW (100k-200k)**: acceptable. Be selective about file reads, prefer grep/glob over full reads, delegate analysis to sub-agents instead of inline reasoning over big bodies of code.
- **RED (200k+)**: stop and checkpoint. Hallucination risk is real here even though the window allows more. Propose a session break at the next natural boundary in the protocol.

## Why not percentages anymore

With 1M windows, "60% remaining" is 600k. Plenty of nominal headroom but already deep in degradation territory. Use raw token counts.

## Natural session-break points in `/riff:next`

See `commands/next.md` § Session checkpoints. Three boundaries (PLAN PROCEED, SUMMARY written, Step 7 PASS) where the parent context can be flushed via `/clear` and resumed from artifacts on disk without losing work.

## Sub-agent results count toward the parent's budget

A 5k verdict from Codex or a 15k summary from the executor lands in your context permanently when the agent returns. Multiplied across 4-6 sub-agents per phase, that's 50-100k of accumulated returns alone. Plan for it.

## Inline file reads are the biggest bloat source

A 200-line route file is ~5k tokens. Five of those is 25k. Prefer: spawn an Explore-style sub-agent for analysis, get back a short summary, keep the parent lean.

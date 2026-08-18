# Stress protocol

Stress assessment is advisory evidence. It never authorizes a deployment, merge, or production-target action by itself.

1. Define an approved target and bounded objectives.
2. Establish a baseline and preserve reproducible requests, inputs, and observed limits.
3. Separate static findings from active proof.
4. Use only approved non-production targets for active testing.
5. Report severity, evidence, residual risk, and recommended follow-up without silently building fixes.

Repository inspection is report-only. Active target access and temporary load-generation scratch are explicit grants; neither grants repository mutation authority.

The active native stage runner does not invoke a command-era stress pipeline as a normal `$riff:next` transition. Use `docs/RIFF-MANUAL.md` and `protocols/RIFF-NEXT.md` for current stage behavior.

## Legacy Claude command workflow

An explicitly installed legacy stress command may retain its own dispatch and evidence format. Its runtime-specific routes belong to that compatibility command, not to this shared protocol or native adapter configuration.

### Model & effort dispatch

Compatibility anchor only. Native runtime selection is adapter-owned.

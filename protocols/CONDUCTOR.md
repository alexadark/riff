# Conductor compatibility protocol

The active provider-native slice runs one explicit bounded stage at a time. It has no native cross-project conductor, scheduled sweep, or implicit autonomous loop.

Use `docs/RIFF-MANUAL.md` to invoke a stage and `protocols/RIFF-NEXT.md` for its exact transition contract.

## Legacy Claude command workflow

An explicitly installed legacy conductor command may coordinate eligible projects through its own state and approval rules. That workflow is separate from `$riff:next`. Do not invoke it as a native stage feature, and do not treat a legacy scheduled run as standing authority for a native stage, merge, or deployment.

### Eligibility rules

Compatibility anchor only. The active native runner has no cross-project selector.

### Approval model

Compatibility anchor only. Native stages require their own explicit request.

### Failure modes

Compatibility anchor only. Use `protocols/RIFF-NEXT.md` for native failure behavior.

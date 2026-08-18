# Wave bundle compatibility protocol

The active native runner uses the `## Waves` section of a validated plan to express ordering and independent task ownership. It stages and executes those waves sequentially. A wave is not a portable executor bundle and does not authorize parallel mutation.

The authoritative native contract is `protocols/RIFF-NEXT.md`; see `docs/RIFF-MANUAL.md` for the operator explanation.

## Legacy Claude command workflow

Older command workflows may assemble `.planning/waves/` bundle and result files for an external wave executor. Those artifacts, their fields, and their command-specific reconciliation rules are compatibility-only. Do not generate them for `$riff:next`, and do not describe their executor hand-off as the current wave model.

### Prompt preservation

Compatibility anchor only. Native stages preserve validated artifacts through the runner's state contract.

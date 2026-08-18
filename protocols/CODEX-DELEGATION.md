# Codex delegation compatibility protocol

The active `$riff:next` runner dispatches its own native adapters. It does not hand a wave to an optional external executor, pause for a pasted terminal session, or replace a failed route with a different runtime.

For native dispatch boundaries, evidence snapshots, and failure behavior, read `protocols/RIFF-NEXT.md`. For the operator contract, read `docs/RIFF-MANUAL.md`.

## Legacy Claude command workflow

This file formerly described the command-era hand-off from a Claude session to a Codex terminal or external skill. That workflow may remain supported by separately installed legacy commands, but it is not Codex-native RIFF behavior.

When maintaining a legacy command workflow:

- Treat its command, skill, and runtime adapter as one versioned compatibility surface.
- Use its explicit artifact contract and resume procedure.
- Do not present paste hand-offs, automatic runtime fallbacks, or command-era model settings as options for `$riff:next`.
- Do not copy compatibility routing into profiles, shared roles, or the native stage protocol.

### Routing decision

Compatibility anchor only. Native routing is adapter-owned.

### Execution skill resolution

Compatibility anchor only. The active stage runner does not resolve an external execution skill.

### Template A

Compatibility anchor only. Legacy prompts belong to the installed legacy command.

### Out-of-process invocation

Compatibility anchor only. `$riff:next` has no paste-terminal transition.

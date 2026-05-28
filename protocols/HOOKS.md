# Hooks

RIFF installs project-local Claude Code hooks only. Codex remains an executor runtime through the configured skill/CLI; it is not installed as a project hook harness.

## Runtime Covered

| Runtime | Config file | Events used |
|---|---|---|
| Claude Code | `<project>/.claude/settings.json` | PreToolUse, PostToolUse, SessionStart, PreCompact |

Settings use the Claude Code hook schema:

```json
{ "hooks": { "<Event>": [ { "matcher": "<regex>", "hooks": [ { "type": "command", "command": "..." } ] } ] } }
```

## Installed Events

- `SessionStart`: `voice-rules-inject.sh`
- `PreCompact`: `compaction-checkpoint.sh`
- `PreToolUse` / `Bash`: `destructive-guard.sh`
- `PostToolUse` / `Edit|Write`: boundary/typecheck/test gates plus profile-selected security hooks

The concrete hook buckets are documented in `hooks/README.md`. The settings templates are:

- `templates/settings.json`
- `templates/settings-balanced.json`
- `templates/settings-cautious.json`

`riff init` copies the appropriate template into `.claude/settings.json` when that file is absent. Existing project settings are preserved.

## Writing a Hook

Hooks should read the JSON payload from stdin and use `cwd`, `tool_name`, and `tool_input` to identify the touched file. For Claude `Write`/`Edit`, the path is usually `tool_input.file_path`.

```bash
payload="$(cat)"
tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // ""')"
cwd="$(printf '%s' "$payload" | jq -r '.cwd // ""')"
file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.absolute_path // ""')"
```

Prefer warning-only hooks unless the finding is a hard safety violation. Commit-time blocking belongs in `.git/hooks/pre-commit` (`hooks/security-scan.sh`) or in explicit `/riff:next` gates.

## Testing

Use `hooks/__tests__/run.sh` for the dual-payload hook fixtures. Even though Codex hooks are no longer installed by RIFF, those fixtures remain useful because several hooks still accept Codex-shaped payloads from older projects and from manual testing.

## Adding a New Hook

1. Add the script under `hooks/<name>.sh`.
2. Add it to the appropriate `templates/settings*.json` file.
3. Add or update a fixture in `hooks/__tests__/run.sh`.
4. Document the bucket and behavior in `hooks/README.md`.

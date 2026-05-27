# Hooks across runtimes (Claude + Codex)

How RIFF hooks fire in both Claude Code and Codex CLI, and how to write one hook that works for both.

## Runtimes covered

| Runtime | Config file | Events |
|---|---|---|
| Claude Code | `~/.claude/settings.json` (user) or `<project>/.claude/settings.json` (project) | PreToolUse, PostToolUse, SessionStart, PreCompact, Stop, UserPromptSubmit |
| Codex CLI | `~/.codex/hooks.json` | PostToolUse, SessionStart, UserPromptSubmit, Stop (PreToolUse: untested) |

Both use the same JSON schema: `{ "hooks": { "<Event>": [ { "matcher": "<regex>", "hooks": [ { "type": "command", "command": "..." } ] } ] } }`.

## What changed between runtimes

Three things differ. The rest is the same.

### 1. Tool names

Claude emits `Write` and `Edit` for file creation/modification. Codex emits `apply_patch` (a patch-format tool, not Write/Edit) and `exec_command` (shell). When a Codex turn creates a file with `printf > file` or `cat <<EOF > file`, the **PostToolUse hook for apply_patch does NOT fire**. This is a real coverage gap; see § Known gaps.

Use the matcher: `^(Write|Edit|apply_patch)$` to catch both runtimes' file-mutation events.

### 2. Payload shape on PostToolUse

**Claude (`tool_name = "Write"` or `"Edit"`)**

```json
{
  "session_id": "...",
  "transcript_path": "...",
  "cwd": "/abs/path/to/project",
  "permission_mode": "bypassPermissions",
  "effort": {"level": "xhigh"},
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/abs/path/to/file.ts",
    "content": "..."
  },
  "tool_response": {
    "type": "create",
    "filePath": "/abs/path/to/file.ts",
    "content": "...",
    "structuredPatch": [],
    "originalFile": null,
    "userModified": false
  },
  "tool_use_id": "toolu_...",
  "duration_ms": 8
}
```

Key: `tool_input.file_path` is **absolute**.

**Codex (`tool_name = "apply_patch"`)**

```json
{
  "session_id": "...",
  "turn_id": "...",
  "transcript_path": "...",
  "cwd": "/abs/path/to/project",
  "hook_event_name": "PostToolUse",
  "model": "gpt-5.5",
  "permission_mode": "bypassPermissions",
  "tool_name": "apply_patch",
  "tool_input": {
    "command": "*** Begin Patch\n*** Update File: relative/path/to/file.ts\n@@\n-old\n+new\n*** End Patch\n"
  },
  "tool_response": "Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nM relative/path/to/file.ts\n",
  "tool_use_id": "call_..."
}
```

Keys: **no `tool_input.file_path`**. File path lives inside `tool_input.command` after `*** Update File:` (also `*** Add File:`, `*** Delete File:`), **relative** to `cwd`. A single patch can touch multiple files.

### 3. Hook trust (Codex only)

Codex requires every hook command to be explicitly trusted before it runs. Trust state lives in `~/.codex/config.toml`:

```toml
[hooks.state."/Users/webstantly/.codex/hooks.json:post_tool_use:0:0"]
trusted_hash = "sha256:..."
```

When a hook is added or its command string changes, the hash no longer matches and **Codex silently skips the hook** until the user re-confirms trust on next interactive run.

Bypass for automation: `codex exec --dangerously-bypass-hook-trust ...`. Only use this if you control the hook source.

The hash algorithm is internal (not raw sha256 of the command); we cannot precompute it from a script. The install script must rely on the next interactive Codex session to trust the new entry.

## Writing a dual-runtime hook

Read `cwd`, `tool_name`, and `tool_input` from the stdin payload, then extract the file path(s) the runtime touched. This snippet handles both shapes:

```bash
payload="$(cat)"
tool_name="$(printf '%s' "$payload" | jq -r '.tool_name // ""')"
cwd="$(printf '%s' "$payload" | jq -r '.cwd // ""')"

case "$tool_name" in
  Write|Edit)
    file_path="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.absolute_path // ""')"
    files=("$file_path")
    ;;
  apply_patch)
    patch_text="$(printf '%s' "$payload" | jq -r '.tool_input.command // ""')"
    mapfile -t files < <(printf '%s\n' "$patch_text" | awk '/^\*\*\* (Update|Add|Delete) File: / { sub(/^\*\*\* [A-Za-z]+ File: /, ""); print }')
    # Resolve relative paths against cwd
    for i in "${!files[@]}"; do
      case "${files[$i]}" in
        /*) ;;
        *) files[$i]="$cwd/${files[$i]}" ;;
      esac
    done
    ;;
esac
```

Iterate `${files[@]}` and run the check on each. A single Codex `apply_patch` can mutate many files in one call.

## Known gaps

- **Codex shell-created files don't fire PostToolUse:apply_patch.** When Codex uses `exec_command` with redirection (`printf > file`, `cat <<EOF > file`, `sed -i`, etc.), no `apply_patch` event fires. To catch these, the matcher would need to include `exec_command` and the hook would have to parse shell text for output redirections, which is fragile. Current policy: accept the gap, and in `CODEX-DELEGATION.md` Template A instruct Codex to **always prefer `apply_patch`** for file mutations.
- **Codex hook trust must be granted interactively.** A fresh install of RIFF hooks into `~/.codex/hooks.json` requires one interactive `codex` session to approve. Document this in onboarding.
- **PreToolUse on Codex untested.** RIFF currently relies on PostToolUse only, so this is not blocking, but matchers like Bash command guarding via PreToolUse have not been verified.

## How to test a hook locally

The fastest way to capture a real payload from either runtime is to add an stdin logger to an already-trusted hook (Codex) or any user-level hook (Claude). Example snippet to drop near the top of an existing hook:

```bash
{
  echo "===== $(date -u +%Y-%m-%dT%H:%M:%SZ) ====="
  env | grep -E '^(CLAUDE_|CODEX_|SUPERSET_)' | sort
  echo "--- stdin ---"
  cat
  echo "--- end ---"
} >> /tmp/hook-probe.log
```

For Codex, add it to `auto-sync.sh` (already trusted) and trigger an `apply_patch`. For Claude, add it to `~/.claude/hooks/format-file.sh` (already trusted) and trigger a `Write`.

## How to add a new hook

1. Drop the script in `~/DEV/frameworks/riff/hooks/<name>.sh`. Make it read stdin, not args.
2. Wire it into the relevant template under `~/DEV/frameworks/riff/templates/settings*.json` (Claude).
3. Wire it into `~/.codex/hooks.json` via `install-codex-hooks.sh` (Codex). The install script patches the file idempotently and preserves existing entries.
4. On Codex side, the first interactive session after install will prompt to trust the new hook. Approve once; trust persists in `~/.codex/config.toml`.

## References

- Concrete payload examples captured during the WI-1 spike (2026-05-27): `/tmp/riff-probe/payload.log` (temporary, removed after spike)
- Existing Codex hook config: `~/.codex/hooks.json`
- Existing trusted Codex hook (template for new entries): `~/DEV/claude-code-private/hooks/auto-sync.sh`
- Existing RIFF Claude hooks: `~/DEV/frameworks/riff/hooks/`

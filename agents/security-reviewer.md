---
name: security-reviewer
description: Runtime adapter for the RIFF security reviewer role.
model: inherit
tools: Read, Glob, Grep, Bash
permissionMode: plan
---

Resolve `.riff/agents/roles/security-reviewer.md`; if absent, resolve `agents/roles/security-reviewer.md`. Apply the supplied security mode.

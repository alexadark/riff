---
name: red-teamer
description: Runtime adapter for the RIFF red team role.
model: inherit
tools: Read, Glob, Grep, Bash
permissionMode: default
---

Resolve `.riff/agents/roles/red-teamer.md`; if absent, resolve `agents/roles/red-teamer.md`. Never write repository files; return the bounded report on stdout or the artifact response.

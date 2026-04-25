# Registry

> Cumulative API surface of this project. Updated by the executor after each phase.
> This is the "menu" for agents - scan this before writing code that depends on existing modules.
> Last updated: {{DATE}} (phase {{PHASE_ID}})

## How to Read This

- **Import paths** are the only way to use a module. Never import from internal files.
- **Signature** shows the public contract. Check the actual code for full types.
- **Phase** tells you when it was added - read that phase's SUMMARY.md for context.

## Server Utilities

> Import: `import { ... } from "~/lib/server"`

| Function | Signature | Description | Phase |
| -------- | --------- | ----------- | ----- |
|          |           |             |       |

## Components

> Import: `import { ... } from "~/components/..."`

| Component | Key Props | Description | Phase |
| --------- | --------- | ----------- | ----- |
|           |           |             |       |

## Routes

| Path | Method | Loader | Action | Auth | Description | Phase |
| ---- | ------ | ------ | ------ | ---- | ----------- | ----- |
|      |        |        |        |      |             |       |

## Schema (Database Tables)

| Table | Key Columns | Relations | Phase |
| ----- | ----------- | --------- | ----- |
|       |             |           |       |

## Environment Variables

| Variable | Required | Description | Phase |
| -------- | -------- | ----------- | ----- |
|          |          |             |       |

## Hooks & Events

> Import: `import { emit, on } from "~/lib/server"`

| Event Name | Payload Type | Emitted By | Phase |
| ---------- | ------------ | ---------- | ----- |
|            |              |            |       |

last_audited: 2026-05-28
---
description: react-day-picker v10 breaking changes (classname renames)
paths:
  - "**/app/components/ui/calendar.tsx"
  - "**/src/components/ui/calendar.tsx"
  - "**/components/ui/calendar.tsx"
---

# Taste Reference - react-day-picker

> Apply when stack pulls `react-day-picker` (typically via shadcn `calendar` component or date-picker libs that depend on it).

## Core Rules

1. **v10 renamed `table` classname to `month_grid`.** Pre-v10 shadcn calendar snapshots use `className="table"` for the month grid container. After upgrading or installing fresh, the calendar widget breaks visually. Fix in `app/components/ui/calendar.tsx`:
   ```tsx
   // BEFORE (v8/v9)
   classNames={{ table: cn('w-full border-collapse space-y-1', classNames?.table) }}
   // AFTER (v10)
   classNames={{ month_grid: cn('w-full border-collapse space-y-1', classNames?.month_grid) }}
   ```
   Same applies to other classname slots: check upstream `react-day-picker` v10 changelog and `classNames` types.

2. **shadcn `calendar` component may be stale.** Some shadcn registries (including better-auth-ui's auth bundle) ship a calendar.tsx built against v8/v9. After `pnpm install` resolves `react-day-picker@^10`, expect a post-install patch round. Add this as a known TODO in your install protocol.

## Anti-Pattern Checklist

| Found                                          | Replace with                  |
| ---------------------------------------------- | ----------------------------- |
| `classNames.table` on `<DayPicker>`            | `classNames.month_grid`       |
| Other v8 classname slots used as-is post-bump  | Cross-check v10 type definitions and rename |

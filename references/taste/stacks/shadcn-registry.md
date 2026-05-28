last_audited: 2026-05-28
---
description: shadcn registry install hygiene (dead-code residue, framework-specific pragmas)
paths:
  - "**/components.json"
  - "**/app/components/ui/**/*.{ts,tsx}"
  - "**/src/components/ui/**/*.{ts,tsx}"
  - "**/.fallowrc.json"
---

# Taste Reference - shadcn registry

> Apply when stack uses `shadcn-ui` CLI (`pnpm dlx shadcn@latest add <registry-url>`) to install component bundles.
> The registry bulk-installs UI primitives + feature components as a coherent vendored unit, NOT individually prunable.

## Core Rules

1. **Accept dead-code residue from bulk installs.** When you install a feature registry (e.g., `pnpm dlx shadcn@latest add https://better-auth-ui.com/r/auth.json`), it ships with 20+ sibling components and UI primitives needed for internal linking. Static analyzers like `fallow` will flag many as unused. **Do not prune.** Removing a sibling breaks internal registry import paths and ships errors on the next registry update. Log as `accepted-exception` in your gate ledger, not as a refactor target.

2. **Strip Next.js-specific pragmas after install.** Registry files often carry `'use client'` directives inherited from Next.js source. In TanStack Start / Vite / non-Next.js frameworks, the pragma is a no-op but misleads readers about boundary semantics. After install, scan the new files and remove the directive:
   ```bash
   grep -rl "^'use client'" app/components/{auth,ui}/ | xargs sed -i '' "/^'use client'/d"
   ```

3. **Registry files may carry breaking-change debt from upstream lib bumps.** Example: `react-day-picker` v10 renamed `table` classname to `month_grid`; a stale `calendar.tsx` in the registry uses the v8 name and needs a one-line patch after `pnpm install` pulls v10. Verify visually that primitives render correctly after install — if a date picker / popover / drawer looks broken, search the file for the old class.

4. **Pin destination via `components.json` aliases.** Lib registries declare explicit file paths (e.g., `src/components/auth/sign-in.tsx`). To redirect them to your project's structure, edit `components.json` aliases (`{ components, utils, ui, auth }`) BEFORE running `shadcn add`. Don't try to move files after install — the registry's `update` command will re-emit at the original paths.

5. **Configure `fallow` (or your dead-code linter) to scope-out registry dirs.** Otherwise every phase touching auth UI will show 30+ false-positive dead-code findings. In `.fallowrc.json`:
   ```json
   {
     "ignore": [
       "app/components/ui/**",
       "app/components/auth/**"
     ]
   }
   ```
   Or accept the noise and document as `gate=accepted-exception` per phase.

## Anti-Pattern Checklist

| Found                                                          | Replace with                                          |
| -------------------------------------------------------------- | ----------------------------------------------------- |
| Deleting "unused" registry sibling files                       | Accept as vendored unit; document in gate ledger      |
| `'use client'` in registry files on TanStack Start             | Strip the directive                                   |
| Moving registry files after install                            | Update `components.json` aliases, re-run install      |
| Stale classnames after upstream major bump (`table` → `month_grid`) | Patch in place; record as a `D#` deviation in SUMMARY |
| `fallow` / dead-code linter polluting every gate               | Add registry dirs to `ignore` config                  |

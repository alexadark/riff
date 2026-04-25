#!/bin/bash
# Warn if commit touches public surface but not REGISTRY.md
staged=$(git diff --cached --name-only)
touches_surface=$(echo "$staged" | grep -E '(app/routes/|app/components/|app/lib/|schema\.|\.env)' || true)
touches_registry=$(echo "$staged" | grep -E '^REGISTRY\.md$' || true)
if [ -n "$touches_surface" ] && [ -z "$touches_registry" ]; then
  echo "⚠️  REGISTRY.md not updated but public surface changed:"
  echo "$touches_surface" | sed 's/^/   /'
  echo "Update REGISTRY.md or set RIFF_SKIP_REGISTRY=1 if intentional."
  [ "$RIFF_SKIP_REGISTRY" = "1" ] || exit 1
fi
exit 0

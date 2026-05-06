#!/bin/bash

# voice-rules-inject.sh
# RIFF SessionStart + PreCompact hook.
# Resolves the active profile (project override → framework default → neutre baseline)
# via lib/resolve-profile.sh, then injects language + explanation-depth rules tailored to it.
#
# Fail-safe: if no .riff/ symlink, no resolver, or no parseable profile, exits silently
# (no rules injected). Defaults baked into templates/profile.neutre.yaml.

PROJECT_ROOT="${PWD}"
FRAMEWORK_ROOT="$(cd "$PROJECT_ROOT/.riff" 2>/dev/null && pwd -P || true)"
[ -z "$FRAMEWORK_ROOT" ] && exit 0

RESOLVER="$FRAMEWORK_ROOT/lib/resolve-profile.sh"
[ -x "$RESOLVER" ] || exit 0

# Resolver stderr ("source: project|framework|neutre (...)") flows through unsuppressed
# so the hook log shows which tier supplied the profile. Only suppress on error path.
PROFILE_YAML="$("$RESOLVER" "$PROJECT_ROOT" "$FRAMEWORK_ROOT")" || exit 0
[ -z "$PROFILE_YAML" ] && exit 0

# Helper: extract a single YAML scalar by key from $PROFILE_YAML.
# Limitation: anchor is "indented key", so the same key name appearing under
# multiple top-level sections would match the first occurrence. The RIFF
# profile schema (see profile.yaml.example) keeps each key under one section,
# so this is safe in practice. For malformed profiles with duplicate keys,
# behavior may differ from the structural TS resolver.
extract() {
  printf '%s\n' "$PROFILE_YAML" \
    | grep -E "^[[:space:]]+$1:" 2>/dev/null \
    | sed -E 's/.*:[[:space:]]*//' \
    | tr -d '[:space:]"' \
    | head -1
}

LANG_CODE=$(extract conversational_language)

# Resolve explanation level: terminal_explanation_level → explanation_level
LEVEL=$(extract terminal_explanation_level)
[ -z "$LEVEL" ] && LEVEL=$(extract explanation_level)

# If both fields are empty after resolution, the profile is malformed. Exit silently.
[ -z "$LANG_CODE" ] && [ -z "$LEVEL" ] && exit 0

# Map language code to display name
case "$LANG_CODE" in
  fr) LANG_NAME="French" ;;
  en) LANG_NAME="English" ;;
  es) LANG_NAME="Spanish" ;;
  de) LANG_NAME="German" ;;
  it) LANG_NAME="Italian" ;;
  pt) LANG_NAME="Portuguese" ;;
  nl) LANG_NAME="Dutch" ;;
  *)  LANG_NAME="$LANG_CODE" ;;
esac

# Per-level guidance
case "$LEVEL" in
  simple)
    LEVEL_GUIDANCE="Plain words. Replace jargon with what it means ('hook' → 'script that fires on an event', 'SSE' → 'live updates', 'registry' → 'list of projects'). Concrete examples beat abstract descriptions. Go technical only when the user uses tech vocab themselves, asks 'why does this work', or asks for implementation details."
    ;;
  technical)
    LEVEL_GUIDANCE="Name functions, types, files, paths, libraries. Tech vocab assumed. Implementation details welcome when they explain what works differently. Surface architecture decisions, not just behavior."
    ;;
  eli5)
    LEVEL_GUIDANCE="One analogy if it helps. Zero tech vocabulary. Focus on user-visible outcome. 2-4 sentences max."
    ;;
  *)
    LEVEL_GUIDANCE="See taste.md / CLAUDE.md for project-specific guidance on level '$LEVEL'."
    ;;
esac

cat << RULES
RIFF voice rules (from profile.yaml — always active):

1. Chat language: detect from the user's FIRST message. Default is $LANG_NAME (per profile.yaml: conversational_language = $LANG_CODE). If they open in $LANG_NAME, reply in $LANG_NAME from sentence one — no drift to another language mid-conversation. If they open in a different language, follow them. Written artifacts (code, commits, docs, public content) default to English. Private content (notes, journal) follows the conversational language unless specified.

2. Default explanation depth: $LEVEL (per profile.yaml: explanation_level = $LEVEL). $LEVEL_GUIDANCE

3. Mid-conversation override: when the user explicitly switches ("switch to English", "in English please", "fais-moi ça en anglais", "be technical", "mode technique", "explique-moi techniquement", "explain simply", etc.), honor it for the rest of the session until they switch back. Override beats the defaults in rules 1 and 2.
RULES

exit 0

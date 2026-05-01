#!/bin/bash

# voice-rules-inject.sh
# RIFF SessionStart + PreCompact hook.
# Reads .riff/profile.yaml and injects language + explanation-depth rules
# tailored to the user's profile, plus a universal mid-conversation override clause.
#
# Fail-safe: if profile.yaml is missing or unparseable, exits silently (no rules injected).

set -o pipefail
trap 'exit 0' ERR

PROFILE=".riff/profile.yaml"
[ -f "$PROFILE" ] || exit 0

# Extract conversational_language (default: en)
LANG_CODE=$(grep -E "^[[:space:]]+conversational_language:" "$PROFILE" 2>/dev/null \
  | sed -E 's/.*:[[:space:]]*//' | tr -d '[:space:]"' | head -1)
LANG_CODE=${LANG_CODE:-en}

# Resolve explanation level: terminal_explanation_level → explanation_level → simple
LEVEL=$(grep -E "^[[:space:]]+terminal_explanation_level:" "$PROFILE" 2>/dev/null \
  | sed -E 's/.*:[[:space:]]*//' | tr -d '[:space:]"' | head -1)
[ -z "$LEVEL" ] && LEVEL=$(grep -E "^[[:space:]]+explanation_level:" "$PROFILE" 2>/dev/null \
  | sed -E 's/.*:[[:space:]]*//' | tr -d '[:space:]"' | head -1)
LEVEL=${LEVEL:-simple}

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

#!/bin/bash
# resolve-profile.sh
# Print the resolved profile YAML for a given project to stdout.
#
# Usage:
#   resolve-profile.sh <project_root> [framework_root]
#
# Resolution chain (first hit wins, no field-by-field merge):
#   1. <project_root>/.planning/profile.yaml
#   2. <framework_root>/profile.yaml
#   3. <framework_root>/templates/profile.default.yaml
#
# If framework_root is omitted, defaults to the parent of this script's directory.
# The picked source path is echoed to stderr for debugging.
# Exits 0 on success, 1 if no profile could be resolved (should not happen
# in a healthy install since the default template ships with the framework).

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "usage: $0 <project_root> [framework_root]" >&2
  exit 2
fi

project_root="$1"
script_dir="$(cd "$(dirname "$0")" && pwd)"
framework_root="${2:-$(dirname "$script_dir")}"

project_profile="$project_root/.planning/profile.yaml"
framework_profile="$framework_root/profile.yaml"
default_profile="$framework_root/templates/profile.default.yaml"

if [ -f "$project_profile" ]; then
  echo "[resolve-profile] source: project ($project_profile)" >&2
  cat "$project_profile"
elif [ -f "$framework_profile" ]; then
  echo "[resolve-profile] source: framework ($framework_profile)" >&2
  cat "$framework_profile"
elif [ -f "$default_profile" ]; then
  echo "[resolve-profile] source: default ($default_profile)" >&2
  cat "$default_profile"
else
  echo "[resolve-profile] no profile found (tried: $project_profile, $framework_profile, $default_profile)" >&2
  exit 1
fi

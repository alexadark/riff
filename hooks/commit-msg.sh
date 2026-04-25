#!/bin/bash
# RIFF commit-msg hook
#
# RIFF does NOT enforce a commit message format. Commits should describe
# the feature or bug being addressed, like normal conventional commits
# (feat:, fix:, chore:, refactor:, docs:, test:, etc.). Phase/task numbers
# do not belong in commit messages — they live in SUMMARY.md and ROADMAP.yaml.
#
# This hook is intentionally a no-op so it never blocks a commit. It exists
# only as a placeholder so RIFF installs have a predictable hook layout.

exit 0

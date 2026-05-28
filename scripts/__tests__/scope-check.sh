#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

pass=0
fail=0

make_phase() {
  local name="$1"
  mkdir -p "$WORK_DIR/.planning/phases/$name"
}

write_plan() {
  local phase="$1" body="$2"
  printf '%s\n' "$body" > "$WORK_DIR/.planning/phases/$phase/PLAN.md"
}

write_summary() {
  local phase="$1" body="$2"
  printf '%s\n' "$body" > "$WORK_DIR/.planning/phases/$phase/SUMMARY.md"
}

check_verdict() {
  local name="$1" phase="$2" expected="$3"
  set +e
  node "$ROOT/scripts/scope-check.mjs" --project-root "$WORK_DIR" --phase "$phase" >/tmp/riff-scope-check-test.out 2>&1
  local exit_code=$?
  set -e
  local verdict
  verdict="$(node -e 'console.log(require(process.argv[1]).verdict)' "$WORK_DIR/.planning/phases/$phase/SCOPE-CHECK.json")"
  if [[ "$verdict" == "$expected" ]] && { [[ "$expected" == "MATCH" && "$exit_code" == 0 ]] || [[ "$expected" != "MATCH" && "$exit_code" != 0 ]]; }; then
    echo "  PASS  $name"
    pass=$((pass + 1))
  else
    echo "  FAIL  $name (expected $expected, got $verdict, exit $exit_code)"
    sed 's/^/        /' "$WORK_DIR/.planning/phases/$phase/SCOPE-CHECK.json"
    fail=$((fail + 1))
  fi
}

make_phase "1-match"
write_plan "1-match" '# Plan

## Tasks

### Task 1: Update profile metadata
### Task 2: Wire Claude settings

## Smoke

- `node scripts/riff-init.mjs --help` -> exits 0
- `bash hooks/__tests__/run.sh` -> exits 0'
write_summary "1-match" '# Summary

## What Was Built

- Updated profile metadata configuration.
- Wired Claude settings from templates.

## Status

**completed**

## Smoke Results

| Command | Expected | Observed | Status |
| ------- | -------- | -------- | ------ |
| `node scripts/riff-init.mjs --help` | exits 0 | exits 0 | pass |
| `bash hooks/__tests__/run.sh` | exits 0 | exits 0 | pass |'
check_verdict "all tasks and smokes match" "1-match" "MATCH"

make_phase "2-dropped"
write_plan "2-dropped" '# Plan

## Tasks

### Task 1: Update profile metadata
### Task 2: Remove adapter install

## Smoke

- `node scripts/riff-init.mjs --help` -> exits 0
- `bash hooks/__tests__/run.sh` -> exits 0'
write_summary "2-dropped" '# Summary

## What Was Built

- Updated profile metadata configuration.

## Status

**partial**

## Smoke Results

| Command | Expected | Observed | Status |
| ------- | -------- | -------- | ------ |
| `node scripts/riff-init.mjs --help` | exits 0 | exits 0 | pass |
| `bash hooks/__tests__/run.sh` | exits 0 | exits 0 | pass |'
check_verdict "missing task is dropped" "2-dropped" "DROPPED"

make_phase "3-smoke-lie"
write_plan "3-smoke-lie" '# Plan

## Tasks

### Task 1: Update scope checker

## Smoke

- `node scripts/scope-check.mjs --help` -> exits 0
- `bash scripts/__tests__/scope-check.sh` -> exits 0'
write_summary "3-smoke-lie" '# Summary

## What Was Built

- Updated scope checker.

## Status

**completed**

## Smoke Results

| Command | Expected | Observed | Status |
| ------- | -------- | -------- | ------ |
| `node scripts/scope-check.mjs --help` | exits 0 | exits 0 | pass |
| `bash scripts/__tests__/scope-check.sh` | exits 0 | assertion failed | fail |'
check_verdict "completed status with failed smoke is malformed" "3-smoke-lie" "MALFORMED"

make_phase "4-docs"
write_plan "4-docs" '# Plan

## Tasks

### Task 1: Update README wording

## Smoke

- `git diff --stat main...HEAD` -> only docs changed'
write_summary "4-docs" '# Summary

## What Was Built

- Updated README wording.

## Status

**completed**

## Smoke Results

| Command | Expected | Observed | Status |
| ------- | -------- | -------- | ------ |
| `git diff --stat main...HEAD` | only docs changed | only docs changed | pass |'
check_verdict "docs-only one-smoke plan passes" "4-docs" "MATCH"

echo ""
echo "scope-check tests: $pass passed, $fail failed"
if [[ "$fail" -gt 0 ]]; then
  exit 1
fi

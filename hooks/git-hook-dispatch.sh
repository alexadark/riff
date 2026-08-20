#!/bin/bash
# RIFF managed Git-hook dispatcher.
# It preserves and runs an existing project hook before the RIFF hook.

set -u

event="$(basename "$0")"
case "$event" in
  pre-commit) riff_hook="security-scan.sh" ;;
  commit-msg) riff_hook="commit-msg.sh" ;;
  *) echo "RIFF Git hook dispatcher: unsupported event $event" >&2; exit 1 ;;
esac

hook_dir="$(cd "$(dirname "$0")" && pwd -P)"
user_hook="$hook_dir/$event.user"
project_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "RIFF Git hook dispatcher: cannot resolve project root" >&2
  exit 1
}
riff_path="$project_root/.riff/hooks/$riff_hook"

user_status=0
if [ -x "$user_hook" ]; then
  (
    unset RIFF_GIT_HOOK_RECEIPT_DIR RIFF_GIT_HOOK_NONCE RIFF_GIT_ACTION_ID RIFF_GIT_EXPECTED_TREE_OID
    "$user_hook" "$@"
  ) || user_status=$?
fi
if [ "$user_status" -ne 0 ]; then
  exit "$user_status"
fi

if [ ! -f "$riff_path" ]; then
  echo "RIFF Git hook dispatcher: missing $riff_path" >&2
  exit 1
fi
bash "$riff_path" "$@" || exit $?

receipt_dir="${RIFF_GIT_HOOK_RECEIPT_DIR:-}"
nonce="${RIFF_GIT_HOOK_NONCE:-}"
action_id="${RIFF_GIT_ACTION_ID:-}"
expected_tree="${RIFF_GIT_EXPECTED_TREE_OID:-}"
if [ -n "$receipt_dir" ] || [ -n "$nonce" ] || [ -n "$action_id" ] || [ -n "$expected_tree" ]; then
  if [ -z "$receipt_dir" ] || [ -z "$nonce" ] || [ -z "$action_id" ] || [ -z "$expected_tree" ]; then
    echo "RIFF Git hook dispatcher: incomplete runner receipt identity" >&2
    exit 1
  fi
  case "$nonce:$action_id" in
    *[!A-Za-z0-9._:-]*) echo "RIFF Git hook dispatcher: invalid receipt identity" >&2; exit 1 ;;
  esac
  if [ ! -d "$receipt_dir" ] || [ -L "$receipt_dir" ]; then
    echo "RIFF Git hook dispatcher: receipt directory is unavailable" >&2
    exit 1
  fi
  expected_root="$project_root/.planning/riff-next/hook-receipts"
  if [ ! -d "$expected_root" ] || [ -L "$expected_root" ]; then
    echo "RIFF Git hook dispatcher: receipt root is unavailable" >&2
    exit 1
  fi
  receipt_real="$(cd "$receipt_dir" && pwd -P)" || exit 1
  expected_real="$(cd "$expected_root" && pwd -P)" || exit 1
  case "$receipt_real/" in
    "$expected_real"/*) ;;
    *) echo "RIFF Git hook dispatcher: receipt directory escapes runner state" >&2; exit 1 ;;
  esac
  tree_oid="$(git write-tree)" || exit 1
  if [ "$tree_oid" != "$expected_tree" ]; then
    echo "RIFF Git hook dispatcher: hook changed the runner-owned staged tree" >&2
    exit 1
  fi
  if command -v shasum >/dev/null 2>&1; then
    hook_sha256="$(shasum -a 256 "$riff_path" | awk '{print $1}')"
  else
    hook_sha256="$(sha256sum "$riff_path" | awk '{print $1}')"
  fi
  case "$hook_sha256" in *[!a-f0-9]*) hook_sha256="" ;; esac
  if [ "${#hook_sha256}" -ne 64 ]; then
    echo "RIFF Git hook dispatcher: cannot hash RIFF hook" >&2
    exit 1
  fi
  chained=false
  [ -x "$user_hook" ] && chained=true
  receipt="$receipt_dir/$event.json"
  temporary="$receipt.tmp.$$"
  umask 077
  set -C
  printf '{"schema_version":1,"event":"%s","nonce":"%s","action_id":"%s","tree_oid":"%s","riff_hook_sha256":"%s","user_hook_chained":%s}\n' \
    "$event" "$nonce" "$action_id" "$tree_oid" "$hook_sha256" "$chained" > "$temporary" || exit 1
  set +C
  mv "$temporary" "$receipt" || exit 1
fi

exit 0

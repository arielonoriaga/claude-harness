#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
CC="$HERE/capture-correction.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export TEST_JOURNAL_DIR="$TMP/agent-journal"
export IMPROVE_DIR="$TMP/improvements"
export CLAUDE_CODE_SESSION_ID="ccsess"
fail=0
check(){ if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got [$1] want [$2])"; fail=1; fi; }

bash "$CC" git "use personal identity in non-work dirs"
check "$(jq -r '.tag' "$TEST_JOURNAL_DIR/ccsess.jsonl")" "correction" "journal tag=correction"
check "$(jq -r '.msg' "$TEST_JOURNAL_DIR/ccsess.jsonl")" "git: use personal identity in non-work dirs" "journal msg has category"
check "$(jq -r '.total' "$IMPROVE_DIR/corrections.json")" "1" "counter total=1"
check "$(jq -r '.byCategory.git' "$IMPROVE_DIR/corrections.json")" "1" "counter category git=1"

bash "$CC" style "no comments on unchanged code"
check "$(jq -r '.total' "$IMPROVE_DIR/corrections.json")" "2" "counter total=2"
check "$(jq -r '.byCategory.style' "$IMPROVE_DIR/corrections.json")" "1" "counter style=1"
check "$(jq -r '.byCategory.git' "$IMPROVE_DIR/corrections.json")" "1" "counter git unchanged"

for i in $(seq 1 15); do bash "$CC" perf "n$i" & done; wait
check "$(jq -r '.total' "$IMPROVE_DIR/corrections.json")" "17" "flock: 15 concurrent bumps (total 17)"
check "$(jq -r '.byCategory.perf' "$IMPROVE_DIR/corrections.json")" "15" "flock: perf category=15"

exit $fail

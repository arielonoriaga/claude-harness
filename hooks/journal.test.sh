#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
J="$HERE/journal.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export TEST_JOURNAL_DIR="$TMP/agent-journal"
fail=0
check(){ if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got [$1] want [$2])"; fail=1; fi; }

bash "$J" write main note "hello world" --session s1
LINE="$(cat "$TEST_JOURNAL_DIR/s1.jsonl")"
check "$(printf '%s' "$LINE" | jq -r '.msg')" "hello world" "write stores msg"
check "$(printf '%s' "$LINE" | jq -r '.agent')" "main" "write stores agent"
check "$(printf '%s' "$LINE" | jq -r '.tag')" "note" "write stores tag"
check "$(printf '%s' "$LINE" | jq -r '.session')" "s1" "write stores session"

check "$(bash "$J" read --session s1 | wc -l | tr -d ' ')" "1" "read one line"

bash "$J" write test-agent finding "bug here" --session s1
check "$(bash "$J" read --session s1 --tag finding | wc -l | tr -d ' ')" "1" "read --tag filters"
check "$(bash "$J" read --session s1 --agent main | wc -l | tr -d ' ')" "1" "read --agent filters"
check "$(bash "$J" read --session s1 --tail 1 | jq -r '.tag')" "finding" "read --tail N"

CLAUDE_CODE_SESSION_ID=envsess bash "$J" write main note "via env"
check "$(jq -r '.msg' "$TEST_JOURNAL_DIR/envsess.jsonl")" "via env" "env session resolution"

echo "lastsess" > "$TEST_JOURNAL_DIR/.last-session"
env -u CLAUDE_CODE_SESSION_ID bash "$J" write main note "via last"
check "$(jq -r '.msg' "$TEST_JOURNAL_DIR/lastsess.jsonl")" "via last" ".last-session fallback"

for i in $(seq 1 20); do bash "$J" write main note "c$i" --session conc & done; wait
check "$(wc -l < "$TEST_JOURNAL_DIR/conc.jsonl" | tr -d ' ')" "20" "flock: 20 concurrent appends intact"
check "$(jq -s 'length' "$TEST_JOURNAL_DIR/conc.jsonl")" "20" "flock: all lines valid json"

exit $fail

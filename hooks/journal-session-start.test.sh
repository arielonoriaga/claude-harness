#!/usr/bin/env bash
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SS="$HERE/journal-session-start.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export TEST_JOURNAL_DIR="$TMP/agent-journal"
mkdir -p "$TEST_JOURNAL_DIR"
fail=0
check(){ if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got [$1] want [$2])"; fi; [ "$1" = "$2" ] || fail=1; }

echo '{"ts":"t","session":"prev","agent":"main","tag":"note","msg":"earlier work"}' > "$TEST_JOURNAL_DIR/prev.jsonl"
echo "prev" > "$TEST_JOURNAL_DIR/.last-session"

OUT="$(printf '{"session_id":"new1","hook_event_name":"SessionStart"}' | bash "$SS")"
check "$(printf '%s' "$OUT" | grep -c 'earlier work')" "1" "injects prev-session tail"
check "$(cat "$TEST_JOURNAL_DIR/.last-session")" "new1" "rolls pointer to new session"

rm -f "$TEST_JOURNAL_DIR/.last-session"
OUT2="$(printf '{"session_id":"new2","hook_event_name":"SessionStart"}' | bash "$SS")"
check "$(printf '%s' "$OUT2" | wc -c | tr -d ' ')" "0" "no prior: prints nothing"
check "$(cat "$TEST_JOURNAL_DIR/.last-session")" "new2" "still rolls pointer"

exit $fail

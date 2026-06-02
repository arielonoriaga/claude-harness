#!/usr/bin/env bash
# Self-contained test for ledger.sh. Uses a temp repo dir.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
LEDGER="$HERE/ledger.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export TEST_AGENT_DIR="$TMP/.test-agent"   # ledger.sh honors this override
fail=0
check(){ if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got [$1] want [$2])"; fail=1; fi; }

# add returns an id, file gets created
id1=$(bash "$LEDGER" add "auto: changes in src/a.rs" "src/a.rs" hook)
check "$(jq -r '.[0].desc' "$TEST_AGENT_DIR/ledger.json")" "auto: changes in src/a.rs" "add writes desc"
check "$(jq -r '.[0].status' "$TEST_AGENT_DIR/ledger.json")" "todo" "add defaults todo"
check "$(jq -r '.[0].createdBy' "$TEST_AGENT_DIR/ledger.json")" "hook" "add records createdBy"

# set-status transitions
bash "$LEDGER" set-status "$id1" testing >/dev/null
check "$(jq -r '.[0].status' "$TEST_AGENT_DIR/ledger.json")" "testing" "set-status testing"
bash "$LEDGER" set-status "$id1" passed >/dev/null
check "$(jq -r '.[0].status' "$TEST_AGENT_DIR/ledger.json")" "passed" "set-status passed"

# list-open excludes passed
bash "$LEDGER" add "auto: changes in src/b.rs" "src/b.rs" hook >/dev/null
check "$(bash "$LEDGER" list-open | jq 'length')" "1" "list-open excludes passed"

# reopen-stale flips passed->todo when file matches
bash "$LEDGER" reopen-stale "src/a.rs" >/dev/null
check "$(jq -r '.[0].status' "$TEST_AGENT_DIR/ledger.json")" "todo" "reopen-stale flips passed"

# has-open-for: true for tracked file with open task, false otherwise
check "$(bash "$LEDGER" has-open-for "src/a.rs")" "yes" "has-open-for yes"
check "$(bash "$LEDGER" has-open-for "src/zzz.rs")" "no" "has-open-for no"

exit $fail

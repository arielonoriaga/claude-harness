#!/usr/bin/env bash
# queue.sh tests. Isolated IMPROVE_DIR; QUEUE_REFINE_CMD stubs the reflector spawn.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
Q="$HERE/queue.sh"
fail=0
check(){ if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got [$1] want [$2])"; fail=1; fi; }

seed(){  # -> echoes a fresh IMPROVE_DIR seeded with 2 pending proposals
  local d; d="$(mktemp -d)"
  cat > "$d/pending.json" <<'JSON'
[
  {"id":"a","date":"2026-06-01","title":"A","signal":"sig-a 4x","target":"CLAUDE.md","proposal":"do a","snippet":"line1\nline2","risk":"low","status":"pending"},
  {"id":"b","date":"2026-06-01","title":"B","signal":"sig-b 3x","target":"hook","proposal":"do b","snippet":"x","risk":"med","status":"pending"}
]
JSON
  echo '[]' > "$d/applied.json"
  echo "$d"
}
run(){ local d="$1"; shift; IMPROVE_DIR="$d" bash "$Q" "$@"; }

# 1. count = pending only
D="$(seed)"
check "$(run "$D" count)" "2" "count = 2 pending"

# 2. accept keeps it in pending, status=accepted, count drops
run "$D" accept a >/dev/null
check "$(jq -r '.[]|select(.id=="a").status' "$D/pending.json")" "accepted" "accept sets status"
check "$(run "$D" count)" "1" "accepted no longer counts as pending"

# 3. apply retires accepted -> applied.json, gone from pending
run "$D" apply a >/dev/null
check "$(jq 'any(.[];.id=="a")' "$D/pending.json")" "false" "applied removed from pending"
check "$(jq -r '.[]|select(.id=="a").status' "$D/applied.json")" "applied" "applied landed in applied.json"

# 4. deny with reason -> dismissed in applied.json with reason
run "$D" deny b "too risky" >/dev/null
check "$(jq -r '.[]|select(.id=="b").status' "$D/applied.json")" "dismissed" "deny -> dismissed"
check "$(jq -r '.[]|select(.id=="b").reason' "$D/applied.json")" "too risky" "deny stores reason"
check "$(run "$D" count)" "0" "queue empty after deny"
rm -rf "$D"

# 5. iterate: refiner output overwrites entry but id+status forced
D="$(seed)"
export QUEUE_REFINE_CMD='echo "{\"id\":\"WRONG\",\"date\":\"2026-06-01\",\"title\":\"A\",\"signal\":\"s\",\"target\":\"CLAUDE.md\",\"proposal\":\"REFINED\",\"snippet\":\"y\",\"risk\":\"high\",\"status\":\"garbage\"}"'
run "$D" iterate a >/dev/null
unset QUEUE_REFINE_CMD
check "$(jq -r '.[]|select(.id=="a").proposal' "$D/pending.json")" "REFINED" "iterate applied refined fields"
check "$(jq -r '.[]|select(.id=="a").status' "$D/pending.json")" "pending" "iterate forces status=pending"
check "$(jq 'any(.[];.id=="WRONG")' "$D/pending.json")" "false" "iterate forces original id (ignores refiner id)"
check "$(jq -r '.[]|select(.id=="a").risk' "$D/pending.json")" "high" "iterate adopts refined risk"
rm -rf "$D"

# 6. iterate with garbage refiner output leaves status=iterating, no crash
D="$(seed)"
export QUEUE_REFINE_CMD='echo "not json at all"'
run "$D" iterate b >/dev/null 2>&1
unset QUEUE_REFINE_CMD
check "$(jq -r '.[]|select(.id=="b").status' "$D/pending.json")" "iterating" "bad refiner output -> status iterating, entry intact"
rm -rf "$D"

# 7. unknown id errors (nonzero), no mutation
D="$(seed)"
run "$D" accept nope >/dev/null 2>&1
check "$?" "1" "accept unknown id returns nonzero"
check "$(run "$D" count)" "2" "unknown id did not mutate"
rm -rf "$D"

# 8. show includes the signal (the why)
D="$(seed)"
out="$(run "$D" show a)"
check "$(echo "$out" | grep -c 'sig-a 4x')" "1" "show surfaces signal/why"
rm -rf "$D"

# 9. bootstrap empty dir -> count 0, no crash
D="$(mktemp -d)"
check "$(run "$D" count)" "0" "empty dir bootstraps to 0"
rm -rf "$D"

# 10. show resolves ids in applied.json too (TUI 'Done'/'All' tabs read it directly)
D="$(seed)"
run "$D" deny b "nope" >/dev/null            # b -> applied.json (dismissed)
run "$D" apply a >/dev/null                   # a -> applied.json (applied)
check "$(run "$D" count)" "0" "count stays pending-only, ignores done"
check "$(run "$D" show b | grep -c 'sig-b 3x')" "1" "show finds entry in applied.json"
check "$(run "$D" show b | grep -c 'reason: nope')" "1" "show surfaces deny reason for done entry"
check "$(run "$D" show a | grep -c 'status:   applied')" "1" "show reflects applied status"
rm -rf "$D"

[ "$fail" = "0" ] && echo "ALL PASS" || echo "SOME FAILED"
exit "$fail"

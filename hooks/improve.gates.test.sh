#!/usr/bin/env bash
# Gate tests. Dispatcher honors IMPROVE_SPAWN_CMD to stub the real spawn.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DISP="$HERE/improve.sh"
fail=0
check(){ if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got [$1] want [$2])"; fail=1; fi; }

newenv(){ local base; base="$(mktemp -d)"; echo "$base/aj $base/imp"; }
runs(){
  local jdir="$1" idir="$2" extra="$3"
  printf '{"session_id":"s","hook_event_name":"SessionEnd"}' \
    | env TEST_JOURNAL_DIR="$jdir" IMPROVE_DIR="$idir" \
          IMPROVE_SPAWN_CMD="echo SPAWNED >> $idir/.spawned" $extra bash "$DISP"
}

# 1. no signal → no spawn
read J I <<<"$(newenv)"
runs "$J" "$I" "" >/dev/null 2>&1
check "$([ -f "$I/.spawned" ] && echo y || echo n)" "n" "no signal: no spawn"

# 2. signal present (journal entry) → spawn
read J I <<<"$(newenv)"; mkdir -p "$J"; echo '{"ts":"t","session":"s","agent":"main","tag":"note","msg":"x"}' > "$J/s.jsonl"
runs "$J" "$I" "" >/dev/null 2>&1
check "$([ -f "$I/.spawned" ] && echo y || echo n)" "y" "signal: spawns"
check "$([ -f "$I/.cooldown" ] && echo y || echo n)" "y" "cooldown touched"

# 3. recursion guard → no spawn even with signal
read J I <<<"$(newenv)"; mkdir -p "$J"; echo '{"ts":"t","session":"s","agent":"main","tag":"note","msg":"x"}' > "$J/s.jsonl"
runs "$J" "$I" "IMPROVE_SPAWN=1" >/dev/null 2>&1
check "$([ -f "$I/.spawned" ] && echo y || echo n)" "n" "recursion guard: no spawn"

# 4. cooldown → second run no spawn
read J I <<<"$(newenv)"; mkdir -p "$J"; echo '{"ts":"t","session":"s","agent":"main","tag":"note","msg":"x"}' > "$J/s.jsonl"
runs "$J" "$I" "" >/dev/null 2>&1; rm -f "$I/.spawned"
runs "$J" "$I" "" >/dev/null 2>&1
check "$([ -f "$I/.spawned" ] && echo y || echo n)" "n" "cooldown: no second spawn"

# 5. corrections-only signal (no journal) → spawn
read J I <<<"$(newenv)"; mkdir -p "$I"; echo '{"total":3,"byCategory":{"git":3},"lastTs":"t"}' > "$I/corrections.json"
runs "$J" "$I" "" >/dev/null 2>&1
check "$([ -f "$I/.spawned" ] && echo y || echo n)" "y" "corrections signal: spawns"

exit $fail

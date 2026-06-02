#!/usr/bin/env bash
# Gate-chain tests. Dispatcher honors TEST_AGENT_SPAWN_CMD override to avoid real spawns.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
DISP="$HERE/test-agent.sh"
fail=0
check(){ if [ "$1" = "$2" ]; then echo "ok: $3"; else echo "FAIL: $3 (got [$1] want [$2])"; fail=1; fi; }

mkrepo(){ local d; d="$(mktemp -d)"; git -C "$d" init -q; git -C "$d" config user.email t@t; git -C "$d" config user.name t; echo "$d"; }
run(){ # cwd extra_env -> runs dispatcher with a stubbed spawn marker
  local cwd="$1" extra_env="$2"
  printf '{"cwd":"%s","hook_event_name":"Stop"}' "$cwd" \
    | env TEST_AGENT_SPAWN_CMD="echo SPAWNED >> $cwd/.spawned" $extra_env bash "$DISP"
}

# 1. not a git repo → no spawn
NOREPO="$(mktemp -d)"
run "$NOREPO" "" >/dev/null 2>&1
check "$([ -f "$NOREPO/.spawned" ] && echo y || echo n)" "n" "non-repo: no spawn"

# 2. repo but no source changes → no spawn
R1="$(mkrepo)"; echo "doc" > "$R1/README.md"
run "$R1" "" >/dev/null 2>&1
check "$([ -f "$R1/.spawned" ] && echo y || echo n)" "n" "no source change: no spawn"

# 3. repo with source change → spawn
R2="$(mkrepo)"; echo "fn main(){}" > "$R2/a.rs"
run "$R2" "" >/dev/null 2>&1
check "$([ -f "$R2/.spawned" ] && echo y || echo n)" "y" "source change: spawns"
check "$([ -f "$R2/.test-agent/ledger.json" ] && echo y || echo n)" "y" "ledger seeded"
check "$(jq -r '.[0].status' "$R2/.test-agent/ledger.json")" "todo" "seeded task todo"
check "$(grep -c '/.test-agent/' "$R2/.gitignore")" "1" "gitignore updated"

# 4. recursion guard → no spawn even with source change
R3="$(mkrepo)"; echo "fn main(){}" > "$R3/a.rs"
run "$R3" "TEST_AGENT_SPAWN=1" >/dev/null 2>&1
check "$([ -f "$R3/.spawned" ] && echo y || echo n)" "n" "recursion guard: no spawn"

# 5. cooldown → second immediate run does not spawn
R4="$(mkrepo)"; echo "fn main(){}" > "$R4/a.rs"
run "$R4" "" >/dev/null 2>&1; rm -f "$R4/.spawned"
run "$R4" "" >/dev/null 2>&1
check "$([ -f "$R4/.spawned" ] && echo y || echo n)" "n" "cooldown: no second spawn"

exit $fail

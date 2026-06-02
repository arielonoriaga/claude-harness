#!/usr/bin/env bash
# flock-guarded JSON task ledger CRUD.
# Store: ${TEST_AGENT_DIR:-<cwd>/.test-agent}/ledger.json
set -euo pipefail

DIR="${TEST_AGENT_DIR:-$PWD/.test-agent}"
LEDGER="$DIR/ledger.json"
LOCK="$DIR/.ledger.lock"

ensure() {
  mkdir -p "$DIR"
  [ -f "$LEDGER" ] || echo '[]' > "$LEDGER"
}

# run a jq filter against the ledger atomically, writing the result back
mutate() {
  ensure
  exec 9>"$LOCK"
  flock 9
  local tmp; tmp="$(mktemp)"
  jq "$@" "$LEDGER" > "$tmp" && mv "$tmp" "$LEDGER"
  flock -u 9
}

read_only() {
  ensure
  exec 9>"$LOCK"
  flock -s 9
  jq "$@" "$LEDGER"
  flock -u 9
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
gen_id() { echo "t-$(date +%s)$RANDOM" | cut -c1-12; }

cmd="${1:-}"; shift || true
case "$cmd" in
  add)
    desc="${1:-}"; files="${2:-}"; by="${3:-hook}"
    id="$(gen_id)"
    files_json="$(printf '%s' "$files" | tr ', ' '\n' | grep -v '^$' | jq -R . | jq -s .)"
    mutate --arg id "$id" --arg desc "$desc" --arg by "$by" --arg ts "$(now)" \
      --argjson files "$files_json" \
      '. + [{id:$id, desc:$desc, files:$files, status:"todo", createdBy:$by, createdAt:$ts, validatedAt:null, report:null, notes:""}]'
    echo "$id"
    ;;
  set-status)
    id="${1:?id}"; status="${2:?status}"; report="${3:-}"; notes="${4:-}"
    mutate --arg id "$id" --arg st "$status" --arg ts "$(now)" --arg rep "$report" --arg notes "$notes" '
      map(if .id==$id then
        .status=$st
        | (if $st=="passed" or $st=="failed" then .validatedAt=$ts else . end)
        | (if $rep!="" then .report=$rep else . end)
        | (if $notes!="" then .notes=$notes else . end)
      else . end)'
    ;;
  list-open)
    read_only '[ .[] | select(.status=="todo" or .status=="testing" or .status=="failed") ]'
    ;;
  reopen-stale)
    for f in "$@"; do
      mutate --arg f "$f" 'map(if .status=="passed" and (.files | index($f)) then .status="todo" | .validatedAt=null else . end)'
    done
    ;;
  has-open-for)
    f="${1:?file}"
    n="$(read_only --arg f "$f" '[ .[] | select((.status=="todo" or .status=="testing" or .status=="failed") and (.files | index($f))) ] | length')"
    [ "$n" -gt 0 ] && echo "yes" || echo "no"
    ;;
  *)
    echo "usage: ledger.sh {add|set-status|list-open|reopen-stale|has-open-for} ..." >&2
    exit 2
    ;;
esac

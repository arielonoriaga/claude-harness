#!/usr/bin/env bash
# improve queue CLI — manage harness improvement proposals (pending.json).
# Source of truth: $IMPROVE_DIR/pending.json (array of proposal objects).
# Terminal states (accepted+applied, dismissed) move to applied.json — the
# reflector's dedup source. Schema per object:
#   {id,date,title,signal,target,proposal,snippet,risk,status}
#   status ∈ pending | accepted | iterating | applied | dismissed
set -uo pipefail

IMP_DIR="${IMPROVE_DIR:-$HOME/.claude/improvements}"
PENDING="$IMP_DIR/pending.json"
APPLIED="$IMP_DIR/applied.json"
LOCK="$IMP_DIR/.queue.lock"
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

err(){ echo "[queue] $*" >&2; }

ensure(){
  mkdir -p "$IMP_DIR"
  [ -s "$PENDING" ] || echo '[]' > "$PENDING"
  [ -s "$APPLIED" ] || echo '[]' > "$APPLIED"
}

# atomic jq rewrite of a json file under flock
_write(){  # file jq-args...
  local file="$1"; shift
  local tmp; tmp="$(mktemp)"
  if jq "$@" "$file" > "$tmp" 2>/dev/null; then
    mv "$tmp" "$file"
  else
    rm -f "$tmp"; err "jq update failed on $file"; return 1
  fi
}

_exists(){ jq -e --arg id "$1" 'any(.[]; .id==$id)' "$PENDING" >/dev/null 2>&1; }

# move an entry from pending -> applied, stamping new status (+ optional reason)
_retire(){  # id newstatus [reason]
  local id="$1" st="$2" reason="${3:-}"
  exec 9>"$LOCK"; flock 9
  _write "$APPLIED" --slurpfile p "$PENDING" --arg id "$id" --arg st "$st" --arg r "$reason" \
    '. + ($p[0] | map(select(.id==$id) | .status=$st | (if $r=="" then . else .reason=$r end)))' || return 1
  _write "$PENDING" --arg id "$id" 'map(select(.id!=$id))' || return 1
  flock -u 9
}

cmd_count(){  # pending-only count (statusline)
  jq '[.[] | select(.status=="pending")] | length' "$PENDING" 2>/dev/null || echo 0
}

cmd_list(){  # [status]
  local filter="${1:-}"
  local sel='.[]'
  [ -n "$filter" ] && sel=".[] | select(.status==\"$filter\")"
  if [ "$(jq "[$sel] | length" "$PENDING")" = "0" ]; then
    echo "no proposals${filter:+ with status=$filter}"
    return 0
  fi
  printf '%-34s %-5s %-9s %s\n' ID RISK STATUS TITLE
  jq -r "$sel | [.id, .risk, .status, .title] | @tsv" "$PENDING" \
    | while IFS=$'\t' read -r id risk status title; do
        printf '%-34s %-5s %-9s %s\n' "$id" "$risk" "$status" "$title"
      done
}

cmd_show(){  # id  — full proposal incl signal (the why); searches pending then applied
  local id="$1" src
  if _exists "$id"; then src="$PENDING"
  elif jq -e --arg id "$id" 'any(.[]; .id==$id)' "$APPLIED" >/dev/null 2>&1; then src="$APPLIED"
  else err "no such id: $id"; return 1; fi
  jq -r --arg id "$id" '.[] | select(.id==$id) |
    "id:       \(.id)\ndate:     \(.date)\ntitle:    \(.title)\ntarget:   \(.target)\nrisk:     \(.risk)\nstatus:   \(.status)\n\nwhy (signal):\n  \(.signal)\n\nproposal:\n  \(.proposal)\n\nsnippet:\n\(.snippet | split("\n") | map("  "+.) | join("\n"))" +
    (if .reason then "\n\nreason: \(.reason)" else "" end)' "$src"
}

cmd_accept(){  # id — mark accepted (stays in pending until applied)
  local id="$1"
  _exists "$id" || { err "no such id: $id"; return 1; }
  exec 9>"$LOCK"; flock 9
  _write "$PENDING" --arg id "$id" 'map(if .id==$id then .status="accepted" else . end)'
  flock -u 9
  echo "accepted: $id"
}

cmd_apply(){  # id — terminal: build done, move to applied.json (status=applied)
  local id="$1"
  _exists "$id" || { err "no such id: $id"; return 1; }
  _retire "$id" applied "" && echo "applied (retired): $id"
}

cmd_deny(){  # id [reason] — terminal: dismiss, move to applied.json
  local id="$1"; shift || true
  local reason="$*"
  _exists "$id" || { err "no such id: $id"; return 1; }
  _retire "$id" dismissed "$reason" && echo "dismissed: $id${reason:+ ($reason)}"
}

cmd_iterate(){  # id — re-run reflector on this one proposal to refine it in place
  local id="$1"
  _exists "$id" || { err "no such id: $id"; return 1; }
  local obj; obj="$(jq -c --arg id "$id" '.[] | select(.id==$id)' "$PENDING")"

  # mark iterating while we refine
  exec 9>"$LOCK"; flock 9
  _write "$PENDING" --arg id "$id" 'map(if .id==$id then .status="iterating" else . end)'
  flock -u 9

  local refined
  local brief="Refine ONE harness improvement proposal. Sharpen the proposal text and the
suggested snippet/diff so it is more concrete and minimal; re-evaluate risk (low|med|high).
Keep the SAME id and date. status MUST be \"pending\". Preserve the JSON schema EXACTLY:
{id,date,title,signal,target,proposal,snippet,risk,status}.
Output ONLY the single refined JSON object, nothing else.

Proposal to refine:
$obj"

  if [ -n "${QUEUE_REFINE_CMD:-}" ]; then
    refined="$(eval "$QUEUE_REFINE_CMD")"
  elif command -v claude >/dev/null; then
    # Pure text->JSON transform: needs NO tools. No bypassPermissions, no --add-dir.
    # Hard-block every mutating/exec tool; in print mode any tool call is denied anyway.
    refined="$(IMPROVE_SPAWN=1 claude -p "$brief" --model sonnet \
      --disallowedTools "Bash,Edit,Write,Read,NotebookEdit,WebFetch,WebSearch,Agent" 2>/dev/null)"
  else
    err "claude not found; cannot iterate. Left status=iterating."
    return 1
  fi

  # extract the JSON object (tolerate code fences / surrounding prose)
  local parsed
  parsed="$(printf '%s' "$refined" | jq -c 'if type=="object" then . else empty end' 2>/dev/null)" || true
  if [ -z "$parsed" ]; then
    parsed="$(printf '%s' "$refined" | grep -ozP '(?s)\{.*\}' 2>/dev/null | jq -c '.' 2>/dev/null)" || true
  fi
  if [ -z "$parsed" ]; then
    err "refiner returned no valid JSON object; left status=iterating."
    return 1
  fi

  exec 9>"$LOCK"; flock 9
  _write "$PENDING" --arg id "$id" --argjson new "$parsed" \
    'map(if .id==$id then ($new + {id:$id, status:"pending"}) else . end)' || { flock -u 9; return 1; }
  flock -u 9
  echo "iterated (refined): $id"
}

cmd_browse(){  # interactive ratatui TUI (improve-tui). queue.sh stays source of truth.
  local qdir; qdir="$(dirname "$SELF")"
  local bin="${IMPROVE_TUI_BIN:-$qdir/../improve-tui/target/release/improve-tui}"
  if [ ! -x "$bin" ]; then
    err "improve-tui not built. Run: (cd ~/.claude/hooks/improve-tui && cargo build --release)"
    return 1
  fi
  IMPROVE_DIR="$IMP_DIR" IMPROVE_QUEUE_SH="$SELF" exec "$bin"
}

usage(){
  cat >&2 <<'EOF'
usage: queue.sh <command> [args]
  count                 number of pending proposals (statusline)
  list [status]         table of proposals (optionally filter by status)
  browse                interactive ratatui TUI (improve-tui binary)
  show <id>             full proposal incl signal (why) + snippet
  accept <id>           mark accepted (stays in pending until applied)
  apply <id>            terminal: build done -> move to applied.json
  deny <id> [reason]    terminal: dismiss -> move to applied.json
  iterate <id>          re-run reflector to refine this proposal in place
EOF
  return 2
}

main(){
  ensure
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    count)   cmd_count ;;
    list)    cmd_list "$@" ;;
    browse)  cmd_browse ;;
    show)    [ $# -ge 1 ] || usage; cmd_show "$@" ;;
    accept)  [ $# -ge 1 ] || usage; cmd_accept "$@" ;;
    apply)   [ $# -ge 1 ] || usage; cmd_apply "$@" ;;
    deny)    [ $# -ge 1 ] || usage; cmd_deny "$@" ;;
    iterate) [ $# -ge 1 ] || usage; cmd_iterate "$@" ;;
    *)       usage ;;
  esac
}

main "$@"

#!/usr/bin/env bash
# Shared append-only JSONL agent journal. flock-guarded. Fail-open.
# Store: ${TEST_JOURNAL_DIR:-$HOME/.claude/agent-journal}/<session>.jsonl
set -uo pipefail

DIR="${TEST_JOURNAL_DIR:-$HOME/.claude/agent-journal}"
LAST="$DIR/.last-session"

ARG_SESSION=""; ARG_TAG=""; ARG_AGENT=""; ARG_TAIL=""
parse_flags() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --session) ARG_SESSION="${2:-}"; shift 2;;
      --tag) ARG_TAG="${2:-}"; shift 2;;
      --agent) ARG_AGENT="${2:-}"; shift 2;;
      --tail) ARG_TAIL="${2:-}"; shift 2;;
      *) shift;;
    esac
  done
}

resolve_session() {
  if [ -n "${ARG_SESSION:-}" ]; then echo "$ARG_SESSION"; return; fi
  if [ -n "${CLAUDE_CODE_SESSION_ID:-}" ]; then echo "$CLAUDE_CODE_SESSION_ID"; return; fi
  if [ -f "$LAST" ]; then cat "$LAST"; return; fi
  echo "unknown"
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

cmd="${1:-}"; shift || true
case "$cmd" in
  write)
    agent="${1:-main}"; tag="${2:-note}"; msg="${3:-}"; shift 3 2>/dev/null || true
    parse_flags "$@"
    sess="$(resolve_session)"
    mkdir -p "$DIR" 2>/dev/null || exit 0
    line="$(jq -nc --arg ts "$(now)" --arg s "$sess" --arg a "$agent" --arg t "$tag" --arg m "$msg" \
      '{ts:$ts,session:$s,agent:$a,tag:$t,msg:$m}' 2>/dev/null)" || exit 0
    [ -n "$line" ] || exit 0
    ( exec 9>>"$DIR/.$sess.lock"; flock 9; printf '%s\n' "$line" >> "$DIR/$sess.jsonl" ) 2>/dev/null || true
    exit 0
    ;;
  read)
    parse_flags "$@"
    sess="$(resolve_session)"
    f="$DIR/$sess.jsonl"
    [ -f "$f" ] || exit 0
    out="$(cat "$f")"
    [ -n "$ARG_TAG" ]   && out="$(printf '%s\n' "$out" | jq -c --arg t "$ARG_TAG" 'select(.tag==$t)' 2>/dev/null)"
    [ -n "$ARG_AGENT" ] && out="$(printf '%s\n' "$out" | jq -c --arg a "$ARG_AGENT" 'select(.agent==$a)' 2>/dev/null)"
    [ -n "$out" ] || exit 0
    if [ -n "$ARG_TAIL" ]; then printf '%s\n' "$out" | tail -n "$ARG_TAIL"; else printf '%s\n' "$out"; fi
    exit 0
    ;;
  path)
    parse_flags "$@"
    sess="$(resolve_session)"
    echo "$DIR/$sess.jsonl"
    ;;
  *)
    echo "usage: journal.sh {write <agent> <tag> <msg> | read | path} [--session ID] [--tag T] [--agent A] [--tail N]" >&2
    exit 2
    ;;
esac

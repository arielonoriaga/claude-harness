#!/usr/bin/env bash
# SessionStart: inject tail of the PREVIOUS session journal, then roll pointer. Fail-open.
set -uo pipefail
DIR="${TEST_JOURNAL_DIR:-$HOME/.claude/agent-journal}"
LAST="$DIR/.last-session"
TAIL_N="${JOURNAL_TAIL:-15}"
mkdir -p "$DIR" 2>/dev/null || exit 0

RAW="$(cat 2>/dev/null || true)"
NEW_ID="$(printf '%s' "$RAW" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -n "$NEW_ID" ] || NEW_ID="${CLAUDE_CODE_SESSION_ID:-unknown}"

if [ -f "$LAST" ]; then
  prev="$(cat "$LAST")"
  pf="$DIR/$prev.jsonl"
  if [ -n "$prev" ] && [ "$prev" != "$NEW_ID" ] && [ -f "$pf" ]; then
    echo "## Agent journal — previous session ($prev), last $TAIL_N entries"
    tail -n "$TAIL_N" "$pf" | jq -r '"- [\(.tag)] \(.agent): \(.msg)"' 2>/dev/null || true
    echo ""
  fi
fi

printf '%s' "$NEW_ID" > "$LAST" 2>/dev/null || true
exit 0

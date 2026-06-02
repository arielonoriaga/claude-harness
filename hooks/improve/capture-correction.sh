#!/usr/bin/env bash
# Capture a user correction: journal it (tag=correction) + bump counter. Fail-open.
# Usage: capture-correction.sh <category> "<note>"
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
JOURNAL="$HERE/../journal.sh"
IMP_DIR="${IMPROVE_DIR:-$HOME/.claude/improvements}"
COUNTER="$IMP_DIR/corrections.json"
LOCK="$IMP_DIR/.corrections.lock"

cat="${1:-uncategorized}"; note="${2:-}"
now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# 1. journal it (reuse journal.sh; honors CLAUDE_CODE_SESSION_ID/TEST_JOURNAL_DIR)
bash "$JOURNAL" write main correction "$cat: $note" 2>/dev/null || true

# 2. bump counter under flock
mkdir -p "$IMP_DIR" 2>/dev/null || exit 0
[ -f "$COUNTER" ] || echo '{"total":0,"byCategory":{},"lastTs":null}' > "$COUNTER"
(
  exec 9>>"$LOCK"; flock 9
  tmp="$(mktemp)"
  jq --arg c "$cat" --arg ts "$(now)" \
    '.total += 1 | .byCategory[$c] = ((.byCategory[$c] // 0) + 1) | .lastTs = $ts' \
    "$COUNTER" > "$tmp" 2>/dev/null && mv "$tmp" "$COUNTER"
) 2>/dev/null || true
exit 0

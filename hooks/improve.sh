#!/usr/bin/env bash
# SessionEnd hook: gate, spawn detached harness reflector. Propose-only. Fail-open.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
PROMPT="$SELF_DIR/improve/prompt.md"
JOURNAL_DIR="${TEST_JOURNAL_DIR:-$HOME/.claude/agent-journal}"
IMP_DIR="${IMPROVE_DIR:-$HOME/.claude/improvements}"
COOLDOWN_SECS="${IMPROVE_COOLDOWN:-21600}"   # 6h
THRESHOLD="${IMPROVE_THRESHOLD:-3}"
COOL="$IMP_DIR/.cooldown"

die_open(){ exit 0; }

# read stdin (best effort, for session id)
RAW="$(cat 2>/dev/null || true)"
SID="$(printf '%s' "$RAW" | jq -r '.session_id // empty' 2>/dev/null || true)"
[ -n "$SID" ] || SID="${CLAUDE_CODE_SESSION_ID:-}"

# gate 1: recursion guard
[ "${IMPROVE_SPAWN:-}" = "1" ] && die_open

# gate 2: cooldown
if [ -f "$COOL" ]; then
  last="$(date -r "$COOL" +%s 2>/dev/null || echo 0)"
  now="$(date +%s)"
  [ $(( now - last )) -lt "$COOLDOWN_SECS" ] && die_open
fi

# gate 3: signal present? (any journal jsonl OR a corrections counter)
have_journal="n"
if [ -d "$JOURNAL_DIR" ] && ls "$JOURNAL_DIR"/*.jsonl >/dev/null 2>&1; then have_journal="y"; fi
have_counter="n"
[ -f "$IMP_DIR/corrections.json" ] && have_counter="y"
[ "$have_journal" = "y" ] || [ "$have_counter" = "y" ] || die_open

# passed: prepare + touch cooldown
mkdir -p "$IMP_DIR"
touch "$COOL"
[ -s "$IMP_DIR/pending.json" ] || printf '[]\n' > "$IMP_DIR/pending.json"
[ -s "$IMP_DIR/applied.json" ] || printf '[]\n' > "$IMP_DIR/applied.json"

BRIEF="Reflect on recent harness activity and propose improvements (propose-only).
Journal dir: $JOURNAL_DIR
Improvements dir: $IMP_DIR (append proposal objects to pending.json array; dedup vs pending.json + applied.json)
Recurrence threshold: $THRESHOLD (a pattern must appear at least this many times)
Harness to inspect for dupes: ~/.claude/CLAUDE.md, ~/.claude/rules/, ~/.claude/hooks/guardrail/src/checks.rs"

# spawn (overridable for tests)
if [ -n "${IMPROVE_SPAWN_CMD:-}" ]; then
  eval "$IMPROVE_SPAWN_CMD"
  exit 0
fi

command -v claude >/dev/null || { echo "[improve] claude not found" >> "$IMP_DIR/reflector.log"; exit 0; }

IMPROVE_SPAWN=1 CLAUDE_CODE_SESSION_ID="$SID" nohup claude -p "$BRIEF" \
  --model sonnet \
  --append-system-prompt "$(cat "$PROMPT")" \
  --add-dir "$HOME/.claude" \
  --permission-mode bypassPermissions \
  >> "$IMP_DIR/reflector.log" 2>&1 &

exit 0

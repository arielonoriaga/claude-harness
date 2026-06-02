#!/usr/bin/env bash
# Stop hook: gate, seed ledger, spawn detached test agent. Fail-open always.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SELF_DIR/test-agent/lib.sh"
LEDGER_SH="$SELF_DIR/test-agent/ledger.sh"
PROMPT="$SELF_DIR/test-agent/prompt.md"
COOLDOWN_SECS="${TEST_AGENT_COOLDOWN:-300}"

die_open() { exit 0; }   # fail-open: never block Stop

# --- read stdin (best effort) ---
RAW="$(cat 2>/dev/null || true)"
CWD="$(printf '%s' "$RAW" | jq -r '.cwd // empty' 2>/dev/null || true)"
[ -n "$CWD" ] || CWD="$PWD"

# --- gate 1: recursion guard ---
[ "${TEST_AGENT_SPAWN:-}" = "1" ] && die_open

# --- gate 2: repo ---
REPO="$(repo_root "$CWD")"
[ -n "$REPO" ] || die_open

# --- gate 3: code changed ---
CHANGED="$(changed_source_files "$REPO")"
[ -n "$CHANGED" ] || die_open

# --- gate 4: cooldown (atomic claim) ---
# Closes the check->touch TOCTOU: two near-simultaneous Stop hooks could both
# read a stale .cooldown and pass before either refreshed it, racing on the
# same files. mkdir is atomic, so only one concurrent Stop wins the claim.
STATE="$REPO/.test-agent"
COOL="$STATE/.cooldown"
LOCK="$STATE/.spawn.lock"
mkdir -p "$STATE"
nows="$(date +%s)"
if [ -f "$COOL" ]; then
  last="$(date -r "$COOL" +%s 2>/dev/null || echo 0)"
  [ $(( nows - last )) -lt "$COOLDOWN_SECS" ] && die_open
fi
if ! mkdir "$LOCK" 2>/dev/null; then
  # lock held by a concurrent spawn; reclaim only if it is stale (crashed)
  llast="$(date -r "$LOCK" +%s 2>/dev/null || echo 0)"
  [ $(( nows - llast )) -lt "$COOLDOWN_SECS" ] && die_open
fi
trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
touch "$COOL"

# --- passed all gates: prepare state ---
# gitignore the state dir (idempotent)
GI="$REPO/.gitignore"
if ! { [ -f "$GI" ] && grep -qF '/.test-agent/' "$GI"; }; then
  echo '/.test-agent/' >> "$GI"
fi

export TEST_AGENT_DIR="$STATE"

# --- seed ledger: reopen stale, then add todo per changed file lacking an open task ---
# shellcheck disable=SC2086
bash "$LEDGER_SH" reopen-stale $CHANGED >/dev/null 2>&1 || true
while read -r f; do
  [ -n "$f" ] || continue
  if [ "$(bash "$LEDGER_SH" has-open-for "$f" 2>/dev/null)" = "no" ]; then
    bash "$LEDGER_SH" add "auto: changes in $f" "$f" hook >/dev/null 2>&1 || true
  fi
done <<< "$CHANGED"

OPEN_IDS="$(bash "$LEDGER_SH" list-open 2>/dev/null | jq -r '[.[].id] | join(",")' 2>/dev/null || true)"
DIFF="$(git -C "$REPO" diff HEAD 2>/dev/null | head -c 12000)"
BRIEF="Validate code changed this turn. Repo: $REPO
Changed source files:
$CHANGED

Open ledger task ids: ${OPEN_IDS:-none}
Ledger helper: bash $LEDGER_SH <cmd> (TEST_AGENT_DIR=$STATE)

git diff (truncated):
$DIFF"

# journal tap: record the spawn (fail-open)
SESS_ID="${CLAUDE_CODE_SESSION_ID:-}"
CHANGED_ONE_LINE="$(printf '%s' "$CHANGED" | tr '\n' ' ')"
bash "$SELF_DIR/journal.sh" write hook:stop note "spawned test-agent for: $CHANGED_ONE_LINE" ${SESS_ID:+--session "$SESS_ID"} 2>/dev/null || true

# --- spawn (overridable for tests) ---
if [ -n "${TEST_AGENT_SPAWN_CMD:-}" ]; then
  eval "$TEST_AGENT_SPAWN_CMD"          # test stub
  exit 0
fi

command -v claude >/dev/null || { echo "[test-agent] claude not found" >> "$STATE/agent.log"; exit 0; }

# bypassPermissions so the headless agent can run the test runner + ledger.sh
# (it can't answer prompts). The PreToolUse guardrail hook still gates every
# command — bypassPermissions skips the prompt, NOT the hook.
TEST_AGENT_SPAWN=1 TEST_AGENT_DIR="$STATE" CLAUDE_CODE_SESSION_ID="${CLAUDE_CODE_SESSION_ID:-}" nohup claude -p "$BRIEF" \
  --model sonnet \
  --append-system-prompt "$(cat "$PROMPT")" \
  --add-dir "$REPO" \
  --permission-mode bypassPermissions \
  >> "$STATE/agent.log" 2>&1 &

exit 0

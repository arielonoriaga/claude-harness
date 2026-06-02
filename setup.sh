#!/usr/bin/env bash
# Install the harness into your Claude Code config dir.
#
#   CLAUDE_HOME=~/.claude ./setup.sh        # install in place (default ~/.claude)
#
# It builds the two Rust binaries, then writes settings.json + CLAUDE.md from the
# .example templates with paths pointing at CLAUDE_HOME. Idempotent: never clobbers
# an existing settings.json / CLAUDE.md (prints the snippet to merge instead).
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
CLAUDE_HOME="${CLAUDE_HOME:-$HOME/.claude}"

echo "→ repo:        $REPO"
echo "→ CLAUDE_HOME: $CLAUDE_HOME"

# --- deps check ---
need() { command -v "$1" >/dev/null || { echo "✗ missing dependency: $1"; exit 1; }; }
need cargo
need jq
need node

# --- build binaries ---
echo "→ building guardrail (release)…"
(cd "$REPO/hooks/guardrail" && cargo build --release -q)
echo "→ building improve-tui (release)…"
(cd "$REPO/hooks/improve-tui" && cargo build --release -q)

# --- install files into CLAUDE_HOME ---
# If REPO already IS CLAUDE_HOME, nothing to copy; otherwise mirror the harness in.
if [ "$REPO" != "$CLAUDE_HOME" ]; then
  echo "→ copying harness into $CLAUDE_HOME …"
  mkdir -p "$CLAUDE_HOME"
  cp -r "$REPO/hooks" "$REPO/commands" "$REPO/rules" "$REPO/statusline-command.sh" "$CLAUDE_HOME/"
fi

mkdir -p "$CLAUDE_HOME/improvements"

# --- settings.json ---
RENDERED="$(sed "s#__CLAUDE_HOME__#$CLAUDE_HOME#g" "$REPO/settings.example.json")"
if [ -f "$CLAUDE_HOME/settings.json" ]; then
  echo "⚠ $CLAUDE_HOME/settings.json exists — not overwriting."
  echo "  Merge these hook + statusLine blocks into it:"
  echo "$RENDERED"
else
  printf '%s\n' "$RENDERED" > "$CLAUDE_HOME/settings.json"
  echo "✓ wrote $CLAUDE_HOME/settings.json"
fi

# --- CLAUDE.md ---
if [ ! -f "$CLAUDE_HOME/CLAUDE.md" ]; then
  sed "s#<CLAUDE_HOME>#$CLAUDE_HOME#g" "$REPO/CLAUDE.example.md" > "$CLAUDE_HOME/CLAUDE.md"
  echo "✓ wrote $CLAUDE_HOME/CLAUDE.md (from template)"
else
  echo "⚠ $CLAUDE_HOME/CLAUDE.md exists — left untouched (see CLAUDE.example.md)."
fi

cat <<EOF

✓ done. Optional guardrail git-identity policy (set in settings.json "env" or your shell):
    GUARDRAIL_PERSONAL_NAME / GUARDRAIL_PERSONAL_EMAIL
    GUARDRAIL_WORK_PREFIX   (path prefix that maps to the work identity; empty = disabled)
    GUARDRAIL_WORK_NAME     / GUARDRAIL_WORK_EMAIL

Restart Claude Code to load the hooks.
EOF

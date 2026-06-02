#!/usr/bin/env bash
# Shared helpers for the test-agent hook. Source me.

# Main-stack source extensions only.
is_source_file() {
  case "$1" in
    *.rs|*.tsx|*.ts|*.js|*.go|*.py|*.lua) return 0 ;;
    *) return 1 ;;
  esac
}

# Build artifacts / compiled output — source-looking but not testable.
# Matched on repo-relative path, at repo root or nested.
is_artifact_path() {
  case "$1" in
    dist/*|*/dist/*) return 0 ;;
    target/*|*/target/*) return 0 ;;
    build/*|*/build/*) return 0 ;;
    out/*|*/out/*) return 0 ;;
    *.min.js|*.min.css) return 0 ;;
    *) return 1 ;;
  esac
}

# repo root for a dir, or empty if not a git repo
repo_root() {
  git -C "$1" rev-parse --show-toplevel 2>/dev/null || true
}

# changed source files (tracked-modified + untracked), newline-separated, repo-relative
changed_source_files() {
  local repo="$1"
  { git -C "$repo" diff --name-only HEAD 2>/dev/null
    git -C "$repo" ls-files --others --exclude-standard 2>/dev/null
  } | sort -u | while read -r f; do
      [ -n "$f" ] && is_source_file "$f" && ! is_artifact_path "$f" && echo "$f"
    done
}

# Agent Journal — Design

Date: 2026-06-01
Status: implemented + registered. Suites green (journal 12, session-start 4, guardrail 32 incl. 2 journal). E2e verified: write→roll→next-session inject.

Note: bash writes ISO `ts`, Rust guardrail tap writes epoch-seconds `ts`. Both valid JSON; readers don't depend on ts format. Acceptable for v1.

## Goal

A shared append-only journal any agent (main session, spawned subagents, hooks) can write to and read from. Captures freeform notes, decisions, blockers, findings, handoffs so context is visible across agents within a session and resumable from the previous session. Third harness-engineering piece (after guardrail PreToolUse + test-agent Stop hook).

## Scope (v1)

1. `journal.sh` — flock-guarded JSONL write/read helper.
2. `journal-session-start.sh` — SessionStart hook: inject tail of previous session, roll the last-session pointer.
3. Auto-capture taps in existing hooks + test-agent persona.

## Non-goals (v1)

- Task state (that's the test-agent ledger — distinct store, see Boundary).
- Auto-rotation / pruning (v2).
- Cross-agent realtime push (pull + spawn-inject only).
- A queryable DB (JSONL + grep suffices).

## Boundary vs the test-agent ledger

- **Ledger** (`<repo>/.test-agent/ledger.json`): task STATE machine — todo→testing→passed/failed, per-repo. Answers "is X validated?"
- **Journal** (`~/.claude/agent-journal/<session>.jsonl`): freeform append-only STREAM — notes/decisions/blockers/findings/handoffs, global + session-scoped. Answers "what happened / what did agents notice?"
- No overlap. They coexist.

## Architecture — bash helper + JSONL + hook taps (Approach A)

Glue, not domain logic → bash, matching guardrail/test-agent style. No new deps (`jq`, `flock` already required).

```
hooks/journal.sh                 ← write | read (flock-guarded)
hooks/journal-session-start.sh   ← SessionStart: print prev-session tail, roll pointer
store (global):
  ~/.claude/agent-journal/<session_id>.jsonl   ← one entry per line
  ~/.claude/agent-journal/.last-session        ← pointer: most recent session_id
taps (edits to existing components):
  hooks/test-agent.sh            → log "spawned test-agent: <files>"
  hooks/guardrail (Rust)         → on deny/ask, append a journal line
  hooks/test-agent/prompt.md     → instruct spawned agent to journal findings/blockers
```

## Entry shape

One JSON object per line:
```json
{"ts":"<iso8601>","session":"<id>","agent":"<who>","tag":"<tag>","msg":"<text>"}
```
- `agent`: `main` | `test-agent` | `hook:stop` | `hook:pretooluse` (free string, these are conventions).
- `tag`: `note` | `decision` | `blocker` | `finding` | `handoff`.

## Session id resolution (the fragile bit)

Confirmed env var: **`CLAUDE_CODE_SESSION_ID`** (NOT `CLAUDE_SESSION_ID`). Set in the main Claude Code process.

Resolution order in `journal.sh`:
1. `--session <id>` explicit arg (hooks pass the stdin `session_id`).
2. `$CLAUDE_CODE_SESSION_ID` env.
3. `~/.claude/agent-journal/.last-session` file.
4. fallback literal `unknown`.

The test-agent dispatcher exports `CLAUDE_CODE_SESSION_ID` into the spawned agent's env so its `journal.sh` calls land in the same session file as the main session.

## `journal.sh` interface

```
journal.sh write <agent> <tag> "<msg>" [--session <id>]
    → append one JSONL entry (flock). Fail-open (errors silent, exit 0).

journal.sh read [--tail N] [--tag T] [--session ID] [--agent A]
    → print matching entries (default: resolved session, all entries).
      Human+machine readable (raw JSONL lines).

journal.sh path [--session ID]
    → print resolved jsonl path (debug/util).
```

## Data flow

- **Write:** agent → `journal.sh write main decision "chose bypassPermissions"` → flock-append.
- **On-demand read:** agent → `journal.sh read --tail 20` → recent context.
- **SessionStart inject:** `journal-session-start.sh`:
  1. read `.last-session` → prev id.
  2. if prev journal exists, print its last 15 entries to stdout (Claude Code injects as context).
  3. write current `CLAUDE_CODE_SESSION_ID` to `.last-session`.
  Exit 0 always. No prior session → print nothing.
- **Auto-capture:**
  - `test-agent.sh` on spawn → `journal.sh write hook:stop note "spawned test-agent: <files>" --session <id>`.
  - guardrail (Rust) on `deny`/`ask` → append a line (`tag=blocker` for deny, `note` for ask). Uses `CLAUDE_CODE_SESSION_ID` env; if unset, append to `.last-session` target. Fail-open.
  - test-agent persona → on bug/fail → `journal.sh write test-agent finding "<root cause>"`.

## Concurrency

`flock` on the target `.jsonl` (same pattern as `ledger.sh`). Append-only → minimal contention. Read uses shared lock.

## Error handling

- All journal ops fail-open: write error → silent, exit 0; never blocks a hook or agent.
- Missing `agent-journal/` dir → created on first write.
- SessionStart reader: no `.last-session` / missing file → prints nothing, exit 0.
- Malformed line on read → skipped (grep/jq tolerant).

## SessionStart hook registration

`settings.json` → `hooks.SessionStart` array: append a third entry (after cavemem + caveman-activate):
```json
{ "hooks": [ { "type": "command", "command": "bash ~/.claude/hooks/journal-session-start.sh", "timeout": 10 } ] }
```
Order: runs after existing two; its stdout adds journal context.

## Guardrail (Rust) tap

Add a fire-and-forget append in the guardrail binary when emitting `deny`/`ask`: write one JSONL line to the resolved session journal (env `CLAUDE_CODE_SESSION_ID` → else `.last-session` → else skip). Must stay fail-open and must NOT slow the PreToolUse path meaningfully (append + close). Rebuild required (`cargo build --release`).

## Testing (TDD)

- `journal.sh`: write creates file + valid JSONL; read `--tail`/`--tag`/`--agent` filters; session resolution order (arg > env > .last-session > unknown); flock concurrent appends don't corrupt (loop N background writes, assert N lines). Self-contained bash test w/ `TEST_JOURNAL_DIR` override.
- `journal-session-start.sh`: with a seeded prev session → prints its tail + rolls pointer; no prev → prints nothing, still rolls pointer.
- Guardrail tap: unit test that a deny/ask appends a line to a temp journal dir (inject dir via env).

## Open / future (v2+)

- Rotation/pruning (journals older than N days).
- `journal.sh read --since <ts>` time filter.
- Severity level on entries.
- Promote key findings into MEMORY.md automatically.

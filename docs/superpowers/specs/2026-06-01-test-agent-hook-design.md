# Test-Agent Hook — Design

Date: 2026-06-01
Status: implemented + registered (28 unit checks green; e2e dry-run caught a planted bug)

## Implementation note (deviation)

Spawn uses `--permission-mode bypassPermissions`, NOT `acceptEdits`. First dry-run with
`acceptEdits` let the agent write test files but BLOCKED Bash, so it could not run
`cargo test` or `ledger.sh` (ledger stuck at `todo`). `bypassPermissions` skips the
interactive prompt the headless agent cannot answer; the `PreToolUse` guardrail hook
still gates every command (defense intact). Second dry-run: agent ran `cargo test`,
marked ledger `failed`, wrote a root-cause report. Verified.

## Goal

On turn end, spawn a fresh background agent that writes aggressive tests for the code changed this turn, runs them, and records pass/fail in a shared task ledger. Tightens the feedback loop without freezing the session. Second piece of harness-engineering work (after the guardrail PreToolUse hook).

## Scope (v1)

1. `Stop` hook dispatcher — gates, then spawns a detached test agent.
2. Spawned agent — writes + runs aggressive tests, writes a report, updates ledger.
3. Task ledger — shared JSON contract between main session and test agent.

## Non-goals (v1)

- Editing non-test source (agent writes tests only, never patches impl).
- Auto-committing (agent never commits).
- Blocking the session (always fire-and-forget).
- Coverage % tracking / `stale` as a distinct state (stale handled by re-opening).

## Architecture — bash dispatcher + detached `claude -p` (Approach A)

Glue, not domain logic → bash, matching existing hook style (cavemem, tmux). No compile step.

```
hooks/test-agent.sh            ← Stop dispatcher: read stdin, gate, seed ledger, detach spawn
hooks/test-agent/
  prompt.md                    ← system-prompt persona for spawned agent (aggressive tester)
  ledger.sh                    ← flock-guarded read-modify-write helper for ledger.json
per-repo state (gitignored):
  <repo>/.test-agent/
    ledger.json                ← task ledger (the contract)
    .cooldown                  ← mtime = last spawn time
    agent.log                  ← spawned agent stdout/stderr
    report-<ts>.md             ← per-run report
```

## Trigger + execution

- Event: `Stop` (fires once per turn end). Stdin JSON: `cwd`, `session_id`, `transcript_path`.
- Execution: **fire-and-forget**. Hook launches `nohup claude -p ... &` detached, exits 0 immediately. Session never blocks.
- Model: `--model sonnet` (well-scoped job, cheap for near-every-turn).

## Gate chain (any fail → exit 0, no spawn)

1. **Recursion guard (MANDATORY):** `TEST_AGENT_SPAWN=1` in env → exit. Set when spawning, so the child agent's own `Stop` never re-spawns. Primary fork-bomb prevention.
2. **Repo gate:** `git -C <cwd> rev-parse --show-toplevel` fails → exit (skip scratch dirs).
3. **Code-changed gate:** `git -C <repo> diff --name-only HEAD` + untracked (`git ls-files --others --exclude-standard`), filtered to source extensions. Empty → exit.
4. **Cooldown gate:** `<repo>/.test-agent/.cooldown` mtime < 5 min ago → exit.

Source extensions (main stack): `.rs .tsx .ts .js .go .py .lua`

On pass: touch `.cooldown`, ensure `.test-agent/` exists, ensure `/.test-agent/` in repo `.gitignore`, seed/refresh ledger, capture `git diff` to a brief, spawn.

## Spawn command

```
TEST_AGENT_SPAWN=1 nohup claude -p "<brief: changed files + open task ids>" \
  --model sonnet \
  --append-system-prompt-file hooks/test-agent/prompt.md \
  --add-dir <repo> \
  > <repo>/.test-agent/agent.log 2>&1 &
```

(`--append-system-prompt-file` exists in this CLI version — `claude --help` shows `--append-system-prompt[-file]`. Verify the exact flag at implementation time; fall back to `--append-system-prompt "$(cat prompt.md)"` if needed.)

## Task ledger — the contract

`<repo>/.test-agent/ledger.json`: array of task objects.

```json
{
  "id": "t-<short>",
  "desc": "what's being built/changed",
  "files": ["src/foo.rs"],
  "status": "todo|testing|passed|failed",
  "createdBy": "hook|main",
  "createdAt": "<iso>",
  "validatedAt": "<iso|null>",
  "report": ".test-agent/report-<ts>.md | null",
  "notes": "failure summary / coverage gaps"
}
```

### Lifecycle

`todo` → (agent pickup) `testing` → `passed` | `failed`.
- `failed` stays open until fixed (root-cause signal — no symptom patching).
- **Stale:** on a new spawn, any `passed` task whose `files` reappear in the new diff flips back to `todo` (re-validate). No separate `stale` state.

### Who writes what

- **Hook (each spawn):** for each changed source file with no open (`todo`/`testing`/`failed`) task → append `todo` (`createdBy: hook`, `desc: "auto: changes in <file>"`). Re-open stale `passed`. Pass open task ids in the brief.
- **Main session:** on explicit intent ("working on X") → append precise `todo` (`createdBy: main`, real desc) so agent validates intent, not just filenames.
- **Spawned agent:** `todo→testing` on pickup; write tests; run; mark `passed`/`failed`; link `report`; fill `notes`.

### Concurrency

All writes go through `hooks/test-agent/ledger.sh` — `flock` on `ledger.json`, atomic read-modify-write. Subcommands: `add`, `set-status <id> <status>`, `list-open`, `reopen-stale <file...>`. Hook, main session, and agent all use it. Bash chosen over a Rust subcommand: orchestration glue, not hot-path/domain logic.

## Spawned agent job (persona = prompt.md)

Given diff + open task ids:
1. For each open task → mark `testing`.
2. Write aggressive tests: edge cases, boundaries, failure modes, concurrency where relevant (mirrors irondev-review ethos).
3. Run them with the repo's test runner (detect: `cargo test`, `bun test`/`npm test`, `go test`, `pytest`, lua busted).
4. Mark `passed` (all green) / `failed` (red). Link report, fill notes (gaps, tests that couldn't pass).
5. Write `report-<ts>.md`: what tested, pass/fail, coverage gaps, root-cause hints for failures.

Constraints: writes test files only; never edits impl; never commits; never disables the guardrail.

## Error handling

- Any gate error → exit 0 (fail-open; never block `Stop`).
- No `claude` binary → exit 0 + log line.
- Spawn failure → logged to `agent.log`; session unaffected.
- Malformed/empty stdin → exit 0.

## Recursion safety (defense in depth)

1. `TEST_AGENT_SPAWN=1` env guard (primary).
2. Cooldown 5 min (caps spawn rate even if guard fails).
3. `--model sonnet` + detached (limits blast cost).

## Interaction with guardrail hook

Spawned agent inherits the same `PreToolUse` guardrail (good — its tool calls are gated too). `/.test-agent/` gitignored → guardrail's protected-path/commit checks unaffected; agent told never to commit or touch settings/hooks.

## Open / future (v2+)

- Coverage % + `stale` as explicit state.
- MCP tool for richer main-session ledger writes (vs CLI).
- Slack/desktop notify on `failed`.
- Promote validated tests into a PR.

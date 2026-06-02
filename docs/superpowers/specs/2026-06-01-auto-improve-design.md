# Auto-Improve (Harness Self-Improvement) — Design

Date: 2026-06-01
Status: implemented + registered. Suites green (capture-correction 9, gates 6). E2e verified: seeded 3× force-push blocker → reflector proposed a CLAUDE.md rule (propose-only, correct dedup vs existing guardrail).

## Goal

A periodic reflector that mines the agent journal, test-agent ledgers, and your corrections for recurring patterns, then proposes harness improvements (CLAUDE.md rules, guardrail tiers, hooks, skills) into a review queue. Propose-only: never mutates the harness itself. Fourth harness-engineering piece — the harness improving the harness.

## Scope (v1)

1. `improve.sh` — SessionEnd dispatcher: gate, spawn detached reflector.
2. `improve/prompt.md` — reflector persona (read signals → propose, dedup).
3. `improve/capture-correction.sh` — log a correction to the journal (tag `correction`) + bump a counter.
4. Corrections counter — running tally for tracking.
5. `/improve` command — manual trigger of the same reflector.
6. Review queue — `~/.claude/improvements/pending.md`.

## Non-goals (v1)

- Auto-applying any change (propose-only; you apply via the normal build flow).
- Editing project source (that's a future test→fix loop, not this).
- A DB (journal JSONL + markdown queue + a small JSON counter suffice).

## Signals (all four feed the reflector)

| Signal | Source | Already captured? |
|---|---|---|
| Journal patterns | `~/.claude/agent-journal/*.jsonl` | yes (journal hook) |
| Guardrail ask/deny stats | journal entries `agent=hook:pretooluse` | yes (guardrail tap) |
| Test-agent failures | journal `agent=test-agent tag=finding` + `<repo>/.test-agent/ledger.json` | yes |
| Your corrections | journal `tag=correction` + counter | NEW (this spec) |

## Architecture — SessionEnd dispatcher + detached reflector + manual command (Approach A)

Mirrors the test-agent hook. Glue = bash; reasoning = spawned `claude -p`.

```
hooks/improve.sh                    ← SessionEnd dispatcher (gate, detached spawn)
hooks/improve/
  prompt.md                         ← reflector persona
  capture-correction.sh            ← journal write (tag=correction) + counter bump
state (global):
  ~/.claude/improvements/
    pending.md                      ← review queue (proposals accrue)
    applied.md                      ← log of applied/dismissed (dedup source)
    corrections.json                ← {total, byCategory:{...}, lastTs}
    .cooldown, reflector.log
commands/improve.md                 ← /improve manual trigger
```

## Corrections counter

`~/.claude/improvements/corrections.json`:
```json
{ "total": 0, "byCategory": { "<cat>": 0 }, "lastTs": "<iso>" }
```
- `capture-correction.sh "<category>" "<note>"`:
  1. journal write `main correction "<category>: <note>"`.
  2. flock-bump `corrections.json`: `total += 1`, `byCategory[category] += 1`, set `lastTs`.
- Category = free string (e.g. `git`, `style`, `scope`, `tooling`). Lets the reflector + you see *what kind* of corrections recur.
- Main session (me) calls it when you correct me. Also callable manually.

## Dispatcher gate chain (any fail → exit 0, fail-open)

1. **Recursion guard:** `IMPROVE_SPAWN=1` in env → exit (reflector's own SessionEnd must not re-spawn).
2. **Cooldown:** `~/.claude/improvements/.cooldown` mtime < 6h ago → exit. (`IMPROVE_COOLDOWN` secs override.)
3. **Signal-present gate:** if no journal entries since last run AND corrections.json unchanged → exit (nothing to reflect on).

On pass: touch cooldown, spawn.

## Spawn

```
IMPROVE_SPAWN=1 CLAUDE_CODE_SESSION_ID="$CLAUDE_CODE_SESSION_ID" \
nohup claude -p "<brief: paths to journal dir, improvements dir, recurrence threshold=3>" \
  --model sonnet \
  --append-system-prompt "$(cat hooks/improve/prompt.md)" \
  --add-dir "$HOME/.claude" \
  --permission-mode bypassPermissions \
  >> ~/.claude/improvements/reflector.log 2>&1 &
```
(`bypassPermissions` so it can read files + append the queue; guardrail PreToolUse still gates every command. Reflector is told it may ONLY write under `~/.claude/improvements/`.)

## Reflector job (persona = prompt.md)

1. Read signals: journal (recent N sessions), `corrections.json`, ledgers under known repos, and current harness (`CLAUDE.md`, `rules/`, guardrail tier table, existing `pending.md` + `applied.md`).
2. Find patterns recurring **≥3 times**: same blocker repeated, correction themes (use counter categories), repeated test-failure shapes, guardrail asks always-approved (→ propose demote), patterns never firing (→ propose prune).
3. Dedup against `pending.md` + `applied.md` — never re-propose an open/handled item.
4. Append each new proposal to `pending.md`:
```
## <date> — <title>
- signal: <what fired, count, evidence (journal lines / counter)>
- target: CLAUDE.md | rules/*.md | guardrail tier | skill | hook
- proposal: <concrete change>
- suggested diff/snippet: <...>
- risk: low|med|high
- status: pending
```
5. Constraints: writes ONLY under `~/.claude/improvements/`. NEVER edits harness files, settings, hooks, guardrail, CLAUDE.md, rules. NEVER commits. Journal a one-line summary (`agent=reflector tag=note "proposed N improvements"`).

## `/improve` command

`commands/improve.md` — manual trigger. Runs the same dispatcher logic ignoring cooldown (force), so you can reflect on demand. Output: path to updated `pending.md` + count of new proposals.

## Applying proposals (your loop)

You review `pending.md`. To apply: hand the file (or an entry) to me → I implement via the normal brainstorm/plan/build flow → move the entry to `applied.md` (status applied|dismissed). `applied.md` is the dedup memory so the reflector won't resurface it.

## Error handling

- All ops fail-open: dispatcher exit 0 on any error; counter/journal writes swallow errors.
- No `claude` binary → exit 0 + log.
- Missing dirs → created.
- Reflector errors → logged to `reflector.log`, session unaffected.

## Concurrency

`corrections.json` bumped under `flock` (same pattern as ledger/journal). `pending.md` appended by a single reflector at a time (cooldown + recursion guard make concurrent reflectors unlikely; append is atomic enough for markdown).

## Registration

`settings.json` → `hooks.SessionEnd` array: append a second entry (after cavemem session-end):
```json
{ "hooks": [ { "type": "command", "command": "bash ~/.claude/hooks/improve.sh", "timeout": 15 } ] }
```

## Testing (TDD)

- `capture-correction.sh`: writes a journal `correction` line; bumps `corrections.json` total + category; flock concurrency (N parallel bumps → total==N). `TEST_JOURNAL_DIR` + `IMPROVE_DIR` overrides.
- `improve.sh` gates: recursion guard blocks; cooldown blocks 2nd run; no-signal blocks; pass path touches cooldown + invokes spawn stub (`IMPROVE_SPAWN_CMD` override, like test-agent).
- `/improve`: forces past cooldown.

## Open / future (v2+)

- Tiered auto-apply for low-risk proposals (add MEMORY.md learning) — currently propose-only.
- Reflector promotes accepted proposals into MEMORY.md automatically.
- Correction-counter dashboard in statusline.
- Time-window signal queries (`--since`).

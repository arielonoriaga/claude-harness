---
description: Force a harness self-improvement reflection now (ignores the 6h cooldown), then review/accept/deny/iterate proposals.
---

Manage the harness improvement queue (`~/.claude/improvements/pending.json`). The reflector
proposes; you decide. Queue CLI: `~/.claude/hooks/improve/queue.sh`.

If the user asked to *generate* fresh proposals (or said "run improve"/"reflect now"):

1. Force the reflector past the cooldown:
   ```bash
   IMPROVE_COOLDOWN=0 bash ~/.claude/hooks/improve.sh < /dev/null
   ```
   It spawns detached and appends objects to `pending.json`.
2. Wait ~60-90s, then show the queue + reflector log tail:
   ```bash
   bash ~/.claude/hooks/improve/queue.sh list
   tail -10 ~/.claude/improvements/reflector.log 2>/dev/null
   ```

Otherwise (review existing queue), start by listing:
```bash
bash ~/.claude/hooks/improve/queue.sh list
```

Interactive triage (terminal, not in-session): tell the user to run `!bash
~/.claude/hooks/improve/queue.sh browse` — a ratatui TUI (`hooks/improve-tui`, Rust) with
tabs (Pending/Done/All), colored risk+status, scrollable detail pane, a deny-reason modal, and
async iterate spinner. Keybinds: `Tab` switch · `j/k` move · `J/K` scroll · `a` accept · `d` deny
· `i` iterate · `x` apply · `w`/`Enter` **work** · `q` quit. `w` (work) = accept the
selected suggestion, quit, and print it to stdout — since `browse` runs via `!`, that lands in
THIS chat, so when the user `w`s a suggestion you receive `WORK ON: <id>` + its full detail and
should implement it immediately, then run `queue.sh apply <id>`. (`i` iterate only *refines the
proposal text* via the reflector — it does not write code.) It only READS the JSON and shells out to this same queue.sh
for every mutation (one source of truth). If the binary is missing it prints the build command:
`(cd ~/.claude/hooks/improve-tui && cargo build --release)`. Building accepted proposals still
comes back to you/this flow.

Then per the user's choice, act with the queue CLI (always `show` first so the user sees the
WHY — the `signal` field — before deciding):

- `queue.sh show <id>` — full proposal incl signal (why it exists) + snippet
- `queue.sh accept <id>` — mark accepted; then implement it via the normal brainstorm/plan/build
  flow. When the build lands, run `queue.sh apply <id>` to retire it to `applied.json`.
- `queue.sh deny <id> "<reason>"` — dismiss; moves to `applied.json` with the reason (dedup source).
- `queue.sh iterate <id>` — re-run the reflector on just that proposal to sharpen it in place.

Summarize the new/changed proposals for the user and ask which to accept, deny, or iterate.
The statusline shows the live pending count as `⚑N`.

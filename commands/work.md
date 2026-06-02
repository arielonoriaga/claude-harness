---
description: Build the harness improvement proposals you accepted in the TUI (status=accepted), one by one, then retire them.
---

Pick up proposals marked `accepted` (via the TUI `w` key or `queue.sh accept`) and implement them.

1. List what's waiting:
   ```bash
   bash ~/.claude/hooks/improve/queue.sh list accepted
   ```
   If none, tell the user the accept queue is empty (they accept via `queue.sh browse` → `w`, or `queue.sh accept <id>`), and stop.

2. For each accepted id, show full detail (so you have the signal + proposal + snippet):
   ```bash
   bash ~/.claude/hooks/improve/queue.sh show <id>
   ```

3. Implement it via the normal brainstorm/plan/build flow — fix the root cause at the
   stated `target`, write/adjust tests alongside, verify (build + tests green) before claiming done.
   The `snippet` is a hint, not gospel; harden it.

4. When the change is verified, retire the proposal:
   ```bash
   bash ~/.claude/hooks/improve/queue.sh apply <id>
   ```

5. If a proposal turns out to be wrong/unwanted while building, dismiss instead:
   ```bash
   bash ~/.claude/hooks/improve/queue.sh deny <id> "<reason>"
   ```

Process them oldest-first. Summarize what you built + applied at the end. The statusline `⚑`
count drops as you retire each one.

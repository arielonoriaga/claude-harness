# claude-harness

A self-built agent harness for [Claude Code](https://claude.com/claude-code) — the
hooks, gates, and feedback loops that wrap the model and make a long session safer,
more observable, and self-improving.

The core idea: **the harness improves the harness.** Sessions emit signals (blocked
commands, test failures, your corrections); a reflector mines them and proposes
concrete harness changes you triage from a TUI.

> Not affiliated with Anthropic. Bring-your-own conventions — everything here is a
> starting point to fork, not a framework to obey.

## Components

| Piece | Hook | What it does |
|-------|------|--------------|
| **guardrail** (Rust) | `PreToolUse` | Gates dangerous tool calls (destructive `rm`, force-push to main, non-conventional commits, writes to protected dirs). Fail-open. |
| **journal** (Rust+bash) | `SessionStart` | Shared JSONL bus across agents+sessions. Prior session injected on start; any agent reads/writes notes, decisions, blockers, handoffs. |
| **test-agent** (bash) | `Stop` | Spawns a detached agent to write+run aggressive tests on the files you changed. Skips build artifacts. Cooldown + dedup. |
| **auto-improve** (bash + reflector) | `SessionEnd` | Mines journal/corrections/test-ledgers for patterns recurring ≥3×, proposes harness improvements (propose-only) to a JSON queue. |
| **improve-tui** (Rust/ratatui) | — | Interactive queue: tabs (pending/done/all), colored risk+status, scrollable detail, deny modal, async iterate, and a **work** key that hands a proposal back to Claude to implement. |
| **caveman** (node) | `UserPromptSubmit` etc. | Optional ultra-compressed communication mode + token stats. |
| **statusline** (bash) | — | Model · effort · context % · tokens · rate limits · `⟲` corrections · `⚑` pending proposals · git. |

The improvement queue's single source of truth is `hooks/improve/queue.sh`
(`pending.json`/`applied.json`). The TUI only reads the JSON for display and shells
out to `queue.sh` for every mutation — no logic is duplicated.

## Requirements

- [Claude Code](https://claude.com/claude-code)
- `cargo` (Rust) — builds guardrail + improve-tui
- `jq`
- `node` (for the caveman hooks; skip those hooks if you don't want them)

## Install

```bash
git clone <this-repo> claude-harness
cd claude-harness
CLAUDE_HOME=~/.claude ./setup.sh
```

`setup.sh` builds both binaries, then writes `settings.json` + `CLAUDE.md` from the
`.example` templates (it won't overwrite existing ones — it prints what to merge).
Restart Claude Code to load the hooks.

## Guardrail identity policy

The git-identity check is configured entirely by env (no identities are baked in).
Set these in your `settings.json` `"env"` block or your shell:

| Var | Meaning |
|-----|---------|
| `GUARDRAIL_WORK_PREFIX` | Path prefix mapping to the *work* identity. Empty = disabled. |
| `GUARDRAIL_WORK_NAME` / `GUARDRAIL_WORK_EMAIL` | Identity expected under that prefix. |
| `GUARDRAIL_PERSONAL_NAME` / `GUARDRAIL_PERSONAL_EMAIL` | Identity expected everywhere else. |
| `CLAUDE_HOME` | Config dir the guardrail protects from destructive ops (default `~/.claude`). |

## Triage proposals

```bash
bash hooks/improve/queue.sh browse   # ratatui TUI
# or, from inside Claude Code:
/improve
```

Keys: `Tab` switch · `j/k` move · `J/K` scroll · `a` accept · `d` deny · `i` iterate
(refine the proposal text via the reflector) · `x` apply · `w`/`Enter` **work** · `q` quit.

`w` (work) accepts the proposal and copies a ready-to-paste build prompt to your clipboard
(`wl-copy`/`xclip`/`pbcopy`). Two ways to hand it to Claude:

- **Separate terminal:** press `w`, then in Claude Code either paste the clipboard, or run
  `/work` — which builds every `accepted` proposal in turn and retires each with `queue.sh apply`.
- **Inside Claude Code** (`!bash hooks/improve/queue.sh browse`): `w` also prints the proposal to
  stdout, which lands directly in the conversation.

## Tests

```bash
(cd hooks/guardrail && cargo test)
(cd hooks/improve-tui && cargo test)
bash hooks/improve/queue.test.sh
bash hooks/test-agent/lib.test.sh
node --test hooks/   # caveman hook tests
```

## License

MIT — see [LICENSE](LICENSE).

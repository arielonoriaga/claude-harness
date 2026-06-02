# Claude Code Instructions (template)

Copy to `CLAUDE.md` and adapt. This documents the conventions the harness in this
repo expects. Everything here is yours to change.

## Harness (self-built hooks)
Hooks are machine-enforced; the behaviors below are conventions for the model.
- **Corrections capture:** when you correct or reject the model's work, it runs
  `bash <CLAUDE_HOME>/hooks/improve/capture-correction.sh <category> "<note>"`
  (categories: git|style|scope|tooling|perf|arch|...). Feeds the SessionEnd reflector
  and the statusline `⟲` counter.
- **Journal:** shared JSONL bus across agents+sessions.
  Read: `bash <CLAUDE_HOME>/hooks/journal.sh read --tail 20`.
  Write: `bash <CLAUDE_HOME>/hooks/journal.sh write main <tag> "<msg>"`
  (tags: note|decision|blocker|finding|handoff|correction).
- **Guardrail etiquette:** respect PreToolUse ask/deny — don't fight, retry verbatim,
  or route around. Adjust instead. `GUARDRAIL_OFF=1` only when you explicitly want to bypass.
- **Hook map:** PreToolUse=guardrail (gate dangerous calls) · Stop=test-agent (spawn tester) ·
  SessionStart=journal inject · SessionEnd=auto-improve reflector.

## Git
- Conventional Commits.
- No `Co-authored-by` trailers (optional preference).
- Configure the guardrail's identity policy via env (see README → Guardrail identity):
  `GUARDRAIL_WORK_PREFIX`, `GUARDRAIL_WORK_EMAIL`, `GUARDRAIL_PERSONAL_EMAIL`, etc.

## Code Style (example preferences — edit freely)
- Fix root causes, not symptoms.
- Minimum complexity for the task at hand; no speculative abstraction.
- Tests alongside or before implementation.

## Improvement queue
- The reflector proposes harness improvements at session end (propose-only).
- Review/triage: `bash <CLAUDE_HOME>/hooks/improve/queue.sh browse` (ratatui TUI) or `/improve`.

# Guardrail Hooks — Design

Date: 2026-05-31
Status: implemented + registered (35 tests pass, security-reviewed)

## Goal

Machine-enforced guardrails on every tool call via `PreToolUse` hook. Deterministic, runs every time, no model discretion. Fills gap left by `skipDangerousModePermissionPrompt: true` + `skipAutoPermissionPrompt: true` + `defaultMode: auto` — no human gate currently catches bad tool calls.

## Scope (v1)

1. **Dangerous bash block** — block destructive shell commands.
2. **Protected paths** — guard edits to harness self-config.
3. **Commit / package-manager discipline** — Conventional Commits + bun>pnpm>npm.
4. **Git identity by cwd** — right git identity for the directory.

Enforcement model: **tiered** (catastrophic → deny, borderline → ask, ok → allow).
Failure model: **fail-open** (hook crash/timeout/malformed input → allow + stderr log; never brick session).

## Non-goals (v1)

- Secret-file protection (deferred; may be v2).
- Observability/logging dashboard.
- Context injection (caveman hooks already cover SessionStart/UserPromptSubmit).

## Architecture — single Rust binary (Approach A)

One compiled binary registered once on `PreToolUse` matcher `*`. Pure check fns; impure context (cwd/git/fs) injected so checks stay unit-testable.

```
hooks/guardrail/
  Cargo.toml
  src/
    main.rs       ← read stdin JSON, build Ctx, evaluate, emit decision JSON, fail-open
    checks.rs     ← pure check fns (bash, pkg-mgr, commit, identity, paths) + decide() + tier
    ctx.rs        ← impure: resolve repo root, git config email, bun.lock present, expected identity by cwd
  target/release/guardrail   ← built binary (settings.json points here)
```

Deps: `serde_json` (stdin parse / decision emit), `regex` (patterns). Build: `cargo build --release`. Rebuild required after src edits. Tests: `cargo test` (fixtures inline in `#[cfg(test)]`).

## Data flow

1. CC fires `PreToolUse` → stdin JSON (`tool_name`, `tool_input`, `cwd`).
2. `main.rs` reads stdin, builds `Ctx`, routes to relevant checks:
   - `Bash` → bash + commit + identity checks
   - `Edit` / `Write` / `NotebookEdit` → paths check
   - other tools → allow
3. Each check returns `{tier, reason}` where tier ∈ `catastrophic | borderline | ok`.
4. `decide()` picks WORST tier across checks → emits PreToolUse JSON wrapped in `hookSpecificOutput` (`hookEventName: "PreToolUse"`):
   - catastrophic → `permissionDecision: "deny"` + `permissionDecisionReason`
   - borderline → `permissionDecision: "ask"` + `permissionDecisionReason`
   - ok → print nothing, exit 0 (= defer to normal permission flow; NOT explicit "allow", which would bypass all other checks)
5. Escape hatch: env `GUARDRAIL_OFF=1` → allow all + stderr log line.

## Tier table (v1)

```
catastrophic (deny):
  rm -rf /|~|$HOME (and bare / variants)
  git push --force / --force-with-lease onto main|master
  git reset --hard with uncommitted changes
  dd of=/dev/...
  curl ... | sh   (and wget|sh)
  fork bomb  :(){ :|:& };:

borderline (ask):
  chmod 777
  edit settings.json | settings.local.json | hooks/** | CLAUDE.md | rules/**
  npm install / pnpm install when bun.lock present in repo
  git push (ANY) — public/irreversible step we gate
  git commit/push --no-verify (and bare -n on commit) — bypasses git hooks

DROPPED 2026-06-01 (commits flow without prompts — user: "allow commits, prevent push"):
  - conventional-commit message check (check_commit) — unwired, kept #[allow(dead_code)]
  - git-identity-by-cwd check (check_identity) — unwired, kept #[allow(dead_code)]
  git push tier changed: plain push catastrophic→borderline; only --force onto main/master stays deny.

ok (allow):
  everything else
```

## Git identity (single source of truth = path→identity map)

```
work path:  $GUARDRAIL_WORK_PREFIX/** → work identity (GUARDRAIL_WORK_NAME / GUARDRAIL_WORK_EMAIL)
else:       personal identity (GUARDRAIL_PERSONAL_NAME / GUARDRAIL_PERSONAL_EMAIL)
```

On `git commit` (Bash): resolve repo root from cwd, read `git config user.email`, compare to expected-for-cwd. Mismatch → ask + reason: run `git config user.email <expected>` first.

## Error handling

- Panic / error → `catch_unwind` + `Result` → emit `allow` + stderr log. Fail-open. Never brick session.
- Hook timeout → CC treats as non-blocking; binary startup ~1-5ms.
- Malformed / empty stdin → allow.
- Unknown tool → allow.
- `GUARDRAIL_OFF=1` → allow all (logged).

## Testing (TDD)

- Each check fn pure: `(cmd/path, &Ctx) → Tier`. No I/O inside checks; `Ctx` carries injected closures/values (git email, bun.lock present, expected identity).
- Inline `#[cfg(test)]` fixtures per pattern.
- `cargo test`. Write failing test first, then implement.
- Coverage: every catastrophic + borderline row has ≥1 positive test and ≥1 negative (must-allow) test.

## Registration

Add to `settings.json` `hooks.PreToolUse` (new key — none today). Points at built binary:

```json
"PreToolUse": [
  { "hooks": [ { "type": "command", "command": "~/.claude/hooks/guardrail/target/release/guardrail", "timeout": 5 } ] }
]
```

## Security review fixes (applied)

`iron-security-review` adversarial pass found and fixed before going live:
- C1: `rm -rf /home/me`, `/etc`, `/usr`, … passed through — `targets_root` only matched bare `/`. Now dequote+normalize token scan vs danger set (root, system dirs, whole home dirs); deep work paths stay allowed.
- C2/C3: `rm -rf ~/` and `$HOME/` (trailing slash) passed — normalization strips trailing `/` and `/*`.
- C4: quoted `rm -rf "/"` passed — normalization strips quotes.
- C5: `git -C /path push --force origin main` bypassed `\bgit\s+push\b` — now per-segment match `\bgit\b.*\bpush\b`.
- D1: `git commit -am "junk"` bypassed commit-msg check — extractor now handles combined short flags + `--message=`.
- D2: byte-indexed extractor panicked on multibyte char before `-m` — rewritten with a quote-aware char-based tokenizer.
- Cross-segment contamination (e.g. `rm -rf ./build && echo /`): `check_bash` now splits on `;`,`&&`,`||`,`&`,newline (not single `|`) and takes worst tier per segment.

Gotcha recorded: the `regex` crate has **no backreference support** — the original `-m "..."` extractor used `\1`, failed to compile, returned None, and silently disabled the commit check. Caught by the one negative test.

## Open / future (v2+)

- Secret-file protection.
- PostToolUse auto quality gates (format/lint/test).
- Logging/observability + audit trail of allowed decisions.
- Perf: lazy-compile regexes (`LazyLock`) instead of per-call `Regex::new`; `GIT_OPTIONAL_LOCKS=0` on `git status`. Fast enough for v1 (~ms).

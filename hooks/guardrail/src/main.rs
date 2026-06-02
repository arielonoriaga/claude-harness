mod checks;
mod ctx;
mod journal;

use std::io::Read;

/// Emit a PreToolUse decision and exit. `ask`/`deny` only — `ok` prints nothing.
fn emit(permission: &str, reason: &str) {
    let out = serde_json::json!({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": permission,
            "permissionDecisionReason": reason,
        }
    });
    println!("{}", out);
}

fn run() -> Result<(), Box<dyn std::error::Error>> {
    // Escape hatch — never gets in the way of a power user.
    if std::env::var("GUARDRAIL_OFF").as_deref() == Ok("1") {
        eprintln!("[guardrail] GUARDRAIL_OFF=1 — all checks bypassed");
        return Ok(());
    }

    let mut raw = String::new();
    std::io::stdin().read_to_string(&mut raw)?;
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(()); // nothing to inspect → defer
    }

    let payload: serde_json::Value = serde_json::from_str(raw)?;
    let tool = payload.get("tool_name").and_then(|v| v.as_str()).unwrap_or("");
    let empty = serde_json::json!({});
    let input = payload.get("tool_input").unwrap_or(&empty);
    let cwd = payload
        .get("cwd")
        .and_then(|v| v.as_str())
        .unwrap_or("/tmp");

    let context = ctx::build(cwd);
    let decision = checks::evaluate(tool, input, &context);

    match decision.permission {
        "deny" => {
            journal::append("hook:pretooluse", "blocker", &decision.reason);
            emit(decision.permission, &decision.reason);
        }
        "ask" => {
            journal::append("hook:pretooluse", "note", &decision.reason);
            emit(decision.permission, &decision.reason);
        }
        _ => {} // ok → defer silently
    }
    Ok(())
}

fn main() {
    // Fail-open: any panic or error → allow (print nothing), log to stderr.
    let result = std::panic::catch_unwind(|| run());
    match result {
        Ok(Ok(())) => {}
        Ok(Err(e)) => eprintln!("[guardrail] error (failing open): {}", e),
        Err(_) => eprintln!("[guardrail] panic (failing open)"),
    }
    std::process::exit(0);
}

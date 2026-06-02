use std::io::Write;

/// Resolve the journal dir: $TEST_JOURNAL_DIR else $HOME/.claude/agent-journal.
fn dir() -> Option<std::path::PathBuf> {
    if let Ok(d) = std::env::var("TEST_JOURNAL_DIR") {
        return Some(std::path::PathBuf::from(d));
    }
    std::env::var("HOME")
        .ok()
        .map(|h| std::path::PathBuf::from(h).join(".claude/agent-journal"))
}

/// Resolve session id: $CLAUDE_CODE_SESSION_ID else <dir>/.last-session else None.
fn session(d: &std::path::Path) -> Option<String> {
    if let Ok(s) = std::env::var("CLAUDE_CODE_SESSION_ID") {
        if !s.is_empty() {
            return Some(s);
        }
    }
    std::fs::read_to_string(d.join(".last-session"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn json_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            _ => o.push(c),
        }
    }
    o
}

/// Append one journal entry. Fail-open: any error is swallowed.
pub fn append(agent: &str, tag: &str, msg: &str) {
    let _ = try_append(agent, tag, msg);
}

fn try_append(agent: &str, tag: &str, msg: &str) -> std::io::Result<()> {
    let d = match dir() {
        Some(d) => d,
        None => return Ok(()),
    };
    let sess = match session(&d) {
        Some(s) => s,
        None => return Ok(()), // no session context → skip silently
    };
    std::fs::create_dir_all(&d)?;
    let line = format!(
        "{{\"ts\":\"{}\",\"session\":\"{}\",\"agent\":\"{}\",\"tag\":\"{}\",\"msg\":\"{}\"}}\n",
        epoch(),
        json_escape(&sess),
        json_escape(agent),
        json_escape(tag),
        json_escape(msg),
    );
    let mut f = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(d.join(format!("{}.jsonl", sess)))?;
    f.write_all(line.as_bytes())?;
    Ok(())
}

fn epoch() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    match SystemTime::now().duration_since(UNIX_EPOCH) {
        Ok(t) => format!("{}", t.as_secs()),
        Err(_) => "0".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_writes_one_line() {
        let tmp = std::env::temp_dir().join(format!("gj-test-{}", epoch()));
        std::env::set_var("TEST_JOURNAL_DIR", &tmp);
        std::env::set_var("CLAUDE_CODE_SESSION_ID", "rs-sess");
        append("hook:pretooluse", "blocker", "denied rm -rf /");
        let f = tmp.join("rs-sess.jsonl");
        let content = std::fs::read_to_string(&f).unwrap();
        assert!(content.contains("\"agent\":\"hook:pretooluse\""));
        assert!(content.contains("\"tag\":\"blocker\""));
        assert!(content.contains("denied rm -rf /"));
        assert_eq!(content.lines().count(), 1);
        std::env::remove_var("TEST_JOURNAL_DIR");
        std::env::remove_var("CLAUDE_CODE_SESSION_ID");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn append_skips_without_session() {
        let tmp = std::env::temp_dir().join(format!("gj-test-ns-{}", epoch()));
        std::env::set_var("TEST_JOURNAL_DIR", &tmp);
        std::env::remove_var("CLAUDE_CODE_SESSION_ID");
        append("hook:pretooluse", "note", "x");
        assert!(!tmp.join("unknown.jsonl").exists());
        std::env::remove_var("TEST_JOURNAL_DIR");
        let _ = std::fs::remove_dir_all(&tmp);
    }
}

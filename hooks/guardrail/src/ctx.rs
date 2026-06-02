use crate::checks::{Ctx, Identity};
use std::env;
use std::path::PathBuf;
use std::process::Command;

fn env_or(key: &str, default: &str) -> String {
    env::var(key).ok().filter(|v| !v.is_empty()).unwrap_or_else(|| default.to_string())
}

/// Git-identity policy, resolved from env (no PII baked in).
///   GUARDRAIL_WORK_PREFIX   path prefix that maps to the work identity ("" = disabled)
///   GUARDRAIL_PERSONAL_NAME / GUARDRAIL_PERSONAL_EMAIL
///   GUARDRAIL_WORK_NAME     / GUARDRAIL_WORK_EMAIL
struct IdConfig {
    work_prefix: String,
    personal: Identity,
    work: Identity,
}

impl IdConfig {
    fn from_env() -> IdConfig {
        IdConfig {
            work_prefix: env_or("GUARDRAIL_WORK_PREFIX", ""),
            personal: Identity {
                name: env_or("GUARDRAIL_PERSONAL_NAME", "me"),
                email: env_or("GUARDRAIL_PERSONAL_EMAIL", "me@example.com"),
            },
            work: Identity {
                name: env_or("GUARDRAIL_WORK_NAME", "work"),
                email: env_or("GUARDRAIL_WORK_EMAIL", "work@example.com"),
            },
        }
    }
}

/// Pure path → identity resolution. When no work prefix is configured, or the
/// path is outside it, the personal identity applies.
fn resolve(cfg: &IdConfig, cwd: &str) -> Identity {
    if !cfg.work_prefix.is_empty() && cwd.starts_with(&cfg.work_prefix) {
        cfg.work.clone()
    } else {
        cfg.personal.clone()
    }
}

fn expected_for(cwd: &str) -> Identity {
    resolve(&IdConfig::from_env(), cwd)
}

/// Guardrail's own config dir, protected from destructive ops.
/// Override with CLAUDE_HOME; defaults to ~/.claude.
fn config_root() -> String {
    let base = env::var("CLAUDE_HOME")
        .ok()
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| format!("{}/.claude", env_or("HOME", "/root")));
    if base.ends_with('/') {
        base
    } else {
        format!("{base}/")
    }
}

fn git_in(cwd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(cwd)
        .args(args)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn repo_root(cwd: &str) -> PathBuf {
    git_in(cwd, &["rev-parse", "--show-toplevel"])
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(cwd))
}

fn has_bun_lock(cwd: &str) -> bool {
    let root = repo_root(cwd);
    root.join("bun.lock").exists() || root.join("bun.lockb").exists()
}

fn uncommitted(cwd: &str) -> Option<bool> {
    // None when git fails entirely (not a repo / error) → unknown → fail open.
    git_in(cwd, &["status", "--porcelain"]).map(|s| !s.is_empty())
}

/// Build the injected context for a given working directory.
pub fn build(cwd: &str) -> Ctx {
    Ctx {
        git_email: git_in(cwd, &["config", "user.email"]),
        has_bun_lock: has_bun_lock(cwd),
        uncommitted: uncommitted(cwd),
        expected: expected_for(cwd),
        config_root: config_root(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> IdConfig {
        IdConfig {
            work_prefix: "/work/acme/".into(),
            personal: Identity { name: "me".into(), email: "me@example.com".into() },
            work: Identity { name: "acme".into(), email: "dev@acme.test".into() },
        }
    }

    #[test]
    fn resolve_work_path_uses_work_identity() {
        assert_eq!(resolve(&cfg(), "/work/acme/service-x").email, "dev@acme.test");
    }

    #[test]
    fn resolve_outside_prefix_uses_personal() {
        assert_eq!(resolve(&cfg(), "/home/me/blog").email, "me@example.com");
        assert_eq!(resolve(&cfg(), "/tmp").email, "me@example.com");
    }

    #[test]
    fn resolve_empty_prefix_always_personal() {
        let mut c = cfg();
        c.work_prefix = String::new();
        assert_eq!(resolve(&c, "/work/acme/service-x").email, "me@example.com");
    }

    #[test]
    fn config_root_has_trailing_slash() {
        assert!(config_root().ends_with('/'));
    }
}

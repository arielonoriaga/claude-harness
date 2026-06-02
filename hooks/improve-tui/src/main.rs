// improve-tui — ratatui front-end for the harness improvement queue.
//
// Design: queue.sh is the SINGLE source of truth. This binary only READS
// pending.json/applied.json for display and SHELLS OUT to queue.sh for every
// mutation (accept/deny/apply/iterate). No JSON-write logic lives here, so the
// schema + flock + dedup rules never drift between the two.
//
//   env IMPROVE_DIR        -> improvements dir (default ~/.claude/improvements)
//   env IMPROVE_QUEUE_SH   -> path to queue.sh (default ~/.claude/hooks/improve/queue.sh)

use std::{
    env, fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};

use crossterm::event::{self, Event, KeyCode, KeyEventKind};
use ratatui::{
    layout::{Constraint, Flex, Layout, Rect},
    style::{Color, Modifier, Style, Stylize},
    text::{Line, Span, Text},
    widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Tabs, Wrap},
    Frame,
};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
struct Proposal {
    id: String,
    #[serde(default)]
    date: String,
    #[serde(default)]
    title: String,
    #[serde(default)]
    signal: String,
    #[serde(default)]
    target: String,
    #[serde(default)]
    proposal: String,
    #[serde(default)]
    snippet: String,
    #[serde(default)]
    risk: String,
    #[serde(default)]
    status: String,
    #[serde(default)]
    reason: Option<String>,
}

#[derive(Clone, Copy, PartialEq)]
enum Tab {
    Pending,
    Done,
    All,
}
impl Tab {
    fn next(self) -> Tab {
        match self {
            Tab::Pending => Tab::Done,
            Tab::Done => Tab::All,
            Tab::All => Tab::Pending,
        }
    }
    fn prev(self) -> Tab {
        match self {
            Tab::Pending => Tab::All,
            Tab::Done => Tab::Pending,
            Tab::All => Tab::Done,
        }
    }
}

enum Mode {
    Normal,
    Deny(String),
    Iterating,
}

struct App {
    imp_dir: PathBuf,
    queue_sh: String,
    pending: Vec<Proposal>,
    applied: Vec<Proposal>,
    tab: Tab,
    selected: usize,
    detail_scroll: u16,
    mode: Mode,
    status_msg: String,
    spinner: usize,
    iterate_rx: Option<mpsc::Receiver<Result<String, String>>>,
    quit: bool,
    // set by the 'work' key: id to hand off to Claude (printed to stdout on exit).
    work_id: Option<String>,
    // whether the work-key managed to copy a build prompt to the clipboard.
    work_copied: bool,
}

const SPIN: [&str; 10] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

fn home() -> PathBuf {
    PathBuf::from(env::var("HOME").unwrap_or_else(|_| "/root".into()))
}

fn read_proposals(path: &PathBuf) -> Vec<Proposal> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<Proposal>>(&s).ok())
        .unwrap_or_default()
}

/// A ready-to-paste prompt that tells Claude to implement a proposal.
fn build_work_payload(p: &Proposal) -> String {
    format!(
        "Implement this harness improvement proposal, then run `queue.sh apply {id}`.\n\n\
         id: {id}\ntitle: {title}\ntarget: {target}\nrisk: {risk}\n\n\
         why (signal):\n{signal}\n\nproposal:\n{proposal}\n\nsnippet:\n{snippet}",
        id = p.id,
        title = p.title,
        target = p.target,
        risk = p.risk,
        signal = p.signal,
        proposal = p.proposal,
        snippet = p.snippet,
    )
}

/// Best-effort copy to the system clipboard. Tries common tools in order and
/// returns true on the first that accepts the text. Never blocks the UI.
fn copy_clipboard(text: &str) -> bool {
    let tools: [(&str, &[&str]); 5] = [
        ("wl-copy", &[]),
        ("xclip", &["-selection", "clipboard"]),
        ("xsel", &["-b", "-i"]),
        ("pbcopy", &[]),
        ("clip.exe", &[]),
    ];
    for (cmd, args) in tools {
        let Ok(mut child) = Command::new(cmd)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
        else {
            continue;
        };
        if let Some(mut stdin) = child.stdin.take() {
            let _ = stdin.write_all(text.as_bytes());
            // drop stdin to signal EOF before waiting
        }
        if child.wait().map(|s| s.success()).unwrap_or(false) {
            return true;
        }
    }
    false
}

fn risk_color(r: &str) -> Color {
    match r {
        "low" => Color::Green,
        "med" => Color::Yellow,
        "high" => Color::Red,
        _ => Color::Gray,
    }
}

fn status_color(s: &str) -> Color {
    match s {
        "pending" => Color::Cyan,
        "accepted" => Color::Blue,
        "iterating" => Color::Magenta,
        "applied" => Color::Green,
        "dismissed" => Color::DarkGray,
        _ => Color::Gray,
    }
}

impl App {
    fn new() -> App {
        let imp_dir = env::var("IMPROVE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| home().join(".claude/improvements"));
        let queue_sh = env::var("IMPROVE_QUEUE_SH").unwrap_or_else(|_| {
            home()
                .join(".claude/hooks/improve/queue.sh")
                .to_string_lossy()
                .into_owned()
        });
        let mut app = App {
            imp_dir,
            queue_sh,
            pending: vec![],
            applied: vec![],
            tab: Tab::Pending,
            selected: 0,
            detail_scroll: 0,
            mode: Mode::Normal,
            status_msg: "loaded".into(),
            spinner: 0,
            iterate_rx: None,
            quit: false,
            work_id: None,
            work_copied: false,
        };
        app.reload();
        app
    }

    fn reload(&mut self) {
        self.pending = read_proposals(&self.imp_dir.join("pending.json"));
        self.applied = read_proposals(&self.imp_dir.join("applied.json"));
        self.clamp_selected();
    }

    fn list(&self) -> Vec<&Proposal> {
        match self.tab {
            Tab::Pending => self.pending.iter().collect(),
            Tab::Done => self.applied.iter().collect(),
            Tab::All => self.pending.iter().chain(self.applied.iter()).collect(),
        }
    }

    fn clamp_selected(&mut self) {
        let n = self.list().len();
        if n == 0 {
            self.selected = 0;
        } else if self.selected >= n {
            self.selected = n - 1;
        }
    }

    fn selected_proposal(&self) -> Option<Proposal> {
        self.list().get(self.selected).map(|p| (*p).clone())
    }

    fn run_queue(&self, args: &[&str]) -> Result<String, String> {
        let out = Command::new("bash")
            .arg(&self.queue_sh)
            .args(args)
            .env("IMPROVE_DIR", &self.imp_dir)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
        } else {
            let e = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(if e.is_empty() { "command failed".into() } else { e })
        }
    }

    fn act(&mut self, verb: &str) {
        let Some(p) = self.selected_proposal() else {
            self.status_msg = "no proposal selected".into();
            return;
        };
        match self.run_queue(&[verb, &p.id]) {
            Ok(m) => self.status_msg = m,
            Err(e) => self.status_msg = format!("✗ {e}"),
        }
        self.reload();
    }

    fn start_iterate(&mut self) {
        let Some(p) = self.selected_proposal() else {
            self.status_msg = "no proposal selected".into();
            return;
        };
        let (tx, rx) = mpsc::channel();
        let q = self.queue_sh.clone();
        let d = self.imp_dir.clone();
        let id = p.id.clone();
        thread::spawn(move || {
            let res = Command::new("bash")
                .arg(&q)
                .arg("iterate")
                .arg(&id)
                .env("IMPROVE_DIR", &d)
                .output();
            let msg = match res {
                Ok(o) if o.status.success() => {
                    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
                }
                Ok(o) => Err(String::from_utf8_lossy(&o.stderr).trim().to_string()),
                Err(e) => Err(e.to_string()),
            };
            let _ = tx.send(msg);
        });
        self.iterate_rx = Some(rx);
        self.mode = Mode::Iterating;
        self.status_msg = "iterating…".into();
    }

    // 'work' handoff: accept (best-effort) then quit, flagging the id so main()
    // prints it to stdout after the alt-screen is torn down. Because `browse` is
    // launched via `!`, that stdout lands in the Claude conversation → Claude builds it.
    fn start_work(&mut self) {
        let Some(p) = self.selected_proposal() else {
            self.status_msg = "no proposal selected".into();
            return;
        };
        let _ = self.run_queue(&["accept", &p.id]);
        self.work_copied = copy_clipboard(&build_work_payload(&p));
        self.work_id = Some(p.id);
        self.quit = true;
    }

    fn submit_deny(&mut self, reason: String) {
        let Some(p) = self.selected_proposal() else {
            self.mode = Mode::Normal;
            return;
        };
        match self.run_queue(&["deny", &p.id, &reason]) {
            Ok(m) => self.status_msg = m,
            Err(e) => self.status_msg = format!("✗ {e}"),
        }
        self.mode = Mode::Normal;
        self.reload();
    }

    fn poll_iterate(&mut self) {
        if let Some(rx) = &self.iterate_rx {
            if let Ok(res) = rx.try_recv() {
                match res {
                    Ok(m) => self.status_msg = m,
                    Err(e) => self.status_msg = format!("✗ iterate: {e}"),
                }
                self.iterate_rx = None;
                self.mode = Mode::Normal;
                self.reload();
            }
        }
    }

    fn set_tab(&mut self, t: Tab) {
        self.tab = t;
        self.selected = 0;
        self.detail_scroll = 0;
    }

    fn move_sel(&mut self, delta: i32) {
        let n = self.list().len() as i32;
        if n == 0 {
            return;
        }
        let s = (self.selected as i32 + delta).clamp(0, n - 1);
        self.selected = s as usize;
        self.detail_scroll = 0;
    }
}

fn centered(area: Rect, pct_x: u16, pct_y: u16) -> Rect {
    let vert = Layout::vertical([Constraint::Percentage(pct_y)])
        .flex(Flex::Center)
        .split(area)[0];
    Layout::horizontal([Constraint::Percentage(pct_x)])
        .flex(Flex::Center)
        .split(vert)[0]
}

fn ui(f: &mut Frame, app: &App) {
    let chunks = Layout::vertical([
        Constraint::Length(3),
        Constraint::Min(0),
        Constraint::Length(1),
    ])
    .split(f.area());

    // --- tabs ---
    let titles = vec![
        format!(" Pending ({}) ", app.pending.len()),
        format!(" Done ({}) ", app.applied.len()),
        format!(" All ({}) ", app.pending.len() + app.applied.len()),
    ];
    let idx = match app.tab {
        Tab::Pending => 0,
        Tab::Done => 1,
        Tab::All => 2,
    };
    let tabs = Tabs::new(titles)
        .block(Block::default().borders(Borders::ALL).title(" improve queue "))
        .select(idx)
        .highlight_style(Style::default().fg(Color::Black).bg(Color::Cyan).bold());
    f.render_widget(tabs, chunks[0]);

    // --- body: list | detail ---
    let body = Layout::horizontal([Constraint::Percentage(40), Constraint::Percentage(60)])
        .split(chunks[1]);

    let items: Vec<ListItem> = app
        .list()
        .iter()
        .map(|p| {
            let risk = format!("{:<4}", p.risk);
            ListItem::new(Line::from(vec![
                Span::styled("● ", Style::default().fg(risk_color(&p.risk))),
                Span::styled(risk, Style::default().fg(risk_color(&p.risk))),
                Span::raw(" "),
                Span::styled(
                    format!("{:<10}", p.status),
                    Style::default().fg(status_color(&p.status)),
                ),
                Span::raw(" "),
                Span::raw(p.title.clone()),
            ]))
        })
        .collect();

    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" proposals "))
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▶ ");
    let mut state = ListState::default();
    if !app.list().is_empty() {
        state.select(Some(app.selected));
    }
    f.render_stateful_widget(list, body[0], &mut state);

    // --- detail ---
    let detail = if let Some(p) = app.selected_proposal() {
        let mut lines: Vec<Line> = vec![
            kv("id", &p.id),
            kv("date", &p.date),
            kv("title", &p.title),
            kv("target", &p.target),
            Line::from(vec![
                Span::styled("risk:   ", Style::default().fg(Color::DarkGray)),
                Span::styled(p.risk.clone(), Style::default().fg(risk_color(&p.risk))),
                Span::raw("   "),
                Span::styled("status: ", Style::default().fg(Color::DarkGray)),
                Span::styled(p.status.clone(), Style::default().fg(status_color(&p.status))),
            ]),
            Line::from(""),
            Line::from(Span::styled("why (signal)", Style::default().fg(Color::Yellow).bold())),
        ];
        wrap_into(&mut lines, &p.signal, "  ");
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled("proposal", Style::default().fg(Color::Yellow).bold())));
        wrap_into(&mut lines, &p.proposal, "  ");
        lines.push(Line::from(""));
        lines.push(Line::from(Span::styled("snippet", Style::default().fg(Color::Yellow).bold())));
        for l in p.snippet.lines() {
            lines.push(Line::from(Span::styled(
                format!("  {l}"),
                Style::default().fg(Color::Rgb(180, 180, 180)),
            )));
        }
        if let Some(r) = &p.reason {
            lines.push(Line::from(""));
            lines.push(Line::from(vec![
                Span::styled("reason: ", Style::default().fg(Color::DarkGray)),
                Span::raw(r.clone()),
            ]));
        }
        Text::from(lines)
    } else {
        Text::from("— no proposals in this tab —")
    };
    let detail = Paragraph::new(detail)
        .block(Block::default().borders(Borders::ALL).title(" detail (J/K scroll) "))
        .wrap(Wrap { trim: false })
        .scroll((app.detail_scroll, 0));
    f.render_widget(detail, body[1]);

    // --- footer ---
    let footer = if matches!(app.mode, Mode::Iterating) {
        Line::from(vec![
            Span::styled(
                format!("{} ", SPIN[app.spinner % SPIN.len()]),
                Style::default().fg(Color::Magenta),
            ),
            Span::raw(app.status_msg.clone()),
        ])
    } else {
        Line::from(vec![
            Span::styled(
                "Tab",
                Style::default().fg(Color::Cyan),
            ),
            Span::raw(" switch · "),
            Span::styled("j/k", Style::default().fg(Color::Cyan)),
            Span::raw(" move · "),
            Span::styled("J/K", Style::default().fg(Color::Cyan)),
            Span::raw(" scroll · "),
            Span::styled("a", Style::default().fg(Color::Green)),
            Span::raw(" accept · "),
            Span::styled("d", Style::default().fg(Color::Red)),
            Span::raw(" deny · "),
            Span::styled("i", Style::default().fg(Color::Magenta)),
            Span::raw(" iterate · "),
            Span::styled("x", Style::default().fg(Color::Blue)),
            Span::raw(" apply · "),
            Span::styled("w", Style::default().fg(Color::White).bg(Color::Green)),
            Span::raw(" work · "),
            Span::styled("q", Style::default().fg(Color::Gray)),
            Span::raw(" quit  │  "),
            Span::styled(app.status_msg.clone(), Style::default().fg(Color::White)),
        ])
    };
    f.render_widget(Paragraph::new(footer), chunks[2]);

    // --- deny modal ---
    if let Mode::Deny(buf) = &app.mode {
        let area = centered(f.area(), 60, 20);
        f.render_widget(Clear, area);
        let p = Paragraph::new(vec![
            Line::from(""),
            Line::from(Span::styled(
                "  reason for dismissing (Enter=confirm, Esc=cancel):",
                Style::default().fg(Color::Yellow),
            )),
            Line::from(""),
            Line::from(format!("  > {buf}_")),
        ])
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" deny ")
                .border_style(Style::default().fg(Color::Red)),
        );
        f.render_widget(p, area);
    }
}

fn kv<'a>(k: &'a str, v: &str) -> Line<'a> {
    Line::from(vec![
        Span::styled(format!("{k:<8}"), Style::default().fg(Color::DarkGray)),
        Span::raw(v.to_string()),
    ])
}

fn wrap_into(lines: &mut Vec<Line>, text: &str, indent: &str) {
    // light word-wrap; Paragraph also wraps, but this keeps the indent stable.
    for chunk in text.split('\n') {
        lines.push(Line::from(format!("{indent}{chunk}")));
    }
}

fn main() -> std::io::Result<()> {
    let mut app = App::new();
    let mut terminal = ratatui::init();
    let res = run(&mut terminal, &mut app);
    ratatui::restore();
    // Handoff: print the chosen proposal to stdout so it reaches the Claude
    // conversation (browse runs via `!`). Claude implements it, then `apply`.
    if let Some(id) = app.work_id.clone() {
        println!("WORK ON: {id}");
        match app.run_queue(&["show", &id]) {
            Ok(detail) => println!("{detail}"),
            Err(e) => println!("(could not load detail: {e})"),
        }
        if app.work_copied {
            println!("\n✓ build prompt copied to clipboard — paste into Claude Code,");
            println!("  or just run /work there to build all accepted proposals.");
        } else {
            println!("\n→ In Claude Code run /work to build accepted proposals (then queue.sh apply {id}).");
        }
    }
    res
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proposal(id: &str, risk: &str, status: &str) -> Proposal {
        Proposal {
            id: id.into(),
            date: "2026-06-01".into(),
            title: format!("Title {id}"),
            signal: "sig".into(),
            target: "t".into(),
            proposal: "p".into(),
            snippet: "s".into(),
            risk: risk.into(),
            status: status.into(),
            reason: None,
        }
    }

    fn make_app(pending: Vec<Proposal>, applied: Vec<Proposal>) -> App {
        App {
            imp_dir: PathBuf::from("/nonexistent"),
            queue_sh: "/nonexistent".into(),
            pending,
            applied,
            tab: Tab::Pending,
            selected: 0,
            detail_scroll: 0,
            mode: Mode::Normal,
            status_msg: String::new(),
            spinner: 0,
            iterate_rx: None,
            quit: false,
            work_id: None,
            work_copied: false,
        }
    }

    // --- Tab cycling ---

    #[test]
    fn tab_next_cycles() {
        assert!(matches!(Tab::Pending.next(), Tab::Done));
        assert!(matches!(Tab::Done.next(), Tab::All));
        assert!(matches!(Tab::All.next(), Tab::Pending));
    }

    #[test]
    fn tab_prev_cycles() {
        assert!(matches!(Tab::Pending.prev(), Tab::All));
        assert!(matches!(Tab::All.prev(), Tab::Done));
        assert!(matches!(Tab::Done.prev(), Tab::Pending));
    }

    // --- risk_color ---

    #[test]
    fn risk_color_known() {
        assert!(matches!(risk_color("low"), Color::Green));
        assert!(matches!(risk_color("med"), Color::Yellow));
        assert!(matches!(risk_color("high"), Color::Red));
    }

    #[test]
    fn risk_color_unknown_is_gray() {
        assert!(matches!(risk_color(""), Color::Gray));
        assert!(matches!(risk_color("critical"), Color::Gray));
    }

    // --- status_color ---

    #[test]
    fn status_color_known() {
        assert!(matches!(status_color("pending"), Color::Cyan));
        assert!(matches!(status_color("accepted"), Color::Blue));
        assert!(matches!(status_color("iterating"), Color::Magenta));
        assert!(matches!(status_color("applied"), Color::Green));
        assert!(matches!(status_color("dismissed"), Color::DarkGray));
    }

    #[test]
    fn status_color_unknown_is_gray() {
        assert!(matches!(status_color(""), Color::Gray));
        assert!(matches!(status_color("garbage"), Color::Gray));
    }

    // --- read_proposals ---

    fn tmp_json(name: &str, content: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("improve_tui_test_{name}.json"));
        fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn read_proposals_valid() {
        let path = tmp_json("valid", r#"[{"id":"x","risk":"low","status":"pending"}]"#);
        let v = read_proposals(&path);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].id, "x");
        assert_eq!(v[0].risk, "low");
    }

    #[test]
    fn read_proposals_empty_array() {
        let path = tmp_json("empty", "[]");
        let v = read_proposals(&path);
        assert!(v.is_empty());
    }

    #[test]
    fn read_proposals_malformed_returns_empty() {
        let path = tmp_json("malformed", "not json");
        let v = read_proposals(&path);
        assert!(v.is_empty());
    }

    #[test]
    fn read_proposals_missing_file_returns_empty() {
        let v = read_proposals(&PathBuf::from("/nonexistent/does_not_exist.json"));
        assert!(v.is_empty());
    }

    #[test]
    fn read_proposals_missing_optional_fields_use_defaults() {
        let path = tmp_json("defaults", r#"[{"id":"y"}]"#);
        let v = read_proposals(&path);
        assert_eq!(v.len(), 1);
        assert_eq!(v[0].id, "y");
        assert_eq!(v[0].risk, "");
        assert_eq!(v[0].status, "");
        assert!(v[0].reason.is_none());
    }

    #[test]
    fn read_proposals_reason_field_parsed() {
        let path = tmp_json("reason", r#"[{"id":"z","reason":"too risky"}]"#);
        let v = read_proposals(&path);
        assert_eq!(v[0].reason.as_deref(), Some("too risky"));
    }

    // --- App::list() tab filtering ---

    #[test]
    fn list_pending_tab() {
        let app = make_app(
            vec![proposal("p1", "low", "pending")],
            vec![proposal("a1", "med", "applied")],
        );
        let l = app.list();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].id, "p1");
    }

    #[test]
    fn list_done_tab() {
        let mut app = make_app(
            vec![proposal("p1", "low", "pending")],
            vec![proposal("a1", "med", "applied")],
        );
        app.tab = Tab::Done;
        let l = app.list();
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].id, "a1");
    }

    #[test]
    fn list_all_tab() {
        let mut app = make_app(
            vec![proposal("p1", "low", "pending")],
            vec![proposal("a1", "med", "applied")],
        );
        app.tab = Tab::All;
        let l = app.list();
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].id, "p1");
        assert_eq!(l[1].id, "a1");
    }

    #[test]
    fn list_empty() {
        let app = make_app(vec![], vec![]);
        assert!(app.list().is_empty());
    }

    // --- App::clamp_selected ---

    #[test]
    fn clamp_selected_empty_list() {
        let mut app = make_app(vec![], vec![]);
        app.selected = 99;
        app.clamp_selected();
        assert_eq!(app.selected, 0);
    }

    #[test]
    fn clamp_selected_past_end() {
        let mut app = make_app(
            vec![proposal("a", "low", "pending"), proposal("b", "low", "pending")],
            vec![],
        );
        app.selected = 10;
        app.clamp_selected();
        assert_eq!(app.selected, 1); // n-1 = 1
    }

    #[test]
    fn clamp_selected_in_bounds_unchanged() {
        let mut app = make_app(
            vec![proposal("a", "low", "pending"), proposal("b", "low", "pending")],
            vec![],
        );
        app.selected = 1;
        app.clamp_selected();
        assert_eq!(app.selected, 1);
    }

    // --- App::move_sel ---

    #[test]
    fn move_sel_forward() {
        let mut app = make_app(
            vec![
                proposal("a", "low", "pending"),
                proposal("b", "low", "pending"),
                proposal("c", "low", "pending"),
            ],
            vec![],
        );
        app.move_sel(1);
        assert_eq!(app.selected, 1);
        app.move_sel(1);
        assert_eq!(app.selected, 2);
    }

    #[test]
    fn move_sel_clamps_at_end() {
        let mut app = make_app(
            vec![proposal("a", "low", "pending"), proposal("b", "low", "pending")],
            vec![],
        );
        app.selected = 1;
        app.move_sel(100);
        assert_eq!(app.selected, 1); // clamped at n-1
    }

    #[test]
    fn move_sel_clamps_at_zero() {
        let mut app = make_app(
            vec![proposal("a", "low", "pending"), proposal("b", "low", "pending")],
            vec![],
        );
        app.selected = 0;
        app.move_sel(-5);
        assert_eq!(app.selected, 0);
    }

    #[test]
    fn move_sel_empty_list_no_panic() {
        let mut app = make_app(vec![], vec![]);
        app.move_sel(1); // must not panic
        assert_eq!(app.selected, 0);
    }

    #[test]
    fn move_sel_resets_detail_scroll() {
        let mut app = make_app(
            vec![proposal("a", "low", "pending"), proposal("b", "low", "pending")],
            vec![],
        );
        app.detail_scroll = 5;
        app.move_sel(1);
        assert_eq!(app.detail_scroll, 0);
    }

    // --- App::set_tab ---

    #[test]
    fn set_tab_resets_selection_and_scroll() {
        let mut app = make_app(vec![], vec![proposal("a", "low", "applied")]);
        app.selected = 3;
        app.detail_scroll = 7;
        app.set_tab(Tab::Done);
        assert!(matches!(app.tab, Tab::Done));
        assert_eq!(app.selected, 0);
        assert_eq!(app.detail_scroll, 0);
    }

    // --- App::selected_proposal ---

    #[test]
    fn selected_proposal_returns_item() {
        let app = make_app(
            vec![proposal("a", "low", "pending"), proposal("b", "med", "pending")],
            vec![],
        );
        let p = app.selected_proposal().unwrap();
        assert_eq!(p.id, "a");
    }

    #[test]
    fn selected_proposal_none_when_empty() {
        let app = make_app(vec![], vec![]);
        assert!(app.selected_proposal().is_none());
    }

    // --- App::start_work (handoff) ---

    #[test]
    fn start_work_flags_id_and_quits() {
        // queue_sh is /nonexistent so the accept shell-out fails, but handoff
        // must still flag the selected id and request quit.
        let mut app = make_app(
            vec![proposal("p1", "low", "pending"), proposal("p2", "med", "pending")],
            vec![],
        );
        app.selected = 1;
        app.start_work();
        assert_eq!(app.work_id.as_deref(), Some("p2"));
        assert!(app.quit);
    }

    #[test]
    fn build_work_payload_includes_key_fields() {
        let p = proposal("fix-x", "high", "pending");
        let out = build_work_payload(&p);
        assert!(out.contains("queue.sh apply fix-x"));
        assert!(out.contains("id: fix-x"));
        assert!(out.contains("Title fix-x"));
        assert!(out.contains("Implement this harness improvement"));
    }

    #[test]
    fn start_work_empty_list_no_handoff() {
        let mut app = make_app(vec![], vec![]);
        app.start_work();
        assert!(app.work_id.is_none());
        assert!(!app.quit);
    }

    // --- wrap_into ---

    #[test]
    fn wrap_into_single_line() {
        let mut lines: Vec<Line> = vec![];
        wrap_into(&mut lines, "hello world", "  ");
        assert_eq!(lines.len(), 1);
    }

    #[test]
    fn wrap_into_newlines_split() {
        let mut lines: Vec<Line> = vec![];
        wrap_into(&mut lines, "line1\nline2\nline3", "  ");
        assert_eq!(lines.len(), 3);
    }

    #[test]
    fn wrap_into_empty_string() {
        let mut lines: Vec<Line> = vec![];
        wrap_into(&mut lines, "", "  ");
        assert_eq!(lines.len(), 1); // split('\n') on "" yields one empty chunk
    }

    #[test]
    fn wrap_into_applies_indent() {
        let mut lines: Vec<Line> = vec![];
        wrap_into(&mut lines, "text", ">>>");
        // Line contains ">>>text"
        let s = format!("{:?}", lines[0]);
        assert!(s.contains(">>>text"));
    }
}

fn run(terminal: &mut ratatui::DefaultTerminal, app: &mut App) -> std::io::Result<()> {
    while !app.quit {
        terminal.draw(|f| ui(f, app))?;

        if matches!(app.mode, Mode::Iterating) {
            app.poll_iterate();
        }

        if event::poll(Duration::from_millis(120))? {
            if let Event::Key(k) = event::read()? {
                if k.kind != KeyEventKind::Press {
                    continue;
                }
                match &mut app.mode {
                    Mode::Deny(buf) => match k.code {
                        KeyCode::Esc => app.mode = Mode::Normal,
                        KeyCode::Enter => {
                            let r = buf.clone();
                            app.submit_deny(r);
                        }
                        KeyCode::Backspace => {
                            buf.pop();
                        }
                        KeyCode::Char(c) => buf.push(c),
                        _ => {}
                    },
                    Mode::Iterating => {
                        // input ignored while the reflector runs
                    }
                    Mode::Normal => match k.code {
                        KeyCode::Char('q') | KeyCode::Esc => app.quit = true,
                        KeyCode::Tab | KeyCode::Right | KeyCode::Char('l') => {
                            let t = app.tab.next();
                            app.set_tab(t);
                        }
                        KeyCode::BackTab | KeyCode::Left | KeyCode::Char('h') => {
                            let t = app.tab.prev();
                            app.set_tab(t);
                        }
                        KeyCode::Down | KeyCode::Char('j') => app.move_sel(1),
                        KeyCode::Up | KeyCode::Char('k') => app.move_sel(-1),
                        KeyCode::Char('J') | KeyCode::PageDown => {
                            app.detail_scroll = app.detail_scroll.saturating_add(3)
                        }
                        KeyCode::Char('K') | KeyCode::PageUp => {
                            app.detail_scroll = app.detail_scroll.saturating_sub(3)
                        }
                        KeyCode::Char('a') => app.act("accept"),
                        KeyCode::Char('x') => app.act("apply"),
                        KeyCode::Char('d') => app.mode = Mode::Deny(String::new()),
                        KeyCode::Char('i') => app.start_iterate(),
                        KeyCode::Char('w') | KeyCode::Enter => app.start_work(),
                        _ => {}
                    },
                }
            }
        }
        app.spinner = app.spinner.wrapping_add(1);
    }
    Ok(())
}

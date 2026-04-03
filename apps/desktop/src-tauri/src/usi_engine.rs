use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::Mutex;
use uuid::Uuid;

// ── USI Option Definition ──────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum UsiOptionDef {
    Check {
        name: String,
        default: bool,
    },
    Spin {
        name: String,
        default: i64,
        min: i64,
        max: i64,
    },
    Combo {
        name: String,
        default: String,
        vars: Vec<String>,
    },
    String {
        name: String,
        default: String,
    },
    Filename {
        name: String,
        default: String,
    },
    Button {
        name: String,
    },
}

// ── Probe Result ───────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ProbeResult {
    pub name: String,
    pub author: String,
    pub options: Vec<UsiOptionDef>,
}

// ── Engine Event (USI → JSON) ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum UsiEngineEvent {
    #[serde(rename = "info")]
    Info {
        depth: Option<u32>,
        seldepth: Option<u32>,
        nodes: Option<u64>,
        nps: Option<u64>,
        #[serde(rename = "timeMs")]
        time_ms: Option<u64>,
        #[serde(rename = "scoreCp")]
        score_cp: Option<i32>,
        #[serde(rename = "scoreMate")]
        score_mate: Option<i32>,
        multipv: Option<usize>,
        pv: Option<Vec<String>>,
        hashfull: Option<u32>,
    },
    #[serde(rename = "bestmove")]
    BestMove {
        #[serde(rename = "move")]
        mv: String,
        ponder: Option<String>,
    },
    #[serde(rename = "error")]
    Error { message: String },
}

// ── Parsers ────────────────────────────────────────────────────────

/// Parse "id name ..." line. Returns the name string.
pub fn parse_id_name(line: &str) -> Option<String> {
    let rest = line.strip_prefix("id name ")?;
    let name = rest.trim();
    if name.is_empty() {
        return None;
    }
    Some(name.to_string())
}

/// Parse "id author ..." line. Returns the author string.
pub fn parse_id_author(line: &str) -> Option<String> {
    let rest = line.strip_prefix("id author ")?;
    let author = rest.trim();
    if author.is_empty() {
        return None;
    }
    Some(author.to_string())
}

/// Parse "option name ... type ..." line.
pub fn parse_option(line: &str) -> Option<UsiOptionDef> {
    let rest = line.strip_prefix("option name ")?;

    // Find "type " to split name and the rest
    let type_idx = rest.find(" type ")?;
    let name = rest[..type_idx].trim().to_string();
    let after_name = &rest[type_idx + 6..]; // skip " type "

    // Split into type keyword and remaining tokens
    let mut parts = after_name.splitn(2, ' ');
    let type_str = parts.next()?;
    let remainder = parts.next().unwrap_or("");

    match type_str {
        "check" => {
            let default = parse_kv_bool(remainder, "default").unwrap_or(false);
            Some(UsiOptionDef::Check { name, default })
        }
        "spin" => {
            let default = parse_kv_i64(remainder, "default").unwrap_or(0);
            let min = parse_kv_i64(remainder, "min").unwrap_or(i64::MIN);
            let max = parse_kv_i64(remainder, "max").unwrap_or(i64::MAX);
            Some(UsiOptionDef::Spin {
                name,
                default,
                min,
                max,
            })
        }
        "combo" => {
            let default = parse_kv_default_str(remainder).unwrap_or_default();
            let vars = parse_combo_vars(remainder);
            Some(UsiOptionDef::Combo {
                name,
                default,
                vars,
            })
        }
        "string" => {
            let default = parse_kv_default_str(remainder).unwrap_or_default();
            Some(UsiOptionDef::String { name, default })
        }
        "filename" => {
            let default = parse_kv_default_str(remainder).unwrap_or_default();
            Some(UsiOptionDef::Filename { name, default })
        }
        "button" => Some(UsiOptionDef::Button { name }),
        _ => None,
    }
}

/// Parse "info ..." line into UsiEngineEvent::Info.
pub fn parse_info(line: &str) -> Option<UsiEngineEvent> {
    let rest = line.strip_prefix("info ")?;
    let tokens: Vec<&str> = rest.split_whitespace().collect();

    let mut depth = None;
    let mut seldepth = None;
    let mut nodes = None;
    let mut nps = None;
    let mut time_ms = None;
    let mut score_cp = None;
    let mut score_mate = None;
    let mut multipv = None;
    let mut pv = None;
    let mut hashfull = None;

    let mut i = 0;
    while i < tokens.len() {
        match tokens[i] {
            "depth" => {
                i += 1;
                depth = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "seldepth" => {
                i += 1;
                seldepth = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "nodes" => {
                i += 1;
                nodes = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "nps" => {
                i += 1;
                nps = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "time" => {
                i += 1;
                time_ms = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "hashfull" => {
                i += 1;
                hashfull = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "multipv" => {
                i += 1;
                multipv = tokens.get(i).and_then(|v| v.parse().ok());
            }
            "score" => {
                i += 1;
                if let Some(&kind) = tokens.get(i) {
                    i += 1;
                    match kind {
                        "cp" => score_cp = tokens.get(i).and_then(|v| v.parse().ok()),
                        "mate" => score_mate = tokens.get(i).and_then(|v| v.parse().ok()),
                        _ => {
                            i -= 1; // rewind if unknown score kind
                        }
                    }
                }
            }
            "pv" => {
                // pv is always last, collect remaining tokens
                let moves: Vec<String> = tokens[i + 1..].iter().map(|s| (*s).to_string()).collect();
                if !moves.is_empty() {
                    pv = Some(moves);
                }
                break;
            }
            "string" => {
                // "info string ..." — skip, not structured
                break;
            }
            _ => {}
        }
        i += 1;
    }

    Some(UsiEngineEvent::Info {
        depth,
        seldepth,
        nodes,
        nps,
        time_ms,
        score_cp,
        score_mate,
        multipv,
        pv,
        hashfull,
    })
}

/// Parse "bestmove ..." line into UsiEngineEvent::BestMove.
pub fn parse_bestmove(line: &str) -> Option<UsiEngineEvent> {
    let rest = line.strip_prefix("bestmove ")?;
    let mut tokens = rest.split_whitespace();
    let mv = tokens.next()?.to_string();

    let ponder = if tokens.next() == Some("ponder") {
        tokens.next().map(|s| s.to_string())
    } else {
        None
    };

    Some(UsiEngineEvent::BestMove { mv, ponder })
}

/// Dispatch a single USI output line to the appropriate parser.
/// Returns None for lines that don't produce events (usiok, readyok, id, option, etc.)
pub fn parse_engine_line(line: &str) -> Option<UsiEngineEvent> {
    let line = line.trim();
    if line.starts_with("info ") {
        parse_info(line)
    } else if line.starts_with("bestmove ") {
        parse_bestmove(line)
    } else {
        None
    }
}

// ── Session Management ─────────────────────────────────────────────

const USI_TIMEOUT_SECS: u64 = 10;
const READY_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EngineStatus {
    Ready,
    Searching,
}

struct UsiEngineSession {
    registration_id: String,
    stdin: Arc<Mutex<tokio::process::ChildStdin>>,
    stdout_task: tauri::async_runtime::JoinHandle<()>,
    status: Arc<std::sync::Mutex<EngineStatus>>,
    child: tokio::process::Child,
}

pub struct UsiEngineManager {
    sessions: Arc<Mutex<HashMap<String, UsiEngineSession>>>,
}

impl Default for UsiEngineManager {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Input parameters for the go command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchParamsInput {
    pub max_depth: Option<u32>,
    pub nodes: Option<u64>,
    pub byoyomi_ms: Option<u64>,
    pub movetime_ms: Option<u64>,
    pub infinite: Option<bool>,
}

/// Saved option value for an engine.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionValue {
    pub name: String,
    pub value: serde_json::Value,
}

/// Engine registration stored in tauri-plugin-store.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EngineRegistration {
    pub id: String,
    pub path: String,
    #[serde(rename = "displayName")]
    pub display_name: String,
    pub author: String,
    pub options: Vec<UsiOptionDef>,
}

fn event_channel(session_id: &str) -> String {
    format!("engine://usi/{session_id}")
}

/// Create a Command for spawning a USI engine process.
/// On Windows, sets CREATE_NO_WINDOW to suppress console window.
pub(crate) fn create_engine_command(path: &str) -> Command {
    let mut cmd = Command::new(path);
    cmd.stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }

    cmd
}

/// Validate that a USI parameter does not contain newline characters.
fn validate_usi_param(param: &str, label: &str) -> Result<(), String> {
    if param.contains('\n') || param.contains('\r') {
        return Err(format!("{label} に改行文字を含めることはできません"));
    }
    Ok(())
}

/// Send a line to the engine's stdin.
pub(crate) async fn send_line(
    stdin: &Arc<Mutex<tokio::process::ChildStdin>>,
    line: &str,
) -> Result<(), String> {
    let mut guard = stdin.lock().await;
    let data = format!("{line}\n");
    guard
        .write_all(data.as_bytes())
        .await
        .map_err(|e| format!("stdin write error: {e}"))?;
    guard
        .flush()
        .await
        .map_err(|e| format!("stdin flush error: {e}"))
}

impl UsiEngineManager {
    /// Probe an engine binary: spawn, perform USI handshake, collect info, then quit.
    pub async fn probe(&self, path: &str) -> Result<ProbeResult, String> {
        let mut child = create_engine_command(path)
            .spawn()
            .map_err(|e| format!("プロセスの起動に失敗しました: {e}"))?;

        let child_stdin = child.stdin.take().ok_or("stdin を取得できませんでした")?;
        let child_stdout = child.stdout.take().ok_or("stdout を取得できませんでした")?;

        let stdin = Arc::new(Mutex::new(child_stdin));
        let mut reader = BufReader::new(child_stdout).lines();

        // Send "usi"
        send_line(&stdin, "usi").await?;

        let mut name = String::new();
        let mut author = String::new();
        let mut options = Vec::new();

        // Wait for usiok with timeout
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(USI_TIMEOUT_SECS), async {
                while let Some(line) = reader
                    .next_line()
                    .await
                    .map_err(|e| format!("stdout read error: {e}"))?
                {
                    let trimmed = line.trim().to_string();
                    if trimmed == "usiok" {
                        return Ok(());
                    }
                    if let Some(n) = parse_id_name(&trimmed) {
                        name = n;
                    } else if let Some(a) = parse_id_author(&trimmed) {
                        author = a;
                    } else if let Some(opt) = parse_option(&trimmed) {
                        options.push(opt);
                    }
                }
                Err("プロセスが予期せず終了しました".to_string())
            })
            .await;

        // Send quit regardless
        let _ = send_line(&stdin, "quit").await;
        let _ = child.kill().await;

        match result {
            Ok(Ok(())) => Ok(ProbeResult {
                name,
                author,
                options,
            }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("エンジンが応答しません（USIタイムアウト）".to_string()),
        }
    }

    /// Start a new engine session. Returns the session ID.
    pub async fn start<R: tauri::Runtime>(
        &self,
        registration_id: &str,
        path: &str,
        saved_options: &[OptionValue],
        app_handle: &tauri::AppHandle<R>,
    ) -> Result<String, String> {
        let session_id = Uuid::new_v4().to_string();

        let mut child = create_engine_command(path)
            .spawn()
            .map_err(|e| format!("プロセスの起動に失敗しました: {e}"))?;

        let child_stdin = child.stdin.take().ok_or("stdin を取得できませんでした")?;
        let child_stdout = child.stdout.take().ok_or("stdout を取得できませんでした")?;

        let stdin = Arc::new(Mutex::new(child_stdin));

        // Send "usi" and wait for "usiok"
        send_line(&stdin, "usi").await?;

        let mut reader = BufReader::new(child_stdout).lines();
        let usi_result =
            tokio::time::timeout(std::time::Duration::from_secs(USI_TIMEOUT_SECS), async {
                while let Some(line) = reader
                    .next_line()
                    .await
                    .map_err(|e| format!("stdout read error: {e}"))?
                {
                    if line.trim() == "usiok" {
                        return Ok(());
                    }
                }
                Err("プロセスが予期せず終了しました".to_string())
            })
            .await;

        match usi_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = child.kill().await;
                return Err(e);
            }
            Err(_) => {
                let _ = child.kill().await;
                return Err("エンジンが応答しません（USIタイムアウト）".to_string());
            }
        }

        // Apply saved options before isready
        for opt in saved_options {
            let value_str = match &opt.value {
                serde_json::Value::Bool(b) => b.to_string(),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            // Sanitize: skip options with newline characters
            if opt.name.contains('\n')
                || opt.name.contains('\r')
                || value_str.contains('\n')
                || value_str.contains('\r')
            {
                continue;
            }
            send_line(
                &stdin,
                &format!("setoption name {} value {}", opt.name, value_str),
            )
            .await?;
        }

        // Send "isready" and wait for "readyok"
        send_line(&stdin, "isready").await?;

        let ready_result =
            tokio::time::timeout(std::time::Duration::from_secs(READY_TIMEOUT_SECS), async {
                while let Some(line) = reader
                    .next_line()
                    .await
                    .map_err(|e| format!("stdout read error: {e}"))?
                {
                    if line.trim() == "readyok" {
                        return Ok(());
                    }
                }
                Err("プロセスが予期せず終了しました".to_string())
            })
            .await;

        match ready_result {
            Ok(Ok(())) => {}
            Ok(Err(e)) => {
                let _ = child.kill().await;
                return Err(e);
            }
            Err(_) => {
                let _ = child.kill().await;
                return Err(
                    "エンジンの初期化に時間がかかっています（readyokタイムアウト）".to_string(),
                );
            }
        }

        // Start stdout reading task for events
        let channel = event_channel(&session_id);
        let app_handle_clone = app_handle.clone();
        let sessions_clone = Arc::clone(&self.sessions);
        let sid_clone = session_id.clone();
        let status = Arc::new(std::sync::Mutex::new(EngineStatus::Ready));
        let status_clone = Arc::clone(&status);

        let stdout_task = tauri::async_runtime::spawn(async move {
            while let Ok(Some(line)) = reader.next_line().await {
                let trimmed = line.trim();
                if let Some(event) = parse_engine_line(trimmed) {
                    // bestmove 受信時にステータスを Ready に戻す
                    if matches!(event, UsiEngineEvent::BestMove { .. })
                        && let Ok(mut s) = status_clone.lock()
                    {
                        *s = EngineStatus::Ready;
                    }
                    if let Err(e) = app_handle_clone.emit(&channel, &event) {
                        eprintln!("Failed to emit event on {channel}: {e}");
                    }
                }
            }
            // stdout EOF — process died
            let error_event = UsiEngineEvent::Error {
                message: "エンジンプロセスが予期せず終了しました".to_string(),
            };
            let _ = app_handle_clone.emit(&channel, &error_event);
            // Clean up session and kill process to prevent zombie
            let mut sessions = sessions_clone.lock().await;
            if let Some(mut session) = sessions.remove(&sid_clone) {
                let _ = session.child.kill().await;
            }
        });

        let session = UsiEngineSession {
            registration_id: registration_id.to_string(),
            stdin: Arc::clone(&stdin),
            stdout_task,
            status,
            child,
        };

        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), session);

        Ok(session_id)
    }

    /// Clone the stdin handle for a session, releasing the sessions lock before awaiting I/O.
    fn get_stdin(
        sessions: &HashMap<String, UsiEngineSession>,
        session_id: &str,
    ) -> Result<Arc<Mutex<tokio::process::ChildStdin>>, String> {
        let session = sessions
            .get(session_id)
            .ok_or("セッションが見つかりません")?;
        Ok(Arc::clone(&session.stdin))
    }

    /// Send position command.
    pub async fn position(
        &self,
        session_id: &str,
        sfen: &str,
        moves: &[String],
    ) -> Result<(), String> {
        let stdin = {
            let sessions = self.sessions.lock().await;
            Self::get_stdin(&sessions, session_id)?
        };
        let cmd = if moves.is_empty() {
            format!("position sfen {sfen}")
        } else {
            format!("position sfen {sfen} moves {}", moves.join(" "))
        };
        send_line(&stdin, &cmd).await
    }

    /// Send go command.
    pub async fn go(&self, session_id: &str, params: &SearchParamsInput) -> Result<(), String> {
        let (stdin, status) = {
            let sessions = self.sessions.lock().await;
            let session = sessions
                .get(session_id)
                .ok_or("セッションが見つかりません")?;
            (Arc::clone(&session.stdin), Arc::clone(&session.status))
        };

        let mut cmd = "go".to_string();
        if params.infinite == Some(true) {
            cmd.push_str(" infinite");
        } else {
            if let Some(depth) = params.max_depth {
                cmd.push_str(&format!(" depth {depth}"));
            }
            if let Some(nodes) = params.nodes {
                cmd.push_str(&format!(" nodes {nodes}"));
            }
            if let Some(byoyomi) = params.byoyomi_ms {
                cmd.push_str(&format!(" byoyomi {byoyomi}"));
            }
            if let Some(movetime) = params.movetime_ms {
                cmd.push_str(&format!(" movetime {movetime}"));
            }
        }

        if let Ok(mut s) = status.lock() {
            *s = EngineStatus::Searching;
        }
        send_line(&stdin, &cmd).await
    }

    /// Send stop command.
    pub async fn stop(&self, session_id: &str) -> Result<(), String> {
        let stdin = {
            let sessions = self.sessions.lock().await;
            Self::get_stdin(&sessions, session_id)?
        };
        send_line(&stdin, "stop").await
    }

    /// Send setoption command (for check/spin/combo/string/filename types).
    pub async fn setoption(&self, session_id: &str, name: &str, value: &str) -> Result<(), String> {
        validate_usi_param(name, "オプション名")?;
        validate_usi_param(value, "オプション値")?;
        let stdin = {
            let sessions = self.sessions.lock().await;
            Self::get_stdin(&sessions, session_id)?
        };
        send_line(&stdin, &format!("setoption name {name} value {value}")).await
    }

    /// Send button-type setoption command (no value).
    pub async fn send_button(&self, session_id: &str, name: &str) -> Result<(), String> {
        validate_usi_param(name, "オプション名")?;
        let stdin = {
            let sessions = self.sessions.lock().await;
            Self::get_stdin(&sessions, session_id)?
        };
        send_line(&stdin, &format!("setoption name {name}")).await
    }

    /// Query session status.
    pub async fn get_status(&self, session_id: &str) -> Result<EngineStatus, String> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(session_id)
            .ok_or("セッションが見つかりません")?;
        let status = session
            .status
            .lock()
            .map_err(|e| format!("status lock error: {e}"))?;
        Ok(*status)
    }

    /// Get the registration ID for a session.
    pub async fn get_registration_id(&self, session_id: &str) -> Result<String, String> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(session_id)
            .ok_or("セッションが見つかりません")?;
        Ok(session.registration_id.clone())
    }

    /// Quit a session: send quit, kill process, remove from map.
    pub async fn quit(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        if let Some(mut session) = sessions.remove(session_id) {
            let _ = send_line(&session.stdin, "quit").await;
            session.stdout_task.abort();
            let _ = session.child.kill().await;
        }
        Ok(())
    }

    /// Clean up all sessions (for app shutdown).
    pub async fn quit_all(&self) {
        let mut sessions = self.sessions.lock().await;
        for (_, mut session) in sessions.drain() {
            let _ = send_line(&session.stdin, "quit").await;
            session.stdout_task.abort();
            let _ = session.child.kill().await;
        }
    }
}

// ── Helper functions ───────────────────────────────────────────────

/// Extract a single-token value for a key from USI option remainder.
/// e.g. for "default 1 min 1 max 512", key="default" → "1"
fn parse_kv_token(s: &str, key: &str) -> Option<String> {
    let prefix = format!("{key} ");
    let start = s.find(&prefix)? + prefix.len();
    let rest = &s[start..];
    let end = rest.find(' ').unwrap_or(rest.len());
    let val = rest[..end].trim();
    if val.is_empty() {
        None
    } else {
        Some(val.to_string())
    }
}

/// Extract value for "default" key that may span until "var" or end of string.
/// Used for combo/string/filename types where default value may contain spaces.
fn parse_kv_default_str(s: &str) -> Option<String> {
    let prefix = "default ";
    let start = s.find(prefix)? + prefix.len();
    let rest = &s[start..];
    if let Some(var_idx) = rest.find(" var ") {
        Some(rest[..var_idx].trim().to_string())
    } else {
        Some(rest.trim().to_string())
    }
}

fn parse_kv_bool(s: &str, key: &str) -> Option<bool> {
    let val = parse_kv_token(s, key)?;
    match val.as_str() {
        "true" => Some(true),
        "false" => Some(false),
        _ => None,
    }
}

fn parse_kv_i64(s: &str, key: &str) -> Option<i64> {
    let val = parse_kv_token(s, key)?;
    val.parse().ok()
}

/// Parse "var" entries from combo option remainder.
/// e.g. "default Normal var Normal var Suicide var ..." → ["Normal", "Suicide", ...]
fn parse_combo_vars(s: &str) -> Vec<String> {
    let mut vars = Vec::new();
    // Split on " var " boundaries
    for part in s.split(" var ") {
        let trimmed = part.trim();
        // Skip the part before first "var" (which contains "default ...")
        if trimmed.starts_with("default ") || trimmed.is_empty() {
            continue;
        }
        vars.push(trimmed.to_string());
    }
    vars
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── id name / id author ────────────────────────────────────────

    #[test]
    fn test_parse_id_name() {
        assert_eq!(
            parse_id_name("id name YaneuraOu NNUE 7.63"),
            Some("YaneuraOu NNUE 7.63".to_string())
        );
    }

    #[test]
    fn test_parse_id_name_with_spaces() {
        assert_eq!(
            parse_id_name("id name Suisho 7 kai"),
            Some("Suisho 7 kai".to_string())
        );
    }

    #[test]
    fn test_parse_id_name_empty() {
        assert_eq!(parse_id_name("id name "), None);
    }

    #[test]
    fn test_parse_id_name_not_matching() {
        assert_eq!(parse_id_name("id author someone"), None);
    }

    #[test]
    fn test_parse_id_author() {
        assert_eq!(
            parse_id_author("id author yaneurao"),
            Some("yaneurao".to_string())
        );
    }

    // ── option parsing ─────────────────────────────────────────────

    #[test]
    fn test_parse_option_check() {
        let opt = parse_option("option name USI_Ponder type check default false").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Check {
                name: "USI_Ponder".to_string(),
                default: false,
            }
        );
    }

    #[test]
    fn test_parse_option_spin() {
        let opt = parse_option("option name Threads type spin default 1 min 1 max 512").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Spin {
                name: "Threads".to_string(),
                default: 1,
                min: 1,
                max: 512,
            }
        );
    }

    #[test]
    fn test_parse_option_combo() {
        let opt = parse_option(
            "option name BookEvalBlackLimit type combo default 0 var -99999 var -200 var 0 var 200",
        )
        .unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Combo {
                name: "BookEvalBlackLimit".to_string(),
                default: "0".to_string(),
                vars: vec![
                    "-99999".to_string(),
                    "-200".to_string(),
                    "0".to_string(),
                    "200".to_string(),
                ],
            }
        );
    }

    #[test]
    fn test_parse_option_string() {
        let opt = parse_option("option name BookFile type string default book.db").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::String {
                name: "BookFile".to_string(),
                default: "book.db".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_string_empty_default() {
        let opt = parse_option("option name EvalDir type string default ").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::String {
                name: "EvalDir".to_string(),
                default: "".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_filename() {
        let opt = parse_option("option name EvalFile type filename default nn.bin").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Filename {
                name: "EvalFile".to_string(),
                default: "nn.bin".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_button() {
        let opt = parse_option("option name ClearHash type button").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Button {
                name: "ClearHash".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_name_with_spaces() {
        let opt =
            parse_option("option name USI_Hash type spin default 256 min 1 max 33554432").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Spin {
                name: "USI_Hash".to_string(),
                default: 256,
                min: 1,
                max: 33554432,
            }
        );
    }

    // ── info parsing ───────────────────────────────────────────────

    #[test]
    fn test_parse_info_full() {
        let event = parse_info(
            "info depth 20 seldepth 30 score cp 123 nodes 1000000 nps 500000 time 2000 multipv 1 hashfull 500 pv 7g7f 3c3d 2g2f",
        )
        .unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(20),
                seldepth: Some(30),
                nodes: Some(1000000),
                nps: Some(500000),
                time_ms: Some(2000),
                score_cp: Some(123),
                score_mate: None,
                multipv: Some(1),
                pv: Some(vec![
                    "7g7f".to_string(),
                    "3c3d".to_string(),
                    "2g2f".to_string()
                ]),
                hashfull: Some(500),
            }
        );
    }

    #[test]
    fn test_parse_info_mate() {
        let event = parse_info("info depth 15 score mate 5 pv 7g7f").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(15),
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: Some(5),
                multipv: None,
                pv: Some(vec!["7g7f".to_string()]),
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_negative_mate() {
        let event = parse_info("info depth 10 score mate -3").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(10),
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: Some(-3),
                multipv: None,
                pv: None,
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_string() {
        // "info string ..." should return Info with all None
        let event = parse_info("info string evaluating...").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: None,
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: None,
                multipv: None,
                pv: None,
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_minimal() {
        let event = parse_info("info depth 1").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(1),
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: None,
                multipv: None,
                pv: None,
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_not_info() {
        assert!(parse_info("bestmove 7g7f").is_none());
    }

    // ── bestmove parsing ───────────────────────────────────────────

    #[test]
    fn test_parse_bestmove_normal() {
        let event = parse_bestmove("bestmove 7g7f").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "7g7f".to_string(),
                ponder: None,
            }
        );
    }

    #[test]
    fn test_parse_bestmove_with_ponder() {
        let event = parse_bestmove("bestmove 7g7f ponder 3c3d").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "7g7f".to_string(),
                ponder: Some("3c3d".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_bestmove_resign() {
        let event = parse_bestmove("bestmove resign").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "resign".to_string(),
                ponder: None,
            }
        );
    }

    #[test]
    fn test_parse_bestmove_win() {
        let event = parse_bestmove("bestmove win").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "win".to_string(),
                ponder: None,
            }
        );
    }

    // ── parse_engine_line dispatch ─────────────────────────────────

    #[test]
    fn test_parse_engine_line_info() {
        let event = parse_engine_line("info depth 5 score cp 30").unwrap();
        assert!(matches!(event, UsiEngineEvent::Info { .. }));
    }

    #[test]
    fn test_parse_engine_line_bestmove() {
        let event = parse_engine_line("bestmove 2g2f").unwrap();
        assert!(matches!(event, UsiEngineEvent::BestMove { .. }));
    }

    #[test]
    fn test_parse_engine_line_usiok() {
        assert!(parse_engine_line("usiok").is_none());
    }

    #[test]
    fn test_parse_engine_line_readyok() {
        assert!(parse_engine_line("readyok").is_none());
    }

    // ── JSON serialization ─────────────────────────────────────────

    #[test]
    fn test_engine_event_info_json() {
        let event = UsiEngineEvent::Info {
            depth: Some(10),
            seldepth: None,
            nodes: Some(50000),
            nps: None,
            time_ms: None,
            score_cp: Some(42),
            score_mate: None,
            multipv: None,
            pv: Some(vec!["7g7f".to_string()]),
            hashfull: None,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "info");
        assert_eq!(json["depth"], 10);
        assert_eq!(json["scoreCp"], 42);
        assert_eq!(json["pv"], serde_json::json!(["7g7f"]));
        assert!(json["scoreMate"].is_null());
    }

    #[test]
    fn test_engine_event_bestmove_json() {
        let event = UsiEngineEvent::BestMove {
            mv: "2g2f".to_string(),
            ponder: Some("8c8d".to_string()),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "bestmove");
        assert_eq!(json["move"], "2g2f");
        assert_eq!(json["ponder"], "8c8d");
    }

    #[test]
    fn test_engine_event_error_json() {
        let event = UsiEngineEvent::Error {
            message: "process died".to_string(),
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "error");
        assert_eq!(json["message"], "process died");
    }

    // ── 追加テスト: option parsing edge cases ──────────────────────

    #[test]
    fn test_parse_option_check_default_true() {
        let opt = parse_option("option name USI_Ponder type check default true").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Check {
                name: "USI_Ponder".to_string(),
                default: true,
            }
        );
    }

    #[test]
    fn test_parse_option_spin_negative_min() {
        let opt =
            parse_option("option name Contempt type spin default 2 min -100 max 100").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Spin {
                name: "Contempt".to_string(),
                default: 2,
                min: -100,
                max: 100,
            }
        );
    }

    #[test]
    fn test_parse_option_spin_large_values() {
        let opt =
            parse_option("option name USI_Hash type spin default 16 min 1 max 1048576").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Spin {
                name: "USI_Hash".to_string(),
                default: 16,
                min: 1,
                max: 1048576,
            }
        );
    }

    #[test]
    fn test_parse_option_combo_single_var() {
        let opt =
            parse_option("option name BookDir type combo default standard var standard").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Combo {
                name: "BookDir".to_string(),
                default: "standard".to_string(),
                vars: vec!["standard".to_string()],
            }
        );
    }

    #[test]
    fn test_parse_option_string_with_path() {
        let opt =
            parse_option("option name EvalDir type string default /usr/local/share/eval").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::String {
                name: "EvalDir".to_string(),
                default: "/usr/local/share/eval".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_filename_with_path() {
        let opt =
            parse_option("option name BookFile type filename default /home/user/book.db").unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Filename {
                name: "BookFile".to_string(),
                default: "/home/user/book.db".to_string(),
            }
        );
    }

    #[test]
    fn test_parse_option_invalid_type() {
        assert!(parse_option("option name Foo type unknown default bar").is_none());
    }

    #[test]
    fn test_parse_option_no_option_prefix() {
        assert!(parse_option("id name something type check default true").is_none());
    }

    // ── 追加テスト: info parsing edge cases ────────────────────────

    #[test]
    fn test_parse_info_only_nodes() {
        let event = parse_info("info nodes 12345678").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: None,
                seldepth: None,
                nodes: Some(12345678),
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: None,
                multipv: None,
                pv: None,
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_multipv_with_score() {
        let event = parse_info("info depth 10 multipv 2 score cp -50 pv 3c3d 7g7f").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(10),
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: Some(-50),
                score_mate: None,
                multipv: Some(2),
                pv: Some(vec!["3c3d".to_string(), "7g7f".to_string()]),
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_hashfull_only() {
        let event = parse_info("info hashfull 999").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: None,
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: None,
                multipv: None,
                pv: None,
                hashfull: Some(999),
            }
        );
    }

    #[test]
    fn test_parse_info_negative_score_cp() {
        let event = parse_info("info depth 5 score cp -300").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(5),
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: Some(-300),
                score_mate: None,
                multipv: None,
                pv: None,
                hashfull: None,
            }
        );
    }

    #[test]
    fn test_parse_info_empty_pv() {
        // "pv" with no moves after it
        let event = parse_info("info depth 1 pv").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::Info {
                depth: Some(1),
                seldepth: None,
                nodes: None,
                nps: None,
                time_ms: None,
                score_cp: None,
                score_mate: None,
                multipv: None,
                pv: None,
                hashfull: None,
            }
        );
    }

    // ── 追加テスト: bestmove edge cases ────────────────────────────

    #[test]
    fn test_parse_bestmove_promotion() {
        let event = parse_bestmove("bestmove 7g7f+").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "7g7f+".to_string(),
                ponder: None,
            }
        );
    }

    #[test]
    fn test_parse_bestmove_drop() {
        let event = parse_bestmove("bestmove P*5e").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "P*5e".to_string(),
                ponder: None,
            }
        );
    }

    #[test]
    fn test_parse_bestmove_with_ponder_promotion() {
        let event = parse_bestmove("bestmove 2h2f ponder 8c8d").unwrap();
        assert_eq!(
            event,
            UsiEngineEvent::BestMove {
                mv: "2h2f".to_string(),
                ponder: Some("8c8d".to_string()),
            }
        );
    }

    #[test]
    fn test_parse_bestmove_empty() {
        assert!(parse_bestmove("bestmove ").is_none());
    }

    // ── 追加テスト: EngineEvent JSON normalization ─────────────────

    #[test]
    fn test_info_event_all_null_json() {
        let event = UsiEngineEvent::Info {
            depth: None,
            seldepth: None,
            nodes: None,
            nps: None,
            time_ms: None,
            score_cp: None,
            score_mate: None,
            multipv: None,
            pv: None,
            hashfull: None,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "info");
        assert!(json["depth"].is_null());
        assert!(json["pv"].is_null());
    }

    #[test]
    fn test_bestmove_resign_json() {
        let event = UsiEngineEvent::BestMove {
            mv: "resign".to_string(),
            ponder: None,
        };
        let json = serde_json::to_value(&event).unwrap();
        assert_eq!(json["type"], "bestmove");
        assert_eq!(json["move"], "resign");
        assert!(json["ponder"].is_null());
    }

    #[test]
    fn test_option_def_serialization() {
        let opt = UsiOptionDef::Spin {
            name: "Threads".to_string(),
            default: 4,
            min: 1,
            max: 128,
        };
        let json = serde_json::to_value(&opt).unwrap();
        assert_eq!(json["type"], "spin");
        assert_eq!(json["name"], "Threads");
        assert_eq!(json["default"], 4);
        assert_eq!(json["min"], 1);
        assert_eq!(json["max"], 128);
    }

    #[test]
    fn test_option_def_button_serialization() {
        let opt = UsiOptionDef::Button {
            name: "ClearHash".to_string(),
        };
        let json = serde_json::to_value(&opt).unwrap();
        assert_eq!(json["type"], "button");
        assert_eq!(json["name"], "ClearHash");
    }

    #[test]
    fn test_option_def_deserialization() {
        let json = serde_json::json!({
            "type": "check",
            "name": "USI_Ponder",
            "default": false
        });
        let opt: UsiOptionDef = serde_json::from_value(json).unwrap();
        assert_eq!(
            opt,
            UsiOptionDef::Check {
                name: "USI_Ponder".to_string(),
                default: false,
            }
        );
    }
}

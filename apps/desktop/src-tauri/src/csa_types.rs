//! CSA対局の共通型定義
//!
//! ## エラー処理方針
//!
//! `CsaError` は Serialize を実装しない。フロントエンドへのエラー通知は
//! `CsaSessionEvent::Error { message: String }` 経由で行い、
//! `Display` trait で文字列化する。

use serde::{Deserialize, Serialize};

// ─── CsaError ───

/// CSA対局で発生するエラー
///
/// フロントエンドへの送信は `CsaSessionEvent::Error` 経由。
/// `Display::to_string()` でメッセージを取得する。
#[derive(Debug)]
pub enum CsaError {
    ConnectionFailed(String),
    LoginFailed(String),
    ProtocolError(String),
    EngineTimeout,
    EngineCrashed,
    EngineError(String),
    ServerDisconnected,
    SessionAborted,
    Io(std::io::Error),
}

impl std::fmt::Display for CsaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConnectionFailed(s) => write!(f, "TCP接続失敗: {s}"),
            Self::LoginFailed(s) => write!(f, "ログイン失敗: {s}"),
            Self::ProtocolError(s) => write!(f, "プロトコルエラー: {s}"),
            Self::EngineTimeout => write!(f, "エンジン初期化タイムアウト"),
            Self::EngineCrashed => write!(f, "エンジンプロセス異常終了"),
            Self::EngineError(s) => write!(f, "エンジンエラー: {s}"),
            Self::ServerDisconnected => write!(f, "サーバー切断"),
            Self::SessionAborted => write!(f, "セッション中断"),
            Self::Io(e) => write!(f, "I/Oエラー: {e}"),
        }
    }
}

impl std::error::Error for CsaError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(e) => Some(e),
            _ => None,
        }
    }
}

impl From<std::io::Error> for CsaError {
    fn from(e: std::io::Error) -> Self {
        Self::Io(e)
    }
}

// ─── Time Configuration ───

/// CSA対局の時間設定
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TimeConfig {
    /// 持ち時間（ミリ秒）
    pub total_ms: i64,
    /// 秒読み（ミリ秒）
    pub byoyomi_ms: i64,
    /// フィッシャー加算（ミリ秒）
    pub increment_ms: i64,
}

/// 対局中のクロック状態
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Clock {
    pub black_time_ms: i64,
    pub white_time_ms: i64,
    pub byoyomi_ms: i64,
    pub increment_ms: i64,
}

/// フロントエンド向けクロック情報
#[derive(Clone, Debug, Serialize)]
pub struct ClockInfo {
    pub black_time_ms: i64,
    pub white_time_ms: i64,
    pub byoyomi_ms: i64,
    pub increment_ms: i64,
}

/// フロントエンド向けクロック更新
#[derive(Clone, Debug, Serialize)]
pub struct ClockUpdate {
    pub sente_ms: i64,
    pub gote_ms: i64,
}

// ─── Engine Parameters ───

/// CsaEngine に渡す go コマンドのパラメータ
#[derive(Clone, Debug)]
pub struct CsaGoParams {
    pub btime_ms: i64,
    pub wtime_ms: i64,
    pub byoyomi_ms: Option<i64>,
    pub binc_ms: Option<i64>,
    pub winc_ms: Option<i64>,
}

/// エンジンからの bestmove 結果
#[derive(Clone, Debug)]
pub enum BestMoveResult {
    Move { usi: String, ponder: Option<String> },
    Resign,
    Win,
}

/// エンジンからの探索情報
#[derive(Clone, Debug)]
pub struct CsaSearchInfo {
    pub depth: u32,
    pub score_cp: Option<i32>,
    pub score_mate: Option<i32>,
    pub pv: Vec<String>,
    pub nps: u64,
}

// ─── Game Summary ───

/// サーバーから受信する対局概要
#[derive(Clone, Debug)]
pub struct GameSummary {
    pub game_id: String,
    pub my_color: CsaColor,
    pub sente_name: String,
    pub gote_name: String,
    pub sfen: String,
    /// GAME_SUMMARY 内の CSA 盤面テキスト（非平手局面の Position 復元に使用）
    pub csa_board_text: String,
    pub black_time: TimeConfig,
    pub white_time: TimeConfig,
}

/// CSA対局における手番
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CsaColor {
    Sente,
    Gote,
}

impl CsaColor {
    pub fn is_sente(&self) -> bool {
        matches!(self, Self::Sente)
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Sente => "sente",
            Self::Gote => "gote",
        }
    }
}

// ─── Game Result ───

/// 対局結果
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameResult {
    Win,
    Lose,
    Draw,
    Censored,
    Interrupted,
}

// ─── Server Line ───

/// サーバーから受信した行のパース結果
#[derive(Clone, Debug)]
pub enum ServerLine {
    Move {
        csa: String,
        time_sec: u32,
    },
    GameEnd {
        result: GameResult,
        reason: Option<String>,
    },
    Start,
    Reject,
    Other(String),
}

// ─── Session Event (sent to frontend) ───

/// フロントエンドに送信する CSA セッションイベント
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CsaSessionEvent {
    Connected {
        host: String,
    },
    GameSummary {
        game_id: String,
        my_color: CsaColor,
        sente_name: String,
        gote_name: String,
        sfen: String,
        clocks: ClockInfo,
    },
    GameStarted,
    Move {
        side: CsaColor,
        usi: String,
        sfen: String,
        clock: ClockUpdate,
    },
    SearchInfo {
        depth: u32,
        score_cp: Option<i32>,
        score_mate: Option<i32>,
        pv: Vec<String>,
        nps: u64,
    },
    GameEnded {
        result: GameResult,
        reason: Option<String>,
        games_played: u32,
        record_path: Option<String>,
    },
    Disconnected,
    Error {
        message: String,
    },
}

// ─── Config (received from frontend) ───

/// フロントエンドから受信する CSA 接続設定
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CsaConfig {
    pub server: CsaServerConfig,
    pub engine: CsaEngineConfig,
    pub time: CsaTimeConfig,
    pub game: CsaGameConfig,
    pub record: CsaRecordConfig,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CsaServerConfig {
    pub host: String,
    pub port: u16,
    pub user_id: String,
    pub password: String,
    pub floodgate: bool,
}

impl std::fmt::Debug for CsaServerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CsaServerConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user_id", &self.user_id)
            .field("password", &"[REDACTED]")
            .field("floodgate", &self.floodgate)
            .finish()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CsaEngineConfig {
    #[serde(rename = "type")]
    pub engine_type: CsaEngineType,
    pub registration_id: Option<String>,
    pub options: std::collections::HashMap<String, serde_json::Value>,
    pub ponder: bool,
    #[serde(default = "default_startup_timeout_sec")]
    pub startup_timeout_sec: u64,
}

fn default_startup_timeout_sec() -> u64 {
    30
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CsaEngineType {
    Builtin,
    External,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CsaTimeConfig {
    #[serde(default)]
    pub margin_ms: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CsaGameConfig {
    #[serde(default = "default_max_games")]
    pub max_games: u32,
}

fn default_max_games() -> u32 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CsaRecordConfig {
    pub save_dir: String,
}

//! CSA対局の共通型定義
//!
//! ## エラー処理方針
//!
//! `CsaError` は Serialize を実装しない。フロントエンドへのエラー通知は
//! `CsaSessionEvent::Error { message: String }` 経由で行い、
//! `Display` trait で文字列化する。

use serde::{Deserialize, Serialize};

use rshogi_csa_client::events::{
    BestMoveEvent, DisconnectReason, GameEndEvent, GameEndReason, MoveEvent, MovePlayer,
    ReconnectState, SearchInfoSnapshot, SessionError, SessionProgress, Side,
};
use rshogi_csa_client::protocol::GameResult as OssGameResult;

// ─── CsaError ───

/// CSA対局で発生するエラー
///
/// フロントエンドへの送信は `CsaSessionEvent::Error` 経由。
/// `Display::to_string()` でメッセージを取得する。
#[derive(Debug)]
pub enum CsaError {
    ConfigInvalid(String),
    EngineError(String),
    Session(String),
    Io(std::io::Error),
}

impl std::fmt::Display for CsaError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConfigInvalid(s) => write!(f, "設定不正: {s}"),
            Self::EngineError(s) => write!(f, "エンジンエラー: {s}"),
            Self::Session(s) => write!(f, "セッションエラー: {s}"),
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

// ─── Game Result ───

/// 対局結果（フロントエンド向け文字列）
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameResult {
    Win,
    Lose,
    Draw,
    Censored,
    Interrupted,
}

impl From<OssGameResult> for GameResult {
    fn from(value: OssGameResult) -> Self {
        match value {
            OssGameResult::Win => Self::Win,
            OssGameResult::Lose => Self::Lose,
            OssGameResult::Draw => Self::Draw,
            OssGameResult::Censored => Self::Censored,
            OssGameResult::Interrupted => Self::Interrupted,
        }
    }
}

// ─── Side ───

/// 対局の手番（フロントエンド向け）
#[derive(Copy, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CsaSide {
    Black,
    White,
}

impl From<Side> for CsaSide {
    fn from(value: Side) -> Self {
        match value {
            Side::Black => Self::Black,
            Side::White => Self::White,
        }
    }
}

// ─── Search info / move snapshots ───

/// 累積探索情報（フロントエンド向け）
#[derive(Clone, Debug, Default, Serialize)]
pub struct CsaSearchInfo {
    pub depth: Option<u32>,
    pub seldepth: Option<u32>,
    pub score_cp: Option<i32>,
    pub score_mate: Option<i32>,
    pub nodes: Option<u64>,
    pub nps: Option<u64>,
    pub time_ms: Option<u64>,
    pub pv: Vec<String>,
}

impl From<&SearchInfoSnapshot> for CsaSearchInfo {
    fn from(value: &SearchInfoSnapshot) -> Self {
        Self {
            depth: value.depth,
            seldepth: value.seldepth,
            score_cp: value.score_cp,
            score_mate: value.mate,
            nodes: value.nodes,
            nps: value.nps,
            time_ms: value.time_ms,
            pv: value.pv.clone(),
        }
    }
}

// ─── Session Event (sent to frontend) ───

/// `MovePlayer` を文字列に変換する。
fn move_player_str(player: MovePlayer) -> &'static str {
    match player {
        MovePlayer::SelfPlayer => "self",
        MovePlayer::Opponent => "opponent",
    }
}

/// `GameEndReason` を snake_case 文字列に変換する。
fn game_end_reason_str(reason: &GameEndReason) -> String {
    match reason {
        GameEndReason::Resign => "resign".to_string(),
        GameEndReason::TimeUp => "time_up".to_string(),
        GameEndReason::IllegalMove => "illegal_move".to_string(),
        GameEndReason::Jishogi => "jishogi".to_string(),
        GameEndReason::Sennichite => "sennichite".to_string(),
        GameEndReason::MaxMoves => "max_moves".to_string(),
        GameEndReason::Censored => "censored".to_string(),
        GameEndReason::Interrupted => "interrupted".to_string(),
        GameEndReason::OtherDisconnect => "other_disconnect".to_string(),
        GameEndReason::Unknown(s) => format!("unknown:{s}"),
    }
}

/// `DisconnectReason` を snake_case 文字列に変換する。
fn disconnect_reason_str(reason: &DisconnectReason) -> String {
    match reason {
        DisconnectReason::GameOver => "game_over".to_string(),
        DisconnectReason::Shutdown => "shutdown".to_string(),
        DisconnectReason::SinkAborted => "sink_aborted".to_string(),
        DisconnectReason::TransportError(s) => format!("transport_error:{s}"),
        DisconnectReason::Unknown => "unknown".to_string(),
    }
}

/// `SessionError` の variant 種別を表す文字列を返す。
fn session_error_kind(error: &SessionError) -> &'static str {
    match error {
        SessionError::Network(_) => "network",
        SessionError::Protocol(_) => "protocol",
        SessionError::Engine(_) => "engine",
        SessionError::Shutdown => "shutdown",
        SessionError::SinkAborted(_) => "sink_aborted",
        SessionError::Other(_) => "other",
    }
}

/// フロントエンドに送信する CSA セッションイベント
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CsaSessionEvent {
    Connected,
    GameSummary {
        game_id: String,
        my_color: CsaSide,
        sente_name: String,
        gote_name: String,
    },
    Resumed {
        game_id: String,
        sente_name: String,
        gote_name: String,
        last_sfen: String,
        last_ply: u32,
        side_to_move: CsaSide,
        remaining_time_sec_self: Option<u32>,
        remaining_time_sec_opp: Option<u32>,
    },
    GameStarted,
    BestMoveSelected {
        usi_move: String,
        csa_move: Option<String>,
        ponder: Option<String>,
        side: CsaSide,
        ply: u32,
    },
    MoveSent {
        player: &'static str,
        usi_move: String,
        csa_move: String,
        side: CsaSide,
        ply: u32,
        sfen_before: String,
        sfen_after: String,
    },
    Move {
        player: &'static str,
        usi_move: String,
        csa_move: String,
        side: CsaSide,
        ply: u32,
        time_sec: Option<u32>,
        sfen_before: String,
        sfen_after: String,
        search: Option<CsaSearchInfo>,
    },
    SearchInfo {
        info: CsaSearchInfo,
    },
    GameEnded {
        result: GameResult,
        reason: String,
        winner: Option<CsaSide>,
        raw_result_line: Option<String>,
        raw_reason_line: Option<String>,
    },
    Disconnected {
        reason: String,
    },
    Error {
        kind: &'static str,
        message: String,
    },
}

impl CsaSessionEvent {
    /// `SessionProgress` を `CsaSessionEvent` に変換する。
    pub fn from_session_progress(progress: SessionProgress) -> Self {
        match progress {
            SessionProgress::Connected => Self::Connected,
            SessionProgress::GameSummary(summary) => Self::GameSummary {
                game_id: summary.game_id.clone(),
                my_color: CsaSide::from(Side::from(summary.my_color)),
                sente_name: summary.sente_name.clone(),
                gote_name: summary.gote_name.clone(),
            },
            SessionProgress::Resumed { summary, state } => Self::from_resumed(&summary, &state),
            SessionProgress::GameStarted => Self::GameStarted,
            SessionProgress::BestMoveSelected(event) => Self::from_best_move(event),
            SessionProgress::MoveSent(event) => Self::from_move_sent(event),
            SessionProgress::MoveConfirmed(event) => Self::from_move_confirmed(event),
            SessionProgress::SearchInfo(snapshot) => Self::SearchInfo {
                info: CsaSearchInfo::from(&snapshot),
            },
            SessionProgress::GameEnded(event) => Self::from_game_end(event),
            SessionProgress::Disconnected { reason } => Self::Disconnected {
                reason: disconnect_reason_str(&reason),
            },
        }
    }

    /// `SessionError` を `Error` event に変換する。
    pub fn from_session_error(error: &SessionError) -> Self {
        Self::Error {
            kind: session_error_kind(error),
            message: error.to_string(),
        }
    }

    fn from_resumed(
        summary: &rshogi_csa_client::protocol::GameSummary,
        state: &ReconnectState,
    ) -> Self {
        Self::Resumed {
            game_id: summary.game_id.clone(),
            sente_name: summary.sente_name.clone(),
            gote_name: summary.gote_name.clone(),
            last_sfen: state.last_sfen.clone(),
            last_ply: state.last_ply,
            side_to_move: CsaSide::from(state.side_to_move),
            remaining_time_sec_self: state.remaining_time_sec_self,
            remaining_time_sec_opp: state.remaining_time_sec_opp,
        }
    }

    fn from_best_move(event: BestMoveEvent) -> Self {
        Self::BestMoveSelected {
            usi_move: event.usi_move,
            csa_move: event.csa_move_candidate,
            ponder: event.ponder,
            side: CsaSide::from(event.side),
            ply: event.ply,
        }
    }

    fn from_move_sent(event: MoveEvent) -> Self {
        Self::MoveSent {
            player: move_player_str(event.player),
            usi_move: event.usi_move,
            csa_move: event.csa_move,
            side: CsaSide::from(event.side),
            ply: event.ply,
            sfen_before: event.sfen_before,
            sfen_after: event.sfen_after,
        }
    }

    fn from_move_confirmed(event: MoveEvent) -> Self {
        Self::Move {
            player: move_player_str(event.player),
            usi_move: event.usi_move,
            csa_move: event.csa_move,
            side: CsaSide::from(event.side),
            ply: event.ply,
            time_sec: event.time_sec,
            sfen_before: event.sfen_before,
            sfen_after: event.sfen_after,
            search: event.search.as_ref().map(CsaSearchInfo::from),
        }
    }

    fn from_game_end(event: GameEndEvent) -> Self {
        Self::GameEnded {
            result: GameResult::from(event.result),
            reason: game_end_reason_str(&event.reason),
            winner: event.winner.map(CsaSide::from),
            raw_result_line: event.raw_result_line,
            raw_reason_line: event.raw_reason_line,
        }
    }
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
    /// 再接続情報（resume 経路のみ）
    #[serde(default)]
    pub reconnect: Option<CsaReconnectConfig>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CsaServerConfig {
    pub host: String,
    pub port: u16,
    pub user_id: String,
    pub password: String,
    pub floodgate: bool,
    #[serde(default = "default_tcp_keepalive")]
    pub tcp_keepalive: bool,
}

fn default_tcp_keepalive() -> bool {
    true
}

impl std::fmt::Debug for CsaServerConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CsaServerConfig")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user_id", &self.user_id)
            .field("password", &"[REDACTED]")
            .field("floodgate", &self.floodgate)
            .field("tcp_keepalive", &self.tcp_keepalive)
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
    pub margin_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CsaGameConfig {
    #[serde(default = "default_max_games")]
    pub max_games: u32,
    #[serde(default)]
    pub restart_engine_every_game: bool,
}

fn default_max_games() -> u32 {
    1
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CsaRecordConfig {
    /// 棋譜保存先ディレクトリ。空文字の場合は保存しない (OSS 側 record.enabled=false 固定)。
    #[serde(default)]
    pub save_dir: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CsaReconnectConfig {
    pub game_id: String,
    pub token: String,
}

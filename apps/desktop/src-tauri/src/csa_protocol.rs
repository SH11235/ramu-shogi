//! CSAプロトコル通信層
//!
//! TCP接続によるCSAサーバーとのテキスト行ベース通信を管理する。
//! LOGIN → GAME_SUMMARY 受信 → AGREE → START → 対局IO分離 の流れを提供する。

use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::net::TcpStream;
use tokio::net::tcp::{OwnedReadHalf, OwnedWriteHalf};
use tokio::sync::mpsc;

use crate::csa_types::{CsaColor, CsaError, GameResult, GameSummary, ServerLine, TimeConfig};

/// デフォルトの keep-alive 間隔（秒）
const KEEPALIVE_INTERVAL_SECS: u64 = 30;

// ─── CsaProtocol ───

/// CSAサーバーとの接続を管理する。
pub struct CsaProtocol {
    reader: BufReader<OwnedReadHalf>,
    writer: BufWriter<OwnedWriteHalf>,
}

impl CsaProtocol {
    /// CSAサーバーに TCP 接続する。
    pub async fn connect(host: &str, port: u16) -> Result<Self, CsaError> {
        let addr = format!("{host}:{port}");
        let stream = TcpStream::connect(&addr)
            .await
            .map_err(|e| CsaError::ConnectionFailed(format!("{addr}: {e}")))?;

        stream.set_nodelay(true).ok();

        let (read_half, write_half) = stream.into_split();
        Ok(Self {
            reader: BufReader::new(read_half),
            writer: BufWriter::new(write_half),
        })
    }

    /// LOGIN コマンドを送信し、応答を検証する。
    pub async fn login(&mut self, id: &str, password: &str) -> Result<(), CsaError> {
        self.send_line(&format!("LOGIN {id} {password}")).await?;

        loop {
            let line = self.recv_line().await?;
            if line.starts_with("LOGIN:") {
                if line.contains("OK") {
                    return Ok(());
                }
                return Err(CsaError::LoginFailed(line));
            }
            // LOGIN 応答以外の行（サーバーバナー等）はスキップ
        }
    }

    /// GAME_SUMMARY を受信してパースする。
    /// keep-alive として定期的に空行を送信する。
    pub async fn recv_game_summary(&mut self) -> Result<GameSummary, CsaError> {
        let keepalive = Duration::from_secs(KEEPALIVE_INTERVAL_SECS);
        let mut in_summary = false;
        let mut summary_lines: Vec<String> = Vec::new();

        loop {
            let line = tokio::select! {
                result = self.recv_line() => result?,
                () = tokio::time::sleep(keepalive) => {
                    self.send_line("").await.ok();
                    continue;
                }
            };

            let trimmed = line.trim();

            if trimmed == "BEGIN Game_Summary" {
                in_summary = true;
                summary_lines.clear();
                continue;
            }

            if !in_summary {
                continue;
            }

            if trimmed == "END Game_Summary" {
                return parse_game_summary_lines(&summary_lines);
            }

            summary_lines.push(trimmed.to_string());
        }
    }

    /// AGREE を送信し、START を待つ。
    pub async fn agree(&mut self, game_id: &str) -> Result<(), CsaError> {
        self.send_line(&format!("AGREE {game_id}")).await?;

        loop {
            let line = self.recv_line().await?;
            let trimmed = line.trim();
            if trimmed.starts_with("START:") {
                return Ok(());
            }
            if trimmed.starts_with("REJECT:") {
                return Err(CsaError::ProtocolError(format!(
                    "サーバーが対局を拒否: {trimmed}"
                )));
            }
        }
    }

    /// REJECT を送信する。
    #[allow(dead_code)]
    pub async fn reject(&mut self, game_id: &str) -> Result<(), CsaError> {
        self.send_line(&format!("REJECT {game_id}")).await
    }

    /// 対局 IO モードに遷移する。
    /// reader を tokio タスクで非同期読み取りし、ServerLine を mpsc で提供する。
    pub fn start_game_io(self) -> (CsaGameIo, mpsc::Receiver<ServerLine>) {
        let (tx, rx) = mpsc::channel(64);
        tokio::spawn(reader_task(self.reader, tx));
        let io = CsaGameIo {
            writer: self.writer,
        };
        (io, rx)
    }

    async fn send_line(&mut self, line: &str) -> Result<(), CsaError> {
        let data = format!("{line}\n");
        self.writer.write_all(data.as_bytes()).await?;
        self.writer.flush().await?;
        Ok(())
    }

    async fn recv_line(&mut self) -> Result<String, CsaError> {
        let mut line = String::new();
        let n = self.reader.read_line(&mut line).await?;
        if n == 0 {
            return Err(CsaError::ServerDisconnected);
        }
        Ok(line.trim_end_matches(['\r', '\n']).to_string())
    }
}

// ─── CsaGameIo ───

/// 対局中のサーバー送信側。reader は別タスクで ServerLine を mpsc に流す。
pub struct CsaGameIo {
    writer: BufWriter<OwnedWriteHalf>,
}

impl CsaGameIo {
    /// CSA形式の指し手を送信する。
    pub async fn send_move(&mut self, csa_move: &str) -> Result<(), CsaError> {
        self.send_line(csa_move).await
    }

    /// 特殊コマンド（%TORYO, %KACHI 等）を送信する。
    pub async fn send_special(&mut self, cmd: &str) -> Result<(), CsaError> {
        self.send_line(cmd).await
    }

    /// Floodgate 評価値コメントを送信する。
    pub async fn send_comment(&mut self, comment: &str) -> Result<(), CsaError> {
        self.send_line(comment).await
    }

    /// LOGOUT を送信する。
    pub async fn logout(&mut self) -> Result<(), CsaError> {
        self.send_line("LOGOUT").await
    }

    /// 連続対局: 次の GAME_SUMMARY を待つ。
    pub async fn recv_next_game_summary(
        &mut self,
        server_rx: &mut mpsc::Receiver<ServerLine>,
    ) -> Result<GameSummary, CsaError> {
        let keepalive = Duration::from_secs(KEEPALIVE_INTERVAL_SECS);
        let mut in_summary = false;
        let mut lines: Vec<String> = Vec::new();

        loop {
            let server_line = tokio::select! {
                line = server_rx.recv() => {
                    line.ok_or(CsaError::ServerDisconnected)?
                }
                () = tokio::time::sleep(keepalive) => {
                    self.send_line("").await.ok();
                    continue;
                }
            };

            if let ServerLine::Other(ref text) = server_line {
                let trimmed = text.trim();
                if trimmed == "BEGIN Game_Summary" {
                    in_summary = true;
                    lines.clear();
                    continue;
                }
                if in_summary {
                    if trimmed == "END Game_Summary" {
                        return parse_game_summary_lines(&lines);
                    }
                    lines.push(trimmed.to_string());
                }
            }
        }
    }

    async fn send_line(&mut self, line: &str) -> Result<(), CsaError> {
        let data = format!("{line}\n");
        self.writer.write_all(data.as_bytes()).await?;
        self.writer.flush().await?;
        Ok(())
    }
}

// ─── Reader Task ───

async fn reader_task(reader: BufReader<OwnedReadHalf>, tx: mpsc::Sender<ServerLine>) {
    let mut reader = reader;
    let mut buf = String::new();

    loop {
        buf.clear();
        match reader.read_line(&mut buf).await {
            Ok(0) => break,
            Ok(_) => {
                let trimmed = buf.trim_end_matches(['\r', '\n']);
                if trimmed.is_empty() {
                    continue;
                }
                let server_line = parse_server_line(trimmed);
                if tx.send(server_line).await.is_err() {
                    break;
                }
            }
            Err(_) => break,
        }
    }
}

/// サーバー行を ServerLine にパースする。
fn parse_server_line(line: &str) -> ServerLine {
    match line {
        "#WIN" => ServerLine::GameEnd {
            result: GameResult::Win,
            reason: None,
        },
        "#LOSE" => ServerLine::GameEnd {
            result: GameResult::Lose,
            reason: None,
        },
        "#DRAW" => ServerLine::GameEnd {
            result: GameResult::Draw,
            reason: None,
        },
        "#CENSORED" => ServerLine::GameEnd {
            result: GameResult::Censored,
            reason: None,
        },
        "#CHUDAN" => ServerLine::GameEnd {
            result: GameResult::Interrupted,
            reason: None,
        },
        _ if line.starts_with("START:") => ServerLine::Start,
        _ if line.starts_with("REJECT:") => ServerLine::Reject,
        _ if (line.starts_with('+') || line.starts_with('-')) && line.len() >= 7 => {
            let (move_part, time_part) = if let Some(idx) = line.find(",T") {
                (&line[..idx], &line[idx + 2..])
            } else {
                (line, "0")
            };
            ServerLine::Move {
                csa: move_part.to_string(),
                time_sec: time_part.parse::<u32>().unwrap_or(0),
            }
        }
        _ => ServerLine::Other(line.to_string()),
    }
}

// ─── Helper Functions ───

fn parse_time_unit(unit: &str) -> i64 {
    match unit {
        "msec" => 1,
        "sec" => 1000,
        "min" => 60_000,
        _ => 1000,
    }
}

fn parse_game_summary_lines(lines: &[String]) -> Result<GameSummary, CsaError> {
    let mut game_id = String::new();
    let mut my_color = CsaColor::Sente;
    let mut sente_name = String::new();
    let mut gote_name = String::new();
    let mut position_lines: Vec<String> = Vec::new();
    let mut time_unit_ms: i64 = 1000;
    let mut total_time: i64 = 0;
    let mut byoyomi: i64 = 0;
    let mut increment: i64 = 0;

    for line in lines {
        let trimmed = line.trim();
        if let Some(val) = trimmed.strip_prefix("Game_ID:") {
            game_id = val.trim().to_string();
        } else if trimmed == "Your_Turn:+" {
            my_color = CsaColor::Sente;
        } else if trimmed == "Your_Turn:-" {
            my_color = CsaColor::Gote;
        } else if let Some(val) = trimmed.strip_prefix("Name+:") {
            sente_name = val.trim().to_string();
        } else if let Some(val) = trimmed.strip_prefix("Name-:") {
            gote_name = val.trim().to_string();
        } else if let Some(val) = trimmed.strip_prefix("Time_Unit:") {
            time_unit_ms = parse_time_unit(val.trim());
        } else if let Some(val) = trimmed.strip_prefix("Total_Time:") {
            total_time = val.trim().parse::<i64>().unwrap_or(0);
        } else if let Some(val) = trimmed.strip_prefix("Byoyomi:") {
            byoyomi = val.trim().parse::<i64>().unwrap_or(0);
        } else if let Some(val) = trimmed.strip_prefix("Increment:") {
            increment = val.trim().parse::<i64>().unwrap_or(0);
        } else if trimmed.starts_with('P') || trimmed == "+" || trimmed == "-" || trimmed == "PI" {
            position_lines.push(trimmed.to_string());
        }
    }

    let position_text = position_lines.join("\n");
    let sfen = if position_text.is_empty() {
        "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1".to_string()
    } else {
        let (pos, _, _) = rshogi_csa::parse_csa(&position_text)
            .map_err(|e| CsaError::ProtocolError(format!("局面パースエラー: {e}")))?;
        pos.to_sfen()
    };

    let time_config = TimeConfig {
        total_ms: total_time * time_unit_ms,
        byoyomi_ms: byoyomi * time_unit_ms,
        increment_ms: increment * time_unit_ms,
    };

    Ok(GameSummary {
        game_id,
        my_color,
        sente_name,
        gote_name,
        sfen,
        black_time: time_config.clone(),
        white_time: time_config,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_time_unit() {
        assert_eq!(parse_time_unit("msec"), 1);
        assert_eq!(parse_time_unit("sec"), 1000);
        assert_eq!(parse_time_unit("min"), 60_000);
        assert_eq!(parse_time_unit("unknown"), 1000);
    }

    #[test]
    fn test_parse_server_line_move() {
        match parse_server_line("+7776FU,T5") {
            ServerLine::Move { csa, time_sec } => {
                assert_eq!(csa, "+7776FU");
                assert_eq!(time_sec, 5);
            }
            _ => panic!("expected Move"),
        }
    }

    #[test]
    fn test_parse_server_line_move_no_time() {
        match parse_server_line("-3334FU") {
            ServerLine::Move { csa, time_sec } => {
                assert_eq!(csa, "-3334FU");
                assert_eq!(time_sec, 0);
            }
            _ => panic!("expected Move"),
        }
    }

    #[test]
    fn test_parse_server_line_game_end() {
        assert!(matches!(
            parse_server_line("#WIN"),
            ServerLine::GameEnd {
                result: GameResult::Win,
                ..
            }
        ));
        assert!(matches!(
            parse_server_line("#LOSE"),
            ServerLine::GameEnd {
                result: GameResult::Lose,
                ..
            }
        ));
        assert!(matches!(
            parse_server_line("#DRAW"),
            ServerLine::GameEnd {
                result: GameResult::Draw,
                ..
            }
        ));
    }

    #[test]
    fn test_parse_game_summary_lines_hirate() {
        let lines = vec![
            "Game_ID:test-001".into(),
            "Your_Turn:+".into(),
            "Name+:EngineA".into(),
            "Name-:EngineB".into(),
            "Time_Unit:sec".into(),
            "Total_Time:600".into(),
            "Byoyomi:10".into(),
        ];
        let s = parse_game_summary_lines(&lines).unwrap();
        assert_eq!(s.game_id, "test-001");
        assert_eq!(s.my_color, CsaColor::Sente);
        assert_eq!(s.black_time.total_ms, 600_000);
        assert_eq!(s.black_time.byoyomi_ms, 10_000);
        assert_eq!(
            s.sfen,
            "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1"
        );
    }
}

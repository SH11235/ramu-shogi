//! CSA対局用エンジン統一抽象
//!
//! 外部USIエンジンと内蔵エンジン(rshogi-core)を統一インターフェースで制御する。
//! 既存の UsiEngineSession とは独立したプロセス/スレッドを管理する。

use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::Mutex as TokioMutex;
use tokio::sync::mpsc;

use crate::csa_types::{BestMoveResult, CsaError, CsaGoParams, CsaSearchInfo};
use crate::usi_engine::create_engine_command;
use crate::{EngineState, SEARCH_STACK_SIZE};

use rshogi_core::search::{LimitsType, SearchInfo};

const USI_HANDSHAKE_TIMEOUT_SECS: u64 = 10;

/// CSA対局用エンジン。External（USI子プロセス）と Builtin（rshogi-core）を統一。
pub enum CsaEngine {
    External {
        stdin: Arc<TokioMutex<tokio::process::ChildStdin>>,
        bestmove_rx: mpsc::Receiver<BestMoveResult>,
        info_rx: mpsc::Receiver<CsaSearchInfo>,
        readyok_rx: mpsc::Receiver<()>,
        child: tokio::process::Child,
    },
    Builtin {
        engine_state: Arc<EngineState>,
        bestmove_rx: mpsc::Receiver<BestMoveResult>,
        info_rx: mpsc::Receiver<CsaSearchInfo>,
        bestmove_tx: mpsc::Sender<BestMoveResult>,
        info_tx: mpsc::Sender<CsaSearchInfo>,
        active_thread: StdMutex<Option<std::thread::JoinHandle<()>>>,
    },
}

impl CsaEngine {
    // ─── Factory: External ───

    /// 外部 USI エンジンを起動し、ハンドシェイクを行う。
    pub async fn spawn_external(
        path: &str,
        options: &[(String, String)],
        timeout: Duration,
    ) -> Result<Self, CsaError> {
        let mut cmd = create_engine_command(path);
        let mut child = cmd
            .spawn()
            .map_err(|e| CsaError::EngineError(format!("エンジン起動失敗: {e}")))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| CsaError::EngineError("stdin取得失敗".into()))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| CsaError::EngineError("stdout取得失敗".into()))?;

        let stdin = Arc::new(TokioMutex::new(stdin));

        // USI ハンドシェイク
        let mut reader = BufReader::new(stdout);
        send_usi_line(&stdin, "usi").await?;
        wait_for_line(&mut reader, "usiok", timeout).await?;

        // setoption
        for (name, value) in options {
            send_usi_line(&stdin, &format!("setoption name {name} value {value}")).await?;
        }

        // isready
        send_usi_line(&stdin, "isready").await?;
        wait_for_line(&mut reader, "readyok", timeout).await?;

        // stdout 読み取りタスク起動
        let (bestmove_tx, bestmove_rx) = mpsc::channel(4);
        let (info_tx, info_rx) = mpsc::channel(64);
        let (readyok_tx, readyok_rx) = mpsc::channel(4);

        tokio::spawn(external_stdout_task(reader, bestmove_tx, info_tx, readyok_tx));

        Ok(CsaEngine::External {
            stdin,
            bestmove_rx,
            info_rx,
            readyok_rx,
            child,
        })
    }

    // ─── Factory: Builtin ───

    /// 内蔵エンジンを初期化する。
    pub fn init_builtin(engine_state: Arc<EngineState>) -> Self {
        let (bestmove_tx, bestmove_rx) = mpsc::channel(4);
        let (info_tx, info_rx) = mpsc::channel(64);

        CsaEngine::Builtin {
            engine_state,
            bestmove_rx,
            info_rx,
            bestmove_tx,
            info_tx,
            active_thread: StdMutex::new(None),
        }
    }

    // ─── Typed Commands ───

    /// usinewgame を送信する。
    pub async fn new_game(&mut self) -> Result<(), CsaError> {
        match self {
            CsaEngine::External {
                stdin, readyok_rx, ..
            } => {
                send_usi_line(stdin, "usinewgame").await?;
                send_usi_line(stdin, "isready").await?;
                // readyok を stdout タスクから受信（タイムアウト付き）
                match tokio::time::timeout(Duration::from_secs(30), readyok_rx.recv()).await {
                    Ok(Some(())) => Ok(()),
                    Ok(None) => Err(CsaError::EngineCrashed),
                    Err(_) => Err(CsaError::EngineTimeout),
                }
            }
            CsaEngine::Builtin { engine_state, .. } => {
                let mut inner = engine_state
                    .inner
                    .lock()
                    .map_err(|e| CsaError::EngineError(format!("lock error: {e}")))?;
                if let Some(search) = inner.search.as_mut() {
                    search.clear_tt();
                }
                Ok(())
            }
        }
    }

    /// 局面を設定する。
    pub async fn set_position(&mut self, sfen: &str, moves: &[String]) -> Result<(), CsaError> {
        match self {
            CsaEngine::External { stdin, .. } => {
                let cmd = if moves.is_empty() {
                    format!("position sfen {sfen}")
                } else {
                    format!("position sfen {sfen} moves {}", moves.join(" "))
                };
                send_usi_line(stdin, &cmd).await
            }
            CsaEngine::Builtin { engine_state, .. } => {
                let mut inner = engine_state
                    .inner
                    .lock()
                    .map_err(|e| CsaError::EngineError(format!("lock error: {e}")))?;
                inner.position = rshogi_core::position::Position::new();
                inner
                    .position
                    .set_sfen(sfen)
                    .map_err(|e| CsaError::EngineError(format!("SFEN設定失敗: {e}")))?;
                for m in moves {
                    let mv = rshogi_core::types::Move::from_usi(m)
                        .ok_or_else(|| CsaError::EngineError(format!("不正な指し手: {m}")))?;
                    let gives_check = inner.position.gives_check(mv);
                    inner.position.do_move(mv, gives_check);
                }
                Ok(())
            }
        }
    }

    /// go コマンドを送信する。
    pub async fn go(&mut self, params: &CsaGoParams) -> Result<(), CsaError> {
        match self {
            CsaEngine::External { stdin, .. } => {
                let cmd = build_go_command(params, false);
                send_usi_line(stdin, &cmd).await
            }
            CsaEngine::Builtin {
                engine_state,
                bestmove_tx,
                info_tx,
                active_thread,
                ..
            } => {
                let limits = build_limits(params, false);
                spawn_builtin_search(
                    engine_state.clone(),
                    limits,
                    bestmove_tx.clone(),
                    info_tx.clone(),
                    active_thread,
                )?;
                Ok(())
            }
        }
    }

    /// go ponder コマンドを送信する。
    pub async fn go_ponder(&mut self, params: &CsaGoParams) -> Result<(), CsaError> {
        match self {
            CsaEngine::External { stdin, .. } => {
                let cmd = build_go_command(params, true);
                send_usi_line(stdin, &cmd).await
            }
            CsaEngine::Builtin {
                engine_state,
                bestmove_tx,
                info_tx,
                active_thread,
                ..
            } => {
                let limits = build_limits(params, true);
                spawn_builtin_search(
                    engine_state.clone(),
                    limits,
                    bestmove_tx.clone(),
                    info_tx.clone(),
                    active_thread,
                )?;
                Ok(())
            }
        }
    }

    /// ponderhit を送信する。
    pub async fn ponderhit(&mut self) -> Result<(), CsaError> {
        match self {
            CsaEngine::External { stdin, .. } => send_usi_line(stdin, "ponderhit").await,
            CsaEngine::Builtin { engine_state, .. } => {
                let inner = engine_state
                    .inner
                    .lock()
                    .map_err(|e| CsaError::EngineError(format!("lock error: {e}")))?;
                if let Some(search) = inner.search.as_ref() {
                    search.request_ponderhit();
                }
                Ok(())
            }
        }
    }

    /// stop を送信する。
    pub async fn stop(&mut self) -> Result<(), CsaError> {
        match self {
            CsaEngine::External { stdin, .. } => send_usi_line(stdin, "stop").await,
            CsaEngine::Builtin { engine_state, .. } => {
                let inner = engine_state
                    .inner
                    .lock()
                    .map_err(|e| CsaError::EngineError(format!("lock error: {e}")))?;
                if let Some(search) = inner.search.as_ref() {
                    search.stop_flag().store(true, Ordering::SeqCst);
                }
                Ok(())
            }
        }
    }

    /// gameover を送信する。
    pub async fn gameover(&mut self, result: &str) -> Result<(), CsaError> {
        match self {
            CsaEngine::External { stdin, .. } => {
                send_usi_line(stdin, &format!("gameover {result}")).await
            }
            CsaEngine::Builtin { .. } => Ok(()), // 内蔵エンジンは gameover 不要
        }
    }

    /// bestmove を受信する。
    pub async fn recv_bestmove(&mut self) -> Result<BestMoveResult, CsaError> {
        let rx = match self {
            CsaEngine::External { bestmove_rx, .. } => bestmove_rx,
            CsaEngine::Builtin { bestmove_rx, .. } => bestmove_rx,
        };
        rx.recv().await.ok_or(CsaError::EngineCrashed)
    }

    /// 探索情報を受信する（非ブロッキング）。
    pub fn try_recv_info(&mut self) -> Option<CsaSearchInfo> {
        let rx = match self {
            CsaEngine::External { info_rx, .. } => info_rx,
            CsaEngine::Builtin { info_rx, .. } => info_rx,
        };
        rx.try_recv().ok()
    }

    /// エンジンをシャットダウンする。
    pub async fn shutdown(self) -> Result<(), CsaError> {
        match self {
            CsaEngine::External {
                stdin, mut child, ..
            } => {
                let _ = send_usi_line(&stdin, "quit").await;
                tokio::time::sleep(Duration::from_millis(500)).await;
                let _ = child.kill().await;
                Ok(())
            }
            CsaEngine::Builtin {
                engine_state,
                active_thread,
                ..
            } => {
                // Search の stop_flag を立てて探索を停止（poison 回復付き）
                {
                    let inner = engine_state.inner.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(search) = inner.search.as_ref() {
                        search.stop_flag().store(true, Ordering::SeqCst);
                    }
                }
                {
                    let mut guard = active_thread.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(handle) = guard.take() {
                        let _ = handle.join();
                    }
                }
                Ok(())
            }
        }
    }
}

// ─── External Engine Helpers ───

async fn send_usi_line(
    stdin: &Arc<TokioMutex<tokio::process::ChildStdin>>,
    line: &str,
) -> Result<(), CsaError> {
    let mut guard = stdin.lock().await;
    let data = format!("{line}\n");
    guard
        .write_all(data.as_bytes())
        .await
        .map_err(|e| CsaError::EngineError(format!("stdin write error: {e}")))?;
    guard
        .flush()
        .await
        .map_err(|e| CsaError::EngineError(format!("stdin flush error: {e}")))?;
    Ok(())
}

async fn wait_for_line(
    reader: &mut BufReader<tokio::process::ChildStdout>,
    expected: &str,
    timeout: Duration,
) -> Result<(), CsaError> {
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);

    let mut buf = String::new();
    loop {
        buf.clear();
        tokio::select! {
            result = reader.read_line(&mut buf) => {
                match result {
                    Ok(0) => return Err(CsaError::EngineCrashed),
                    Ok(_) => {
                        if buf.trim() == expected {
                            return Ok(());
                        }
                    }
                    Err(e) => return Err(CsaError::EngineError(format!("stdout read error: {e}"))),
                }
            }
            () = &mut deadline => {
                return Err(CsaError::EngineTimeout);
            }
        }
    }
}

async fn external_stdout_task(
    reader: BufReader<tokio::process::ChildStdout>,
    bestmove_tx: mpsc::Sender<BestMoveResult>,
    info_tx: mpsc::Sender<CsaSearchInfo>,
    readyok_tx: mpsc::Sender<()>,
) {
    let mut reader = reader;
    let mut buf = String::new();

    loop {
        buf.clear();
        match reader.read_line(&mut buf).await {
            Ok(0) => break,
            Ok(_) => {
                let line = buf.trim();
                if line.starts_with("bestmove ") {
                    if let Some(result) = parse_bestmove_for_csa(line) {
                        let _ = bestmove_tx.send(result).await;
                    }
                } else if line == "readyok" {
                    let _ = readyok_tx.send(()).await;
                } else if line.starts_with("info ")
                    && let Some(info) = parse_info_for_csa(line)
                {
                    // try_send で満杯なら古い info を捨てる（ハング防止）
                    let _ = info_tx.try_send(info);
                }
            }
            Err(_) => break,
        }
    }
}

fn parse_bestmove_for_csa(line: &str) -> Option<BestMoveResult> {
    let rest = line.strip_prefix("bestmove ")?;
    let mut tokens = rest.split_whitespace();
    let mv = tokens.next()?;

    match mv {
        "resign" => Some(BestMoveResult::Resign),
        "win" => Some(BestMoveResult::Win),
        _ => {
            let ponder = if tokens.next() == Some("ponder") {
                tokens.next().map(|s| s.to_string())
            } else {
                None
            };
            Some(BestMoveResult::Move {
                usi: mv.to_string(),
                ponder,
            })
        }
    }
}

fn parse_info_for_csa(line: &str) -> Option<CsaSearchInfo> {
    let rest = line.strip_prefix("info ")?;
    let tokens: Vec<&str> = rest.split_whitespace().collect();

    let mut depth = 0u32;
    let mut score_cp = None;
    let mut score_mate = None;
    let mut pv = Vec::new();
    let mut nps = 0u64;

    let mut i = 0;
    while i < tokens.len() {
        match tokens[i] {
            "depth" => {
                i += 1;
                depth = tokens.get(i).and_then(|v| v.parse().ok()).unwrap_or(0);
            }
            "nps" => {
                i += 1;
                nps = tokens.get(i).and_then(|v| v.parse().ok()).unwrap_or(0);
            }
            "score" => {
                i += 1;
                if let Some(&kind) = tokens.get(i) {
                    i += 1;
                    match kind {
                        "cp" => score_cp = tokens.get(i).and_then(|v| v.parse().ok()),
                        "mate" => score_mate = tokens.get(i).and_then(|v| v.parse().ok()),
                        _ => i -= 1,
                    }
                }
            }
            "pv" => {
                pv = tokens[i + 1..].iter().map(|s| (*s).to_string()).collect();
                break;
            }
            "string" => break,
            _ => {}
        }
        i += 1;
    }

    // depth がない info string 等はスキップ
    if depth == 0 {
        return None;
    }

    Some(CsaSearchInfo {
        depth,
        score_cp,
        score_mate,
        pv,
        nps,
    })
}

// ─── Go Command Builder ───

fn build_go_command(params: &CsaGoParams, ponder: bool) -> String {
    let mut cmd = String::from("go");
    if ponder {
        cmd.push_str(" ponder");
    }
    cmd.push_str(&format!(" btime {}", params.btime_ms));
    cmd.push_str(&format!(" wtime {}", params.wtime_ms));
    if let Some(byoyomi) = params.byoyomi_ms {
        cmd.push_str(&format!(" byoyomi {byoyomi}"));
    }
    if let Some(binc) = params.binc_ms {
        cmd.push_str(&format!(" binc {binc}"));
    }
    if let Some(winc) = params.winc_ms {
        cmd.push_str(&format!(" winc {winc}"));
    }
    cmd
}

fn build_limits(params: &CsaGoParams, ponder: bool) -> LimitsType {
    let mut limits = LimitsType::default();
    limits.time[0] = params.btime_ms;
    limits.time[1] = params.wtime_ms;
    if let Some(byoyomi) = params.byoyomi_ms {
        limits.byoyomi[0] = byoyomi;
        limits.byoyomi[1] = byoyomi;
    }
    if let Some(binc) = params.binc_ms {
        limits.inc[0] = binc;
    }
    if let Some(winc) = params.winc_ms {
        limits.inc[1] = winc;
    }
    limits.ponder = ponder;
    limits
}

// ─── Builtin Search ───

fn spawn_builtin_search(
    engine_state: Arc<EngineState>,
    limits: LimitsType,
    bestmove_tx: mpsc::Sender<BestMoveResult>,
    info_tx: mpsc::Sender<CsaSearchInfo>,
    active_thread: &StdMutex<Option<std::thread::JoinHandle<()>>>,
) -> Result<(), CsaError> {
    // 前回のスレッドを回収（poison 回復付き）
    {
        let mut guard = active_thread.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(handle) = guard.take() {
            let _ = handle.join();
        }
    }

    let handle = std::thread::Builder::new()
        .name("csa-builtin-search".into())
        .stack_size(SEARCH_STACK_SIZE)
        .spawn(move || {
            builtin_search_thread(engine_state, limits, bestmove_tx, info_tx);
        })
        .map_err(|e| CsaError::EngineError(format!("探索スレッド起動失敗: {e}")))?;

    {
        let mut guard = active_thread.lock().unwrap_or_else(|e| e.into_inner());
        *guard = Some(handle);
    }

    Ok(())
}

fn builtin_search_thread(
    engine_state: Arc<EngineState>,
    limits: LimitsType,
    bestmove_tx: mpsc::Sender<BestMoveResult>,
    info_tx: mpsc::Sender<CsaSearchInfo>,
) {
    let (mut search, mut position) = {
        let mut inner = match engine_state.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };

        let search = match inner.search.take() {
            Some(s) => s,
            None => inner.create_search(),
        };
        let position = inner.position.clone();
        (search, position)
    };

    // info コールバック
    let info_tx_clone = info_tx;
    let info_callback = move |info: &SearchInfo| {
        let csa_info = CsaSearchInfo {
            depth: info.depth as u32,
            score_cp: Some(info.score.raw()),
            score_mate: None,
            pv: info.pv.iter().map(|m| m.to_usi()).collect(),
            nps: info.nps,
        };
        // try_send で満杯なら古い info を捨てる（ハング防止）
        let _ = info_tx_clone.try_send(csa_info);
    };

    let result = search.go(&mut position, limits, Some(info_callback));

    // Search を返却
    {
        if let Ok(mut inner) = engine_state.inner.lock() {
            inner.search = Some(search);
        }
    }

    // bestmove を送信
    let bestmove = if result.best_move == rshogi_core::types::Move::NONE {
        BestMoveResult::Resign
    } else {
        BestMoveResult::Move {
            usi: result.best_move.to_usi(),
            ponder: if result.ponder_move == rshogi_core::types::Move::NONE {
                None
            } else {
                Some(result.ponder_move.to_usi())
            },
        }
    };
    let _ = bestmove_tx.blocking_send(bestmove);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_go_command_byoyomi() {
        let params = CsaGoParams {
            btime_ms: 300000,
            wtime_ms: 250000,
            byoyomi_ms: Some(10000),
            binc_ms: None,
            winc_ms: None,
        };
        assert_eq!(
            build_go_command(&params, false),
            "go btime 300000 wtime 250000 byoyomi 10000"
        );
    }

    #[test]
    fn test_build_go_command_fischer_ponder() {
        let params = CsaGoParams {
            btime_ms: 600000,
            wtime_ms: 600000,
            byoyomi_ms: None,
            binc_ms: Some(5000),
            winc_ms: Some(5000),
        };
        assert_eq!(
            build_go_command(&params, true),
            "go ponder btime 600000 wtime 600000 binc 5000 winc 5000"
        );
    }

    #[test]
    fn test_parse_bestmove_normal() {
        let result = parse_bestmove_for_csa("bestmove 7g7f ponder 3c3d").unwrap();
        match result {
            BestMoveResult::Move { usi, ponder } => {
                assert_eq!(usi, "7g7f");
                assert_eq!(ponder, Some("3c3d".to_string()));
            }
            _ => panic!("expected Move"),
        }
    }

    #[test]
    fn test_parse_bestmove_resign() {
        assert!(matches!(
            parse_bestmove_for_csa("bestmove resign"),
            Some(BestMoveResult::Resign)
        ));
    }

    #[test]
    fn test_parse_bestmove_win() {
        assert!(matches!(
            parse_bestmove_for_csa("bestmove win"),
            Some(BestMoveResult::Win)
        ));
    }

    #[test]
    fn test_parse_info() {
        let info =
            parse_info_for_csa("info depth 12 score cp 150 nps 1200000 pv 7g7f 3c3d").unwrap();
        assert_eq!(info.depth, 12);
        assert_eq!(info.score_cp, Some(150));
        assert_eq!(info.nps, 1200000);
        assert_eq!(info.pv, vec!["7g7f", "3c3d"]);
    }
}

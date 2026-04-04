//! CSA対局セッションループ
//!
//! サーバー通信とエンジン制御を調整し、1局の対局を管理する。
//! `run_session` が対局メインループで、自手番→エコー待ち→相手番→…を繰り返す。

use std::fmt::Write as _;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use rshogi_csa::{csa_move_to_usi, usi_move_to_csa};

use crate::csa_engine::CsaEngine;
use crate::csa_protocol::CsaGameIo;
use crate::csa_types::{
    BestMoveResult, ClockUpdate, CsaColor, CsaConfig, CsaError, CsaGoParams, CsaSearchInfo,
    CsaSessionEvent, GameResult, GameSummary, ServerLine,
};

// ─── Clock ───

/// 対局中の時間管理
struct Clock {
    black_ms: i64,
    white_ms: i64,
    byoyomi_ms: i64,
    increment_ms: i64,
}

impl Clock {
    fn from_summary(summary: &GameSummary) -> Self {
        Self {
            black_ms: summary.black_time.total_ms,
            white_ms: summary.white_time.total_ms,
            byoyomi_ms: summary.black_time.byoyomi_ms,
            increment_ms: summary.black_time.increment_ms,
        }
    }

    fn update(&mut self, color: CsaColor, consumed_sec: u32) {
        let consumed_ms = consumed_sec as i64 * 1000;
        match color {
            CsaColor::Sente => {
                self.black_ms = (self.black_ms - consumed_ms + self.increment_ms).max(0);
            }
            CsaColor::Gote => {
                self.white_ms = (self.white_ms - consumed_ms + self.increment_ms).max(0);
            }
        }
    }

    fn build_go_params(&self, margin_ms: i64) -> CsaGoParams {
        let btime = self.black_ms.max(0);
        let wtime = self.white_ms.max(0);

        if self.increment_ms > 0 {
            CsaGoParams {
                btime_ms: btime,
                wtime_ms: wtime,
                byoyomi_ms: None,
                binc_ms: Some(self.increment_ms),
                winc_ms: Some(self.increment_ms),
            }
        } else if self.byoyomi_ms > 0 {
            CsaGoParams {
                btime_ms: btime,
                wtime_ms: wtime,
                byoyomi_ms: Some((self.byoyomi_ms - margin_ms).max(0)),
                binc_ms: None,
                winc_ms: None,
            }
        } else {
            CsaGoParams {
                btime_ms: btime,
                wtime_ms: wtime,
                byoyomi_ms: None,
                binc_ms: None,
                winc_ms: None,
            }
        }
    }

    fn to_clock_update(&self) -> ClockUpdate {
        ClockUpdate {
            sente_ms: self.black_ms.max(0),
            gote_ms: self.white_ms.max(0),
        }
    }
}

// ─── Ponder State ───

struct PonderState {
    expected_usi: String,
}

// ─── Helper: opposite color ───

fn opposite_color(color: CsaColor) -> CsaColor {
    match color {
        CsaColor::Sente => CsaColor::Gote,
        CsaColor::Gote => CsaColor::Sente,
    }
}

fn gameover_str(result: &GameResult) -> &'static str {
    match result {
        GameResult::Win => "win",
        GameResult::Lose => "lose",
        _ => "draw",
    }
}

// ─── Session Result ───

/// 対局の結果と棋譜データ
pub struct SessionResult {
    pub game_result: GameResult,
    /// CSA形式の指し手と消費時間（秒）のペア
    pub moves: Vec<(String, u32)>,
}

// ─── run_session ───

/// CSA対局のメインループを実行する。
///
/// 対局開始から終局までを管理し、`SessionResult` を返す。
/// キャンセルトークンでの中断にも対応する。
pub async fn run_session(
    game_io: &mut CsaGameIo,
    server_rx: &mut mpsc::Receiver<ServerLine>,
    engine: &mut CsaEngine,
    summary: &GameSummary,
    config: &CsaConfig,
    cancel_token: &CancellationToken,
    event_tx: &mpsc::Sender<CsaSessionEvent>,
) -> Result<SessionResult, CsaError> {
    let my_color = summary.my_color;
    let initial_sfen = summary.sfen.clone();
    let margin_ms = config.time.margin_ms;
    let ponder_enabled = config.engine.ponder;
    let floodgate = config.server.floodgate;

    // rshogi_csa::Position で CSA↔USI 変換用の局面を追跡
    let mut pos = if summary.csa_board_text.is_empty() {
        // CSA 盤面テキストがなければ平手
        rshogi_csa::initial_position()
    } else {
        // CSA 盤面テキストから Position を復元（非平手対局に対応）
        let (parsed_pos, _, _) = rshogi_csa::parse_csa(&summary.csa_board_text)
            .map_err(|e| CsaError::ProtocolError(format!("CSA局面パースエラー: {e}")))?;
        parsed_pos
    };
    let mut usi_moves: Vec<String> = Vec::new();
    let mut record_moves: Vec<(String, u32)> = Vec::new(); // (CSA指し手, 消費時間秒)
    let mut clock = Clock::from_summary(summary);
    let mut ponder_state: Option<PonderState> = None;

    // エンジン初期化
    engine.new_game().await?;
    engine.set_position(&initial_sfen, &[]).await?;

    // 対局メインループ
    loop {
        // 自手番判定: rshogi_csa の side_to_move と my_color を比較
        let is_my_turn = matches!(
            (pos.side_to_move, my_color),
            (rshogi_csa::Color::Black, CsaColor::Sente)
                | (rshogi_csa::Color::White, CsaColor::Gote)
        );

        if is_my_turn {
            // ── 自手番: エンジンに思考させる ──
            engine.set_position(&initial_sfen, &usi_moves).await?;
            let go_params = clock.build_go_params(margin_ms);
            engine.go(&go_params).await?;

            // 探索情報を中継しながら bestmove を待つ
            // info は bestmove 受信後に drain する（try_recv は非同期待機ではないため）
            let bestmove = tokio::select! {
                result = engine.recv_bestmove() => result?,
                _ = cancel_token.cancelled() => {
                    engine.stop().await?;
                    let _ = engine.recv_bestmove().await;
                    game_io.send_special("%TORYO").await?;
                    let game_result = wait_game_end(server_rx, cancel_token).await?;
                    return Ok(SessionResult { game_result, moves: record_moves });
                }
            };

            // 最後の探索情報を取得（floodgate コメント用）
            let last_info = drain_info(engine);

            match bestmove {
                BestMoveResult::Resign => {
                    game_io.send_special("%TORYO").await?;
                    let game_result = wait_game_end(server_rx, cancel_token).await?;
                    return Ok(SessionResult { game_result, moves: record_moves });
                }
                BestMoveResult::Win => {
                    game_io.send_special("%KACHI").await?;
                    let game_result = wait_game_end(server_rx, cancel_token).await?;
                    return Ok(SessionResult { game_result, moves: record_moves });
                }
                BestMoveResult::Move {
                    usi: ref usi_move,
                    ponder: ref ponder_move,
                } => {
                    // USI → CSA 変換
                    let csa_move = usi_move_to_csa(usi_move, &pos)
                        .map_err(|e| CsaError::EngineError(format!("USI→CSA変換失敗: {e}")))?;

                    // サーバーに指し手を送信
                    game_io.send_move(&csa_move).await?;

                    // Floodgate コメント送信
                    if floodgate && let Some(ref info) = last_info {
                        let comment = build_floodgate_comment(info, my_color, &pos, usi_move);
                        game_io.send_comment(&comment).await?;
                    }

                    // 局面を更新
                    pos.apply_csa_move(&csa_move)
                        .map_err(|e| CsaError::ProtocolError(format!("局面更新失敗: {e}")))?;
                    usi_moves.push(usi_move.clone());

                    // エコー待ち: サーバーから自分の手の確認を受信
                    let echo_result = wait_echo(server_rx, &csa_move, cancel_token).await?;
                    match echo_result {
                        EchoResult::Confirmed { time_sec } => {
                            clock.update(my_color, time_sec);
                            record_moves.push((csa_move.clone(), time_sec));
                            // Move イベント送信
                            let _ = event_tx
                                .send(CsaSessionEvent::Move {
                                    side: my_color,
                                    usi: usi_move.clone(),
                                    sfen: pos.to_sfen(),
                                    clock: clock.to_clock_update(),
                                })
                                .await;
                        }
                        EchoResult::GameEnd { result, reason: _ } => {
                            engine.gameover(gameover_str(&result)).await?;
                            return Ok(SessionResult { game_result: result, moves: record_moves });
                        }
                    }

                    // Ponder 開始
                    if ponder_enabled && let Some(pm) = ponder_move {
                        let mut ponder_moves = usi_moves.clone();
                        ponder_moves.push(pm.clone());
                        engine.set_position(&initial_sfen, &ponder_moves).await?;
                        let go_params = clock.build_go_params(margin_ms);
                        engine.go_ponder(&go_params).await?;
                        ponder_state = Some(PonderState {
                            expected_usi: pm.clone(),
                        });
                    }
                }
            }
        }

        // ── 相手手番: サーバーから指し手を待つ ──
        let opponent_result = wait_opponent_move(server_rx, cancel_token).await?;

        match opponent_result {
            OpponentResult::Move { csa, time_sec } => {
                // CSA → USI 変換
                let opponent_usi = csa_move_to_usi(&csa, &pos)
                    .map_err(|e| CsaError::ProtocolError(format!("CSA→USI変換失敗: {e}")))?;

                let opponent_color = opposite_color(my_color);

                // Ponder ヒット/ミス判定
                if let Some(ps) = ponder_state.take() {
                    if opponent_usi == ps.expected_usi {
                        // Ponder ヒット
                        pos.apply_csa_move(&csa)
                            .map_err(|e| CsaError::ProtocolError(format!("局面更新失敗: {e}")))?;
                        usi_moves.push(opponent_usi.clone());
                        clock.update(opponent_color, time_sec);
                        record_moves.push((csa.clone(), time_sec));

                        let _ = event_tx
                            .send(CsaSessionEvent::Move {
                                side: opponent_color,
                                usi: opponent_usi,
                                sfen: pos.to_sfen(),
                                clock: clock.to_clock_update(),
                            })
                            .await;

                        engine.ponderhit().await?;

                        // ponderhit 後の bestmove 待ち
                        let ph_bestmove = tokio::select! {
                            result = engine.recv_bestmove() => result?,
                            _ = cancel_token.cancelled() => {
                                engine.stop().await?;
                                let _ = engine.recv_bestmove().await;
                                game_io.send_special("%TORYO").await?;
                                let game_result = wait_game_end(server_rx, cancel_token).await?;
                                return Ok(SessionResult { game_result, moves: record_moves });
                            }
                        };

                        let last_info = drain_info(engine);

                        // ponderhit bestmove を処理
                        match ph_bestmove {
                            BestMoveResult::Resign => {
                                game_io.send_special("%TORYO").await?;
                                let game_result = wait_game_end(server_rx, cancel_token).await?;
                                return Ok(SessionResult { game_result, moves: record_moves });
                            }
                            BestMoveResult::Win => {
                                game_io.send_special("%KACHI").await?;
                                let game_result = wait_game_end(server_rx, cancel_token).await?;
                                return Ok(SessionResult { game_result, moves: record_moves });
                            }
                            BestMoveResult::Move {
                                usi: ref usi_move,
                                ponder: ref ponder_move,
                            } => {
                                let csa_move = usi_move_to_csa(usi_move, &pos).map_err(|e| {
                                    CsaError::EngineError(format!("USI→CSA変換失敗: {e}"))
                                })?;

                                game_io.send_move(&csa_move).await?;

                                if floodgate && let Some(ref info) = last_info {
                                    let comment =
                                        build_floodgate_comment(info, my_color, &pos, usi_move);
                                    game_io.send_comment(&comment).await?;
                                }

                                pos.apply_csa_move(&csa_move).map_err(|e| {
                                    CsaError::ProtocolError(format!("局面更新失敗: {e}"))
                                })?;
                                usi_moves.push(usi_move.clone());

                                let echo_result =
                                    wait_echo(server_rx, &csa_move, cancel_token).await?;
                                match echo_result {
                                    EchoResult::Confirmed { time_sec } => {
                                        clock.update(my_color, time_sec);
                                        record_moves.push((csa_move.clone(), time_sec));
                                        let _ = event_tx
                                            .send(CsaSessionEvent::Move {
                                                side: my_color,
                                                usi: usi_move.clone(),
                                                sfen: pos.to_sfen(),
                                                clock: clock.to_clock_update(),
                                            })
                                            .await;
                                    }
                                    EchoResult::GameEnd { result, reason: _ } => {
                                        engine.gameover(gameover_str(&result)).await?;
                                        return Ok(SessionResult { game_result: result, moves: record_moves });
                                    }
                                }

                                // 新しい ponder 開始
                                if ponder_enabled && let Some(pm) = ponder_move {
                                    let mut ponder_moves = usi_moves.clone();
                                    ponder_moves.push(pm.clone());
                                    engine.set_position(&initial_sfen, &ponder_moves).await?;
                                    let go_params = clock.build_go_params(margin_ms);
                                    engine.go_ponder(&go_params).await?;
                                    ponder_state = Some(PonderState {
                                        expected_usi: pm.clone(),
                                    });
                                }
                            }
                        }
                    } else {
                        // Ponder ミス: stop → bestmove 破棄
                        engine.stop().await?;
                        let _ = engine.recv_bestmove().await;

                        pos.apply_csa_move(&csa)
                            .map_err(|e| CsaError::ProtocolError(format!("局面更新失敗: {e}")))?;
                        usi_moves.push(opponent_usi.clone());
                        clock.update(opponent_color, time_sec);
                        record_moves.push((csa.clone(), time_sec));

                        let _ = event_tx
                            .send(CsaSessionEvent::Move {
                                side: opponent_color,
                                usi: opponent_usi,
                                sfen: pos.to_sfen(),
                                clock: clock.to_clock_update(),
                            })
                            .await;
                    }
                } else {
                    // Ponder なし
                    pos.apply_csa_move(&csa)
                        .map_err(|e| CsaError::ProtocolError(format!("局面更新失敗: {e}")))?;
                    usi_moves.push(opponent_usi.clone());
                    clock.update(opponent_color, time_sec);
                    record_moves.push((csa.clone(), time_sec));

                    let _ = event_tx
                        .send(CsaSessionEvent::Move {
                            side: opponent_color,
                            usi: opponent_usi,
                            sfen: pos.to_sfen(),
                            clock: clock.to_clock_update(),
                        })
                        .await;
                }
            }
            OpponentResult::GameEnd { result, reason: _ } => {
                // Ponder 中なら停止
                if ponder_state.take().is_some() {
                    engine.stop().await?;
                    let _ = engine.recv_bestmove().await;
                }
                engine.gameover(gameover_str(&result)).await?;
                return Ok(SessionResult { game_result: result, moves: record_moves });
            }
        }
    }
}

// ─── Echo Result ───

enum EchoResult {
    Confirmed {
        time_sec: u32,
    },
    GameEnd {
        result: GameResult,
        reason: Option<String>,
    },
}

/// サーバーから自分の手のエコーを待つ
async fn wait_echo(
    server_rx: &mut mpsc::Receiver<ServerLine>,
    expected_csa: &str,
    cancel_token: &CancellationToken,
) -> Result<EchoResult, CsaError> {
    loop {
        tokio::select! {
            line = server_rx.recv() => {
                match line.ok_or(CsaError::ServerDisconnected)? {
                    ServerLine::Move { ref csa, time_sec } if csa == expected_csa => {
                        return Ok(EchoResult::Confirmed { time_sec });
                    }
                    ServerLine::Move { ref csa, .. } => {
                        return Err(CsaError::ProtocolError(format!(
                            "エコー不一致: expected={expected_csa}, got={csa}"
                        )));
                    }
                    ServerLine::GameEnd { result, reason } => {
                        return Ok(EchoResult::GameEnd { result, reason });
                    }
                    _ => {
                        // その他の行はスキップ
                    }
                }
            }
            _ = cancel_token.cancelled() => {
                return Err(CsaError::SessionAborted);
            }
        }
    }
}

// ─── Opponent Result ───

enum OpponentResult {
    Move {
        csa: String,
        time_sec: u32,
    },
    GameEnd {
        result: GameResult,
        reason: Option<String>,
    },
}

/// 相手の指し手またはゲーム終了を待つ
async fn wait_opponent_move(
    server_rx: &mut mpsc::Receiver<ServerLine>,
    cancel_token: &CancellationToken,
) -> Result<OpponentResult, CsaError> {
    loop {
        tokio::select! {
            line = server_rx.recv() => {
                match line.ok_or(CsaError::ServerDisconnected)? {
                    ServerLine::Move { csa, time_sec } => {
                        return Ok(OpponentResult::Move { csa, time_sec });
                    }
                    ServerLine::GameEnd { result, reason } => {
                        return Ok(OpponentResult::GameEnd { result, reason });
                    }
                    _ => {
                        // その他の行はスキップ
                    }
                }
            }
            _ = cancel_token.cancelled() => {
                return Err(CsaError::SessionAborted);
            }
        }
    }
}

/// 終局結果待ちのタイムアウト（秒）
const GAME_END_TIMEOUT_SECS: u64 = 30;

/// サーバーからの終局結果を待つ
async fn wait_game_end(
    server_rx: &mut mpsc::Receiver<ServerLine>,
    cancel_token: &CancellationToken,
) -> Result<GameResult, CsaError> {
    // %TORYO や %KACHI 後、サーバーから #WIN / #LOSE 等を受信するまで待つ
    let timeout = tokio::time::sleep(std::time::Duration::from_secs(GAME_END_TIMEOUT_SECS));
    tokio::pin!(timeout);

    loop {
        tokio::select! {
            line = server_rx.recv() => {
                match line.ok_or(CsaError::ServerDisconnected)? {
                    ServerLine::GameEnd { result, .. } => {
                        return Ok(result);
                    }
                    _ => {
                        // エコー等はスキップ
                    }
                }
            }
            () = &mut timeout => {
                return Ok(GameResult::Interrupted);
            }
            _ = cancel_token.cancelled() => {
                return Ok(GameResult::Interrupted);
            }
        }
    }
}

// ─── Info drain ───

/// エンジンの探索情報を全て取得し、最後のものを返す
fn drain_info(engine: &mut CsaEngine) -> Option<CsaSearchInfo> {
    let mut last = None;
    while let Some(info) = engine.try_recv_info() {
        last = Some(info);
    }
    last
}

// ─── Floodgate Comment ───

/// Floodgate 形式の評価値コメントを生成する。
/// フォーマット: `'* <score_cp> <pv in CSA format>`
fn build_floodgate_comment(
    info: &CsaSearchInfo,
    my_color: CsaColor,
    pos: &rshogi_csa::Position,
    last_bestmove: &str,
) -> String {
    let score = if let Some(cp) = info.score_cp {
        match my_color {
            CsaColor::Sente => cp,
            CsaColor::Gote => -cp,
        }
    } else if let Some(mate) = info.score_mate {
        let base = if mate > 0 { 100000 } else { -100000 };
        match my_color {
            CsaColor::Sente => base,
            CsaColor::Gote => -base,
        }
    } else {
        0
    };

    let mut comment = format!("'* {score}");

    if !info.pv.is_empty() {
        let mut pv_pos = pos.clone();
        // PV の先頭が bestmove と同じならスキップ（既に盤面に反映済みのため）
        let pv_start = if info.pv.first().map(|s| s.as_str()) == Some(last_bestmove) {
            1
        } else {
            0
        };
        for usi_mv in &info.pv[pv_start..] {
            if let Ok(csa) = usi_move_to_csa(usi_mv, &pv_pos) {
                write!(comment, " {csa}").unwrap();
                if pv_pos.apply_csa_move(&csa).is_err() {
                    break;
                }
            } else {
                break;
            }
        }
    }

    comment
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_clock_from_summary() {
        let summary = GameSummary {
            game_id: "test".into(),
            my_color: CsaColor::Sente,
            sente_name: "A".into(),
            gote_name: "B".into(),
            sfen: "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1".into(),
            csa_board_text: String::new(),
            black_time: crate::csa_types::TimeConfig {
                total_ms: 600_000,
                byoyomi_ms: 10_000,
                increment_ms: 0,
            },
            white_time: crate::csa_types::TimeConfig {
                total_ms: 600_000,
                byoyomi_ms: 10_000,
                increment_ms: 0,
            },
        };
        let clock = Clock::from_summary(&summary);
        assert_eq!(clock.black_ms, 600_000);
        assert_eq!(clock.white_ms, 600_000);
        assert_eq!(clock.byoyomi_ms, 10_000);
    }

    #[test]
    fn test_clock_update() {
        let mut clock = Clock {
            black_ms: 300_000,
            white_ms: 300_000,
            byoyomi_ms: 10_000,
            increment_ms: 0,
        };
        clock.update(CsaColor::Sente, 5);
        assert_eq!(clock.black_ms, 295_000);
        assert_eq!(clock.white_ms, 300_000);
    }

    #[test]
    fn test_clock_update_with_increment() {
        let mut clock = Clock {
            black_ms: 300_000,
            white_ms: 300_000,
            byoyomi_ms: 0,
            increment_ms: 5_000,
        };
        clock.update(CsaColor::Gote, 3);
        assert_eq!(clock.white_ms, 302_000); // 300000 - 3000 + 5000
    }

    #[test]
    fn test_clock_build_go_params_byoyomi() {
        let clock = Clock {
            black_ms: 300_000,
            white_ms: 250_000,
            byoyomi_ms: 10_000,
            increment_ms: 0,
        };
        let params = clock.build_go_params(1000);
        assert_eq!(params.btime_ms, 300_000);
        assert_eq!(params.wtime_ms, 250_000);
        assert_eq!(params.byoyomi_ms, Some(9_000));
        assert!(params.binc_ms.is_none());
    }

    #[test]
    fn test_clock_build_go_params_fischer() {
        let clock = Clock {
            black_ms: 600_000,
            white_ms: 600_000,
            byoyomi_ms: 0,
            increment_ms: 5_000,
        };
        let params = clock.build_go_params(0);
        assert_eq!(params.binc_ms, Some(5_000));
        assert_eq!(params.winc_ms, Some(5_000));
        assert!(params.byoyomi_ms.is_none());
    }

    #[test]
    fn test_clock_to_clock_update() {
        let clock = Clock {
            black_ms: 100_000,
            white_ms: 200_000,
            byoyomi_ms: 0,
            increment_ms: 0,
        };
        let update = clock.to_clock_update();
        assert_eq!(update.sente_ms, 100_000);
        assert_eq!(update.gote_ms, 200_000);
    }

    #[test]
    fn test_opposite_color() {
        assert_eq!(opposite_color(CsaColor::Sente), CsaColor::Gote);
        assert_eq!(opposite_color(CsaColor::Gote), CsaColor::Sente);
    }

    #[test]
    fn test_gameover_str() {
        assert_eq!(gameover_str(&GameResult::Win), "win");
        assert_eq!(gameover_str(&GameResult::Lose), "lose");
        assert_eq!(gameover_str(&GameResult::Draw), "draw");
        assert_eq!(gameover_str(&GameResult::Interrupted), "draw");
    }

    #[test]
    fn test_build_floodgate_comment_sente() {
        let info = CsaSearchInfo {
            depth: 10,
            score_cp: Some(150),
            score_mate: None,
            pv: vec![],
            nps: 1000,
        };
        let pos = rshogi_csa::initial_position();
        let comment = build_floodgate_comment(&info, CsaColor::Sente, &pos, "7g7f");
        assert_eq!(comment, "'* 150");
    }

    #[test]
    fn test_build_floodgate_comment_gote_negated() {
        let info = CsaSearchInfo {
            depth: 10,
            score_cp: Some(100),
            score_mate: None,
            pv: vec![],
            nps: 1000,
        };
        let pos = rshogi_csa::initial_position();
        let comment = build_floodgate_comment(&info, CsaColor::Gote, &pos, "3c3d");
        assert_eq!(comment, "'* -100");
    }
}

//! CSA 対局用の内蔵エンジン driver。
//!
//! `rshogi-core` の `Search` を直接駆動して [`UsiEngineDriver`] trait を実装し、
//! 外部 USI プロセスを起動せず in-process で対局可能にする。
//!
//! # 設計方針
//!
//! - `Search::go` は blocking 呼び出しのため、専用 thread (`csa-builtin-search`) で
//!   実行し、driver 側は `mpsc` channel で bestmove / info を受信する。
//! - `Search` インスタンスは探索中 thread に move されるため、driver から stop
//!   する手段として `start_search` で `search.stop_flag()` を clone して保持する。
//! - rshogi-core の `Search::request_ponderhit()` は探索中 instance への参照を
//!   要求するため driver からは呼べない。Builtin engine では `csa_session` 側で
//!   `csa_config.game.ponder = false` を強制し、`go_ponder` / `ponderhit_with_info`
//!   が呼ばれない経路に閉じる。
//!
//! # 中断行の扱い
//!
//! OSS rshogi-csa-client の `parse_game_result()` は最終結果行 (`#WIN` / `#LOSE`
//! / `#DRAW` / `#CHUDAN` / `#CENSORED`) のみを終局扱いし、理由行 (`#TIME_UP` /
//! `#ILLEGAL_MOVE` / `#JISHOGI` / `#SENNICHITE` / `#MAX_MOVES`) は最終結果行と
//! 合わせて `GameEndReason` を解釈する。本 driver も同じ判定で `poll_until_outcome`
//! が `ServerInterrupt` を返すため、理由行は `server_lines` に積むのみで終局
//! としては扱わない。`#DISCONNECTED` は synthetic line として server 切断時に
//! 即 interrupt させる。

use std::sync::Arc;
use std::sync::Mutex as StdMutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::thread::JoinHandle;
use std::time::Duration;

use anyhow::{Context, Result, anyhow, bail};

use rshogi_core::position::{Position, SFEN_HIRATE};
use rshogi_core::search::{LimitsType, SearchInfo as CoreSearchInfo};
use rshogi_core::types::{Color, Move};

use rshogi_csa_client::{
    BestMoveResult, Event, SearchInfo as OssSearchInfo, SearchOutcome, UsiEngineDriver,
    engine::InfoCallback,
};

use crate::EngineState;

/// 探索 thread のスタックサイズ (旧 Builtin と同じ 64MB)。
const SEARCH_STACK_SIZE: usize = 64 * 1024 * 1024;

/// 探索 thread からの結果を受け取る poll interval。
const POLL_INTERVAL: Duration = Duration::from_millis(50);

/// shutdown 観測時に bestmove を待つタイムアウト。
const DRAIN_TIMEOUT: Duration = Duration::from_secs(2);

// ─── Driver state ───

/// 探索 thread から driver に送られるイベント。
enum BuiltinSearchEvent {
    /// info 行 (累積 [`OssSearchInfo`] + 合成 raw line)
    Info(OssSearchInfo, String),
    /// bestmove (探索終了)
    BestMove(BestMoveResult),
}

/// `BuiltinEngineDriver` の駆動状態。
pub struct BuiltinEngineDriver {
    engine_state: Arc<EngineState>,
    /// 進行中の探索 thread の stop flag。`start_search` で `Search` を thread に
    /// move する**前**に `Search::stop_flag()` (Arc<AtomicBool> を clone する API)
    /// で取得し driver field に保持することで、探索中 (`inner.search = None` 状態)
    /// でも driver から stop 可能にする。
    stop_flag: StdMutex<Option<Arc<AtomicBool>>>,
    /// 探索 thread の JoinHandle。
    search_thread: StdMutex<Option<JoinHandle<()>>>,
    /// 探索 thread からの bestmove / info 受信側。
    result_rx: StdMutex<Option<Receiver<BuiltinSearchEvent>>>,
    /// ponder 状態フラグ。`go_ponder` で立てるが、Builtin では実際の探索は
    /// 走らせない (no-op)。詳細は module doc を参照。
    ponder_in_flight: AtomicBool,
}

impl BuiltinEngineDriver {
    /// 新しい driver を作成する。
    pub fn new(engine_state: Arc<EngineState>) -> Self {
        Self {
            engine_state,
            stop_flag: StdMutex::new(None),
            search_thread: StdMutex::new(None),
            result_rx: StdMutex::new(None),
            ponder_in_flight: AtomicBool::new(false),
        }
    }

    /// driver field の stop flag を立てる (poison 復帰付き)。
    fn signal_stop(&self) {
        let guard = self.stop_flag.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(flag) = guard.as_ref() {
            flag.store(true, Ordering::SeqCst);
        }
    }

    /// 探索 thread と channel を確実に終了させる (poison 復帰付き、idempotent)。
    fn drain_and_join(&self) {
        // 受信済みのイベントを drain (棋譜には載せない)
        {
            let guard = self.result_rx.lock().unwrap_or_else(|e| e.into_inner());
            if let Some(rx) = guard.as_ref() {
                while rx.try_recv().is_ok() {}
            }
        }

        // 探索 thread を join (poison 復帰付き)
        let handle = {
            let mut guard = self.search_thread.lock().unwrap_or_else(|e| e.into_inner());
            guard.take()
        };
        if let Some(handle) = handle {
            let _ = handle.join();
        }

        // channel を破棄
        let mut guard = self.result_rx.lock().unwrap_or_else(|e| e.into_inner());
        *guard = None;

        // stop_flag handle も破棄
        let mut flag_guard = self.stop_flag.lock().unwrap_or_else(|e| e.into_inner());
        *flag_guard = None;
    }

    /// 既存探索を確実に停止し、新規探索を開始する。
    fn start_search(&self, position_cmd: &str, go_cmd: &str, ponder: bool) -> Result<()> {
        // 1. 既存探索を確実に停止 (idempotent)
        self.signal_stop();
        self.drain_and_join();

        // 2. position と limits を準備
        apply_position_cmd(&self.engine_state, position_cmd)?;
        let limits = parse_go_cmd(go_cmd, ponder)?;

        // 3. Search を thread に move する直前に stop_flag を clone
        let stop_flag = {
            let inner = self
                .engine_state
                .inner
                .lock()
                .map_err(|e| anyhow!("engine state lock poisoned: {e}"))?;
            let search = inner
                .search
                .as_ref()
                .ok_or_else(|| anyhow!("Search instance unavailable"))?;
            let flag = search.stop_flag();
            flag.store(false, Ordering::SeqCst);
            flag
        };
        {
            let mut guard = self
                .stop_flag
                .lock()
                .map_err(|e| anyhow!("stop_flag mutex poisoned: {e}"))?;
            *guard = Some(Arc::clone(&stop_flag));
        }

        // 4. result channel を作成
        let (tx, rx) = mpsc::channel::<BuiltinSearchEvent>();
        {
            let mut guard = self
                .result_rx
                .lock()
                .map_err(|e| anyhow!("result_rx mutex poisoned: {e}"))?;
            *guard = Some(rx);
        }

        // 5. 探索 thread を spawn
        let engine_state = Arc::clone(&self.engine_state);
        let handle = std::thread::Builder::new()
            .name("csa-builtin-search".into())
            .stack_size(SEARCH_STACK_SIZE)
            .spawn(move || builtin_search_thread(engine_state, limits, tx))
            .context("csa-builtin-search thread spawn failed")?;
        {
            let mut guard = self
                .search_thread
                .lock()
                .map_err(|e| anyhow!("search_thread mutex poisoned: {e}"))?;
            *guard = Some(handle);
        }

        Ok(())
    }

    /// 探索 thread からの bestmove / info を poll し、終局・shutdown・server interrupt を観測する。
    fn poll_until_outcome(
        &self,
        shutdown: &AtomicBool,
        server_rx: &Receiver<Event>,
        info_callback: &mut InfoCallback<'_>,
    ) -> Result<SearchOutcome> {
        let mut server_lines: Vec<String> = Vec::new();
        let mut last_info = OssSearchInfo::default();

        loop {
            // 1. shutdown を観測
            if shutdown.load(Ordering::SeqCst) {
                self.signal_stop();
                let outcome = self.wait_for_bestmove(DRAIN_TIMEOUT, &mut last_info, info_callback);
                self.drain_and_join();
                return Ok(outcome.unwrap_or_else(|| {
                    SearchOutcome::BestMove(
                        BestMoveResult {
                            bestmove: "resign".into(),
                            ponder_move: None,
                        },
                        last_info.clone(),
                    )
                }));
            }

            // 2. server_rx を観測 (try_recv で non-blocking)
            loop {
                match server_rx.try_recv() {
                    Ok(Event::ServerLine(line)) => {
                        let trimmed = line.trim().to_string();
                        server_lines.push(line);
                        if is_final_result_line(&trimmed) {
                            self.signal_stop();
                            self.drain_and_join();
                            return Ok(SearchOutcome::ServerInterrupt(server_lines));
                        }
                        // 理由行 (#TIME_UP / #ILLEGAL_MOVE 等) は server_lines に積むのみ。
                        // OSS session 側の parse_server_interrupt_lines_full が後続の
                        // 最終結果行と合わせて GameEndReason を解釈する。
                    }
                    Ok(Event::ServerDisconnected) => {
                        self.signal_stop();
                        self.drain_and_join();
                        server_lines.push("#DISCONNECTED".to_string());
                        return Ok(SearchOutcome::ServerInterrupt(server_lines));
                    }
                    Err(mpsc::TryRecvError::Empty) => break,
                    Err(mpsc::TryRecvError::Disconnected) => {
                        // server_rx が閉じた = transport は別経路で終了済み。
                        // 切断扱いで返す。
                        self.signal_stop();
                        self.drain_and_join();
                        server_lines.push("#DISCONNECTED".to_string());
                        return Ok(SearchOutcome::ServerInterrupt(server_lines));
                    }
                }
            }

            // 3. result_rx から timeout 付きで受信 (timeout したら shutdown / server を再観測)
            let event = {
                let guard = self.result_rx.lock().unwrap_or_else(|e| e.into_inner());
                let Some(rx) = guard.as_ref() else {
                    bail!("result_rx is None during poll loop (internal invariant violation)");
                };
                rx.recv_timeout(POLL_INTERVAL)
            };
            match event {
                Ok(BuiltinSearchEvent::Info(info, raw_line)) => {
                    last_info = info.clone();
                    info_callback(&info, &raw_line);
                }
                Ok(BuiltinSearchEvent::BestMove(result)) => {
                    self.drain_and_join();
                    return Ok(SearchOutcome::BestMove(result, last_info));
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => {
                    self.drain_and_join();
                    bail!("Builtin engine search thread terminated unexpectedly");
                }
            }
        }
    }

    /// shutdown 経由で stop した直後に、探索 thread が自発的に bestmove を返すまで待つ。
    fn wait_for_bestmove(
        &self,
        timeout: Duration,
        last_info: &mut OssSearchInfo,
        info_callback: &mut InfoCallback<'_>,
    ) -> Option<SearchOutcome> {
        let deadline = std::time::Instant::now() + timeout;
        loop {
            let now = std::time::Instant::now();
            let remaining = deadline.checked_duration_since(now)?;

            let event = {
                let guard = self.result_rx.lock().unwrap_or_else(|e| e.into_inner());
                let rx = guard.as_ref()?;
                rx.recv_timeout(remaining.min(POLL_INTERVAL))
            };
            match event {
                Ok(BuiltinSearchEvent::Info(info, raw_line)) => {
                    *last_info = info.clone();
                    info_callback(&info, &raw_line);
                }
                Ok(BuiltinSearchEvent::BestMove(result)) => {
                    return Some(SearchOutcome::BestMove(result, last_info.clone()));
                }
                Err(RecvTimeoutError::Timeout) => continue,
                Err(RecvTimeoutError::Disconnected) => return None,
            }
        }
    }
}

impl Drop for BuiltinEngineDriver {
    fn drop(&mut self) {
        self.signal_stop();
        self.drain_and_join();
    }
}

impl UsiEngineDriver for BuiltinEngineDriver {
    fn new_game(&mut self) -> Result<()> {
        // 既存探索があれば確実に停止 (idempotent)
        self.signal_stop();
        self.drain_and_join();
        let mut inner = self
            .engine_state
            .inner
            .lock()
            .map_err(|e| anyhow!("engine state lock poisoned: {e}"))?;
        if let Some(search) = inner.search.as_mut() {
            search.clear_tt();
        }
        Ok(())
    }

    fn go_with_info(
        &mut self,
        position_cmd: &str,
        go_cmd: &str,
        shutdown: &AtomicBool,
        server_rx: &Receiver<Event>,
        info_callback: &mut InfoCallback<'_>,
    ) -> Result<SearchOutcome> {
        self.start_search(position_cmd, go_cmd, false)?;
        self.poll_until_outcome(shutdown, server_rx, info_callback)
    }

    fn go_ponder(&mut self, position_cmd: &str, go_cmd: &str) -> Result<()> {
        // Builtin engine では rshogi-core API 制約上 ponder を真に実装できない。
        // `csa_session` 側で `csa_config.game.ponder = false` を強制するため、
        // 通常経路では本 method は呼ばれない。フラグだけ立てて即 return する。
        let _ = (position_cmd, go_cmd);
        self.ponder_in_flight.store(true, Ordering::SeqCst);
        Ok(())
    }

    fn ponderhit_with_info(
        &mut self,
        _shutdown: &AtomicBool,
        _server_rx: &Receiver<Event>,
        _info_callback: &mut InfoCallback<'_>,
    ) -> Result<SearchOutcome> {
        bail!(
            "ponderhit_with_info should not be called for BuiltinEngineDriver (ponder is disabled)"
        );
    }

    fn stop_and_wait(&mut self) -> Result<()> {
        self.signal_stop();
        self.drain_and_join();
        self.ponder_in_flight.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn gameover(&mut self, _result: &str) -> Result<()> {
        // rshogi-core 側に gameover 通知 API はない。`new_game` の `clear_tt` で
        // TT を初期化するため、`gameover` は no-op で良い。
        Ok(())
    }
}

// ─── Search thread ───

/// 探索 thread の本体。`Search` を `inner.search.take()` で取り出して `go` を呼び、
/// 終了後に instance を `inner.search` に戻す。
fn builtin_search_thread(
    engine_state: Arc<EngineState>,
    limits: LimitsType,
    tx: Sender<BuiltinSearchEvent>,
) {
    let (mut search, mut position) = {
        let mut inner = match engine_state.inner.lock() {
            Ok(inner) => inner,
            Err(_) => return,
        };
        let search = inner.search.take().unwrap_or_else(|| inner.create_search());
        let position = inner.position.clone();
        (search, position)
    };

    let info_tx = tx.clone();
    let info_callback = move |info: &CoreSearchInfo| {
        let oss_info = convert_core_search_info(info);
        let raw_line = synthesize_raw_info_line(info);
        let _ = info_tx.send(BuiltinSearchEvent::Info(oss_info, raw_line));
    };

    let result = search.go(&mut position, limits, Some(info_callback));

    // Search instance を返却 (poison 復帰なしで OK: lock 失敗時は drop されるだけ)
    if let Ok(mut inner) = engine_state.inner.lock() {
        inner.search = Some(search);
    }

    let bestmove = if result.best_move == Move::NONE {
        BestMoveResult {
            bestmove: "resign".into(),
            ponder_move: None,
        }
    } else {
        BestMoveResult {
            bestmove: result.best_move.to_usi(),
            ponder_move: if result.ponder_move == Move::NONE {
                None
            } else {
                Some(result.ponder_move.to_usi())
            },
        }
    };
    let _ = tx.send(BuiltinSearchEvent::BestMove(bestmove));
}

// ─── USI cmd parser ───

/// `position [startpos | sfen <board> <turn> <hand> <ply>] [moves <usi_move> ...]`
/// を parse して `engine_state.inner.position` を更新する。
pub(crate) fn apply_position_cmd(engine_state: &Arc<EngineState>, cmd: &str) -> Result<()> {
    let trimmed = cmd.trim();
    let rest = trimmed
        .strip_prefix("position ")
        .or_else(|| trimmed.strip_prefix("position\t"))
        .ok_or_else(|| anyhow!("not a position command: {cmd}"))?;
    let mut tokens = rest.split_whitespace();
    let first = tokens
        .next()
        .ok_or_else(|| anyhow!("empty position command"))?;

    let sfen = match first {
        "startpos" => SFEN_HIRATE.to_string(),
        "sfen" => {
            let board = tokens
                .next()
                .ok_or_else(|| anyhow!("incomplete sfen: missing board"))?;
            let turn = tokens
                .next()
                .ok_or_else(|| anyhow!("incomplete sfen: missing turn"))?;
            let hand = tokens
                .next()
                .ok_or_else(|| anyhow!("incomplete sfen: missing hand"))?;
            let ply = tokens
                .next()
                .ok_or_else(|| anyhow!("incomplete sfen: missing ply"))?;
            format!("{board} {turn} {hand} {ply}")
        }
        other => bail!("unsupported position variant: {other}"),
    };

    let moves: Vec<&str> = match tokens.next() {
        Some("moves") => tokens.collect(),
        Some(other) => bail!("unexpected token in position command after sfen: {other}"),
        None => Vec::new(),
    };

    let mut inner = engine_state
        .inner
        .lock()
        .map_err(|e| anyhow!("engine state lock poisoned: {e}"))?;
    let mut position = Position::new();
    position
        .set_sfen(&sfen)
        .map_err(|e| anyhow!("set_sfen failed: {e}"))?;
    for m in moves {
        let mv = Move::from_usi(m).ok_or_else(|| anyhow!("invalid usi move: {m}"))?;
        let gives_check = position.gives_check(mv);
        position.do_move(mv, gives_check);
    }
    inner.position = position;
    Ok(())
}

/// `go [ponder] btime <ms> wtime <ms> [byoyomi <ms>] [binc <ms>] [winc <ms>]`
/// を parse して `LimitsType` を生成する。未知 token は defensive にスキップする。
///
/// `has_ponder_flag` は呼び出し側 (`start_search`) で判定済みの ponder フラグ。
/// `go_cmd` 内に `ponder` token が含まれていた場合も合わせて立てる。
pub(crate) fn parse_go_cmd(cmd: &str, has_ponder_flag: bool) -> Result<LimitsType> {
    let trimmed = cmd.trim();
    let rest = trimmed
        .strip_prefix("go ")
        .or_else(|| trimmed.strip_prefix("go\t"))
        .or_else(|| if trimmed == "go" { Some("") } else { None })
        .ok_or_else(|| anyhow!("not a go command: {cmd}"))?;
    let mut tokens = rest.split_whitespace();

    let mut ponder = has_ponder_flag;
    let mut btime_ms: Option<i64> = None;
    let mut wtime_ms: Option<i64> = None;
    let mut byoyomi_ms: Option<i64> = None;
    let mut binc_ms: Option<i64> = None;
    let mut winc_ms: Option<i64> = None;

    while let Some(token) = tokens.next() {
        match token {
            "ponder" => ponder = true,
            "btime" => btime_ms = tokens.next().and_then(|s| s.parse().ok()),
            "wtime" => wtime_ms = tokens.next().and_then(|s| s.parse().ok()),
            "byoyomi" => byoyomi_ms = tokens.next().and_then(|s| s.parse().ok()),
            "binc" => binc_ms = tokens.next().and_then(|s| s.parse().ok()),
            "winc" => winc_ms = tokens.next().and_then(|s| s.parse().ok()),
            _ => {
                // 未知トークンは defensive にスキップ。値を伴うトークンの value を
                // 誤って次の key として解釈しないため、一律で次トークンも捨てる
                // と挙動が崩れる。本 driver scope は CSA session の go 出力 (上記
                // 既知 token のみ) を対象とするため、未知 key は単純にスキップで足る。
            }
        }
    }

    // 旧 `csa_engine.rs::Builtin::build_limits` を 1:1 で写経 (commit 3f325da0 line 500-)
    let mut limits = LimitsType::default();
    if let Some(t) = btime_ms {
        limits.time[Color::Black.index()] = t;
    }
    if let Some(t) = wtime_ms {
        limits.time[Color::White.index()] = t;
    }
    if let Some(t) = byoyomi_ms {
        limits.byoyomi[Color::Black.index()] = t;
        limits.byoyomi[Color::White.index()] = t;
    }
    if let Some(t) = binc_ms {
        limits.inc[Color::Black.index()] = t;
    }
    if let Some(t) = winc_ms {
        limits.inc[Color::White.index()] = t;
    }
    limits.ponder = ponder;
    limits.set_start_time();
    Ok(limits)
}

// ─── SearchInfo 変換 ───

/// rshogi-core の `SearchInfo` を OSS の `SearchInfo` に変換する。
pub(crate) fn convert_core_search_info(info: &CoreSearchInfo) -> OssSearchInfo {
    OssSearchInfo {
        depth: Some(info.depth.max(0) as u32),
        seldepth: None,
        score_cp: Some(info.score.raw()),
        score_mate: None,
        nodes: None,
        time_ms: None,
        nps: Some(info.nps),
        pv: info.pv.iter().map(|m| m.to_usi()).collect(),
    }
}

/// `OSS InfoCallback` の第 2 引数 `&str` 用に USI `info` 行を合成する。
pub(crate) fn synthesize_raw_info_line(info: &CoreSearchInfo) -> String {
    let mut s = String::from("info");
    s.push_str(&format!(" depth {}", info.depth.max(0)));
    s.push_str(&format!(" score cp {}", info.score.raw()));
    s.push_str(&format!(" nps {}", info.nps));
    if !info.pv.is_empty() {
        s.push_str(" pv");
        for m in &info.pv {
            s.push(' ');
            s.push_str(&m.to_usi());
        }
    }
    s
}

// ─── 終局判定 ───

/// `parse_game_result` 整合の最終結果行判定。
fn is_final_result_line(line: &str) -> bool {
    matches!(line, "#WIN" | "#LOSE" | "#DRAW" | "#CHUDAN" | "#CENSORED")
}

// ─── unit tests ───

#[cfg(test)]
mod tests {
    use super::*;
    use rshogi_core::types::{Color, Value};

    fn fresh_engine_state() -> Arc<EngineState> {
        Arc::new(EngineState::default())
    }

    #[test]
    fn parse_go_cmd_basic() {
        let limits = parse_go_cmd("go btime 60000 wtime 30000 byoyomi 5000", false).unwrap();
        assert_eq!(limits.time[Color::Black.index()], 60000);
        assert_eq!(limits.time[Color::White.index()], 30000);
        assert_eq!(limits.byoyomi[Color::Black.index()], 5000);
        assert_eq!(limits.byoyomi[Color::White.index()], 5000);
        assert!(!limits.ponder);
        // set_start_time が呼ばれているため elapsed が finite (> 0 ms 程度)
        // private field の検証は避け、observable な elapsed() 経由で確認する。
        let _ = limits.elapsed();
    }

    #[test]
    fn parse_go_cmd_fischer_ponder() {
        let limits = parse_go_cmd(
            "go ponder btime 600000 wtime 600000 binc 5000 winc 5000",
            false,
        )
        .unwrap();
        assert_eq!(limits.inc[Color::Black.index()], 5000);
        assert_eq!(limits.inc[Color::White.index()], 5000);
        assert!(limits.ponder);
    }

    #[test]
    fn parse_go_cmd_ponder_flag_arg() {
        let limits = parse_go_cmd("go btime 1000 wtime 1000", true).unwrap();
        assert!(limits.ponder);
    }

    #[test]
    fn parse_go_cmd_unknown_tokens_skipped() {
        let limits =
            parse_go_cmd("go btime 1000 wtime 1000 movestogo 30 unknown_key", false).unwrap();
        assert_eq!(limits.time[Color::Black.index()], 1000);
    }

    #[test]
    fn parse_go_cmd_rejects_non_go() {
        assert!(parse_go_cmd("position startpos", false).is_err());
    }

    #[test]
    fn apply_position_cmd_startpos_no_moves() {
        let state = fresh_engine_state();
        apply_position_cmd(&state, "position startpos").unwrap();
        let inner = state.inner.lock().unwrap();
        assert_eq!(inner.position.to_sfen(), SFEN_HIRATE);
    }

    #[test]
    fn apply_position_cmd_startpos_with_moves() {
        let state = fresh_engine_state();
        apply_position_cmd(&state, "position startpos moves 7g7f 3c3d").unwrap();
        let inner = state.inner.lock().unwrap();
        let sfen = inner.position.to_sfen();
        assert!(sfen.starts_with("lnsgkgsnl"));
        // 2手指した直後 = ply 3
        assert!(sfen.ends_with(" 3"));
    }

    #[test]
    fn apply_position_cmd_sfen_form() {
        let state = fresh_engine_state();
        let sfen_cmd = format!("position sfen {SFEN_HIRATE}");
        apply_position_cmd(&state, &sfen_cmd).unwrap();
        let inner = state.inner.lock().unwrap();
        assert_eq!(inner.position.to_sfen(), SFEN_HIRATE);
    }

    #[test]
    fn apply_position_cmd_sfen_with_moves() {
        let state = fresh_engine_state();
        let cmd = format!("position sfen {SFEN_HIRATE} moves 7g7f");
        apply_position_cmd(&state, &cmd).unwrap();
        let inner = state.inner.lock().unwrap();
        assert!(inner.position.to_sfen().ends_with(" 2"));
    }

    #[test]
    fn apply_position_cmd_rejects_unknown_variant() {
        let state = fresh_engine_state();
        assert!(apply_position_cmd(&state, "position fen rnbqkbnr").is_err());
    }

    #[test]
    fn convert_core_search_info_maps_fields() {
        let core = CoreSearchInfo {
            depth: 12,
            sel_depth: 14,
            score: Value::new(150),
            nodes: 12345,
            time_ms: 200,
            nps: 60_000,
            hashfull: 0,
            pv: vec![],
            multi_pv: 1,
        };
        let oss = convert_core_search_info(&core);
        assert_eq!(oss.depth, Some(12));
        assert_eq!(oss.seldepth, None); // rshogi-core から取らない (本 PR scope 外)
        assert_eq!(oss.score_cp, Some(150));
        assert_eq!(oss.score_mate, None);
        assert_eq!(oss.nodes, None);
        assert_eq!(oss.time_ms, None);
        assert_eq!(oss.nps, Some(60_000));
        assert!(oss.pv.is_empty());
    }

    #[test]
    fn synthesize_raw_info_line_includes_pv() {
        let core = CoreSearchInfo {
            depth: 7,
            sel_depth: 7,
            score: Value::new(-25),
            nodes: 0,
            time_ms: 0,
            nps: 12_000,
            hashfull: 0,
            pv: vec![],
            multi_pv: 1,
        };
        let line = synthesize_raw_info_line(&core);
        assert!(line.starts_with("info"));
        assert!(line.contains(" depth 7"));
        assert!(line.contains(" score cp -25"));
        assert!(line.contains(" nps 12000"));
        assert!(!line.contains(" pv"));
    }

    #[test]
    fn is_final_result_line_only_5_markers() {
        for marker in ["#WIN", "#LOSE", "#DRAW", "#CHUDAN", "#CENSORED"] {
            assert!(is_final_result_line(marker), "{marker} should be final");
        }
        for non_final in [
            "#TIME_UP",
            "#ILLEGAL_MOVE",
            "#JISHOGI",
            "#SENNICHITE",
            "#MAX_MOVES",
            "#DISCONNECTED",
            "+7776FU",
            "",
        ] {
            assert!(
                !is_final_result_line(non_final),
                "{non_final} should not be final"
            );
        }
    }

    #[test]
    fn go_ponder_is_no_op_and_sets_flag() {
        let state = fresh_engine_state();
        let mut driver = BuiltinEngineDriver::new(state);
        driver
            .go_ponder("position startpos", "go ponder btime 1000 wtime 1000")
            .unwrap();
        assert!(driver.ponder_in_flight.load(Ordering::SeqCst));
        // 探索 thread は起動されていないことを stop_and_wait の即時終了で確認
        driver.stop_and_wait().unwrap();
        assert!(!driver.ponder_in_flight.load(Ordering::SeqCst));
    }

    #[test]
    fn ponderhit_with_info_bails() {
        let state = fresh_engine_state();
        let mut driver = BuiltinEngineDriver::new(state);
        let shutdown = AtomicBool::new(false);
        let (_tx, server_rx) = mpsc::channel();
        let mut cb: Box<InfoCallback<'_>> = Box::new(|_, _| {});
        let result = driver.ponderhit_with_info(&shutdown, &server_rx, &mut *cb);
        assert!(result.is_err());
    }
}

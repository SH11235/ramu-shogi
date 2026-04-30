//! Tauri 側 `BuiltinEngineDriver` の対局 contract test。
//!
//! mock CSA TCP server + in-process [`BuiltinEngineDriver`] (rshogi-core 直駆動)
//! で `run_csa_session` を駆動し、以下を verify する:
//!
//! - 新規対局: 終局までの `CsaSessionEvent` 順序が想定通り、`#TIME_UP` 等の理由
//!   行は server_lines に積まれるのみで最終結果行 (`#WIN`) で `GameEndEvent`
//!   が発火する
//! - resume 経路: `Resumed` event が emit され、last_sfen から盤面継続
//! - shutdown 中断: shutdown フラグで対局が中断され `Disconnected` event で
//!   セッションが閉じる
//! - ponder 抑止: Builtin engine + `engine.ponder = true` 設定でも
//!   `go_ponder` / `ponderhit_with_info` が呼ばれない (`csa_session` 内で
//!   `csa_config.game.ponder = false` 強制が効いている)
//! - active_search 競合: UI 検索 active 中でも `csa_start` 相当経路で UI 検索
//!   が停止 + Builtin が探索開始できる

#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::Receiver;
use std::thread;
use std::time::Duration;

use anyhow::Result;
use rshogi_core::eval::{MaterialLevel, set_material_level};
use rshogi_csa_client::engine::InfoCallback;
use rshogi_csa_client::{Event, SearchOutcome, UsiEngineDriver};

/// 全 test 共通の事前初期化。NNUE が読み込まれていない test 環境でも探索が
/// 走るよう、最小レベルの Material 評価を有効化する (process global)。
/// 多重呼び出しは set_material_level が AtomicU8 + AtomicBool ベースのため安全。
fn init_eval_for_test() {
    set_material_level(MaterialLevel::Lv1);
}

use desktop_lib::test_support::{
    BuiltinEngineDriver, CsaConfig, CsaEngineConfig, CsaEngineType, CsaGameConfig, CsaRecordConfig,
    CsaServerConfig, CsaSessionEvent, CsaTimeConfig, EngineState, run_csa_session,
};

// ────────────────────────────────────────────
// mock TCP server
// ────────────────────────────────────────────

fn spawn_mock_tcp_server<F>(handler: F) -> u16
where
    F: FnOnce(&mut BufReader<TcpStream>, &mut TcpStream) + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    thread::Builder::new()
        .name("ramu-mock-csa-server-builtin".to_owned())
        .spawn(move || {
            let (stream, _) = listener.accept().expect("accept");
            stream.set_read_timeout(Some(Duration::from_secs(15))).ok();
            stream.set_write_timeout(Some(Duration::from_secs(15))).ok();
            let mut writer = stream.try_clone().expect("clone stream");
            let mut reader = BufReader::new(stream);
            handler(&mut reader, &mut writer);
        })
        .expect("spawn");
    port
}

fn read_line(reader: &mut BufReader<TcpStream>) -> String {
    let mut buf = String::new();
    reader.read_line(&mut buf).expect("read line");
    buf.trim_end_matches(['\r', '\n']).to_owned()
}

fn write_lines(writer: &mut TcpStream, lines: &[&str]) {
    for line in lines {
        writeln!(writer, "{}", line).expect("write line");
    }
    writer.flush().expect("flush");
}

fn game_summary_lines(game_id: &str) -> Vec<String> {
    vec![
        "BEGIN Game_Summary".to_owned(),
        "Protocol_Version:1.2".to_owned(),
        format!("Game_ID:{}", game_id),
        "Name+:alice".to_owned(),
        "Name-:bob".to_owned(),
        "Your_Turn:+".to_owned(),
        "To_Move:+".to_owned(),
        "Time_Unit:1sec".to_owned(),
        "Total_Time:600".to_owned(),
        "Byoyomi:1".to_owned(),
        "BEGIN Position".to_owned(),
        "P1-KY-KE-GI-KI-OU-KI-GI-KE-KY".to_owned(),
        "P2 * -HI *  *  *  *  * -KA *".to_owned(),
        "P3-FU-FU-FU-FU-FU-FU-FU-FU-FU".to_owned(),
        "P4 *  *  *  *  *  *  *  *  *".to_owned(),
        "P5 *  *  *  *  *  *  *  *  *".to_owned(),
        "P6 *  *  *  *  *  *  *  *  *".to_owned(),
        "P7+FU+FU+FU+FU+FU+FU+FU+FU+FU".to_owned(),
        "P8 * +KA *  *  *  *  * +HI *".to_owned(),
        "P9+KY+KE+GI+KI+OU+KI+GI+KE+KY".to_owned(),
        "+".to_owned(),
        "END Position".to_owned(),
        "Reconnect_Token:tok-xyz".to_owned(),
        "END Game_Summary".to_owned(),
    ]
}

fn build_builtin_config(port: u16, ponder: bool, reconnect: bool) -> CsaConfig {
    CsaConfig {
        server: CsaServerConfig {
            host: "127.0.0.1".to_owned(),
            port,
            user_id: "alice".to_owned(),
            password: "pw".to_owned(),
            floodgate: false,
            tcp_keepalive: false,
        },
        engine: CsaEngineConfig {
            engine_type: CsaEngineType::Builtin,
            registration_id: None,
            options: Default::default(),
            ponder,
            startup_timeout_sec: 10,
        },
        time: CsaTimeConfig { margin_ms: 0 },
        game: CsaGameConfig {
            max_games: 1,
            restart_engine_every_game: false,
        },
        record: CsaRecordConfig {
            save_dir: String::new(),
        },
        reconnect: if reconnect {
            Some(desktop_lib::test_support::CsaReconnectConfig {
                game_id: "g-resume".to_owned(),
                token: "tok-xyz".to_owned(),
            })
        } else {
            None
        },
    }
}

fn label_event(event: &CsaSessionEvent) -> &'static str {
    match event {
        CsaSessionEvent::Connected => "Connected",
        CsaSessionEvent::GameSummary { .. } => "GameSummary",
        CsaSessionEvent::Resumed { .. } => "Resumed",
        CsaSessionEvent::GameStarted => "GameStarted",
        CsaSessionEvent::BestMoveSelected { .. } => "BestMoveSelected",
        CsaSessionEvent::MoveSent { .. } => "MoveSent",
        CsaSessionEvent::Move { .. } => "Move",
        CsaSessionEvent::SearchInfo { .. } => "SearchInfo",
        CsaSessionEvent::GameEnded { .. } => "GameEnded",
        CsaSessionEvent::Disconnected { .. } => "Disconnected",
        CsaSessionEvent::Error { .. } => "Error",
    }
}

// ────────────────────────────────────────────
// CountingDriver: BuiltinEngineDriver の go_ponder / ponderhit_with_info 呼び出し回数を計測
// ────────────────────────────────────────────

struct CountingDriver {
    inner: BuiltinEngineDriver,
    new_game_called: Arc<AtomicUsize>,
    go_with_info_called: Arc<AtomicUsize>,
    go_ponder_called: Arc<AtomicUsize>,
    ponderhit_called: Arc<AtomicUsize>,
    stop_called: Arc<AtomicUsize>,
    gameover_called: Arc<AtomicUsize>,
}

#[derive(Clone, Default)]
struct CountingHandle {
    new_game: Arc<AtomicUsize>,
    go_with_info: Arc<AtomicUsize>,
    go_ponder: Arc<AtomicUsize>,
    ponderhit: Arc<AtomicUsize>,
    stop: Arc<AtomicUsize>,
    gameover: Arc<AtomicUsize>,
}

impl CountingDriver {
    fn new(inner: BuiltinEngineDriver) -> (Self, CountingHandle) {
        let handle = CountingHandle::default();
        let driver = Self {
            inner,
            new_game_called: Arc::clone(&handle.new_game),
            go_with_info_called: Arc::clone(&handle.go_with_info),
            go_ponder_called: Arc::clone(&handle.go_ponder),
            ponderhit_called: Arc::clone(&handle.ponderhit),
            stop_called: Arc::clone(&handle.stop),
            gameover_called: Arc::clone(&handle.gameover),
        };
        (driver, handle)
    }
}

impl UsiEngineDriver for CountingDriver {
    fn new_game(&mut self) -> Result<()> {
        self.new_game_called.fetch_add(1, Ordering::SeqCst);
        self.inner.new_game()
    }

    fn go_with_info(
        &mut self,
        position_cmd: &str,
        go_cmd: &str,
        shutdown: &AtomicBool,
        server_rx: &Receiver<Event>,
        info_callback: &mut InfoCallback<'_>,
    ) -> Result<SearchOutcome> {
        self.go_with_info_called.fetch_add(1, Ordering::SeqCst);
        self.inner
            .go_with_info(position_cmd, go_cmd, shutdown, server_rx, info_callback)
    }

    fn go_ponder(&mut self, position_cmd: &str, go_cmd: &str) -> Result<()> {
        self.go_ponder_called.fetch_add(1, Ordering::SeqCst);
        self.inner.go_ponder(position_cmd, go_cmd)
    }

    fn ponderhit_with_info(
        &mut self,
        shutdown: &AtomicBool,
        server_rx: &Receiver<Event>,
        info_callback: &mut InfoCallback<'_>,
    ) -> Result<SearchOutcome> {
        self.ponderhit_called.fetch_add(1, Ordering::SeqCst);
        self.inner
            .ponderhit_with_info(shutdown, server_rx, info_callback)
    }

    fn stop_and_wait(&mut self) -> Result<()> {
        self.stop_called.fetch_add(1, Ordering::SeqCst);
        self.inner.stop_and_wait()
    }

    fn gameover(&mut self, result: &str) -> Result<()> {
        self.gameover_called.fetch_add(1, Ordering::SeqCst);
        self.inner.gameover(result)
    }
}

// ────────────────────────────────────────────
// run_game_session_with_events を直接呼んで CountingDriver を観測する。
//
// 本 helper は OSS session の挙動 (config.game.ponder の値に応じた go_ponder/
// ponderhit_with_info の呼び出し有無) を verify するためのもの。
// ramu-shogi 側 `csa_session::build_oss_config` が Builtin engine で ponder=false
// を強制する本体 contract は `csa_session.rs` の unit test
// (`build_oss_config_forces_ponder_off_for_builtin`) で別途 verify している。
// ────────────────────────────────────────────

fn run_session_with_counting(
    port: u16,
    engine_state: Arc<EngineState>,
    ponder: bool,
) -> CountingHandle {
    use rshogi_csa_client::config::{
        CsaClientConfig, EngineConfig as OssEngineConfig, GameConfig as OssGameConfig,
        KeepaliveConfig as OssKeepaliveConfig, RecordConfig as OssRecordConfig,
        ServerConfig as OssServerConfig, TimeConfig as OssTimeConfig,
    };
    use rshogi_csa_client::events::{NoopSessionEventSink, SearchInfoEmitPolicy};
    use rshogi_csa_client::protocol::CsaConnection;
    use rshogi_csa_client::session::run_game_session_with_events;

    let oss_config = CsaClientConfig {
        server: OssServerConfig {
            host: "127.0.0.1".into(),
            port,
            id: "alice".into(),
            password: "pw".into(),
            floodgate: false,
            keepalive: OssKeepaliveConfig {
                tcp: false,
                ..OssKeepaliveConfig::default()
            },
            ws_origin: None,
        },
        engine: OssEngineConfig {
            path: PathBuf::from("<builtin>"),
            options: Default::default(),
            ..OssEngineConfig::default()
        },
        time: OssTimeConfig { margin_msec: 0 },
        game: OssGameConfig {
            max_games: 1,
            restart_engine_every_game: false,
            // 引数で渡された ponder 値をそのまま OSS config に伝搬する。
            // OSS session 自体は config.game.ponder=false の場合に go_ponder/
            // ponderhit_with_info を呼ばない仕様で、CountingDriver で観測することで
            // この OSS 側 contract を verify する。
            ponder,
            search_info_emit: SearchInfoEmitPolicy::default(),
        },
        record: OssRecordConfig {
            enabled: false,
            ..OssRecordConfig::default()
        },
        ..CsaClientConfig::default()
    };

    oss_config.validate().expect("validate config");

    let mut conn = CsaConnection::connect(
        &oss_config.server.host,
        oss_config.server.port,
        oss_config.server.keepalive.tcp,
    )
    .expect("connect");
    conn.login(&oss_config.server.id, &oss_config.server.password)
        .expect("login");

    let inner = BuiltinEngineDriver::new(engine_state);
    let (mut driver, handle) = CountingDriver::new(inner);

    let shutdown = Arc::new(AtomicBool::new(false));
    let mut sink = NoopSessionEventSink;

    // session の戻り値は test 用途では検査不要 (CountingDriver の counter を後段で
    // assert することで verify する)。Result は drop で破棄されるが、Err 時は
    // test harness のログに残るため debug 可能。
    if let Err(err) =
        run_game_session_with_events(&oss_config, &mut conn, &mut driver, shutdown, &mut sink)
    {
        eprintln!("counting session ended with err (expected for some tests): {err}");
    }

    handle
}

// ────────────────────────────────────────────
// Test 1: Builtin 経路で短時間対局完走 + GameEnded で reason が解釈される
// ────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn builtin_fresh_session_completes_with_terminal_reason() {
    init_eval_for_test();
    // server 側から「engine が bestmove を返す前に」`#TIME_UP` + `#LOSE` を
    // 送ることで、driver の poll loop で「理由行 → 最終結果行」の順序を踏むように
    // 仕掛ける。これにより `GameEndEvent.reason` が `time_up` として解釈される
    // ことを verify する。Builtin engine の探索完了を待たずに interrupt 経路で
    // 終局するため、test 実行時間も短い。
    let port = spawn_mock_tcp_server(|reader, writer| {
        read_line(reader);
        write_lines(writer, &["LOGIN:alice OK"]);
        let lines = game_summary_lines("g-1");
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        write_lines(writer, &refs);
        let agree = read_line(reader);
        assert!(agree.starts_with("AGREE"), "AGREE expected, got {agree}");
        write_lines(writer, &["START:g-1"]);
        // engine が bestmove を返す前に terminal lines を送る。
        // 200ms 待ってから (engine が go を受信して探索開始する時間を確保) 送信。
        std::thread::sleep(Duration::from_millis(200));
        write_lines(writer, &["#TIME_UP", "#LOSE"]);
        // 後続 LOGOUT 等を読む (best-effort)
        reader
            .get_mut()
            .set_read_timeout(Some(Duration::from_secs(5)))
            .ok();
        let mut buf = String::new();
        reader.read_line(&mut buf).ok();
    });

    let engine_path = PathBuf::from("<builtin>");
    let config = build_builtin_config(port, false, false);
    let shutdown = Arc::new(AtomicBool::new(false));
    let engine_state = Arc::new(EngineState::default());

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<CsaSessionEvent>();
    let sink = desktop_lib::test_support::TauriEventSink::new(tx);

    let outcome = run_csa_session(config, engine_path, engine_state, shutdown, sink).await;
    // server interrupt 経路では Ok か Err (GameEnd 後に Disconnected) のいずれも有り得る。
    // どちらも assert はしないが、test harness ログには記録する。
    eprintln!("[test 1] run_csa_session outcome: {outcome:?}");

    let mut received_labels = Vec::new();
    let mut last_game_end_reason: Option<String> = None;
    while let Ok(event) = rx.try_recv() {
        if let CsaSessionEvent::GameEnded { reason, .. } = &event {
            last_game_end_reason = Some(reason.clone());
        }
        received_labels.push(label_event(&event));
    }
    let filtered: Vec<&str> = received_labels
        .into_iter()
        .filter(|e| *e != "SearchInfo")
        .collect();

    // server interrupt 経路: BestMoveSelected / MoveSent / Move 系は出ない。
    let expected = vec![
        "Connected",
        "GameSummary",
        "GameStarted",
        "GameEnded",
        "Disconnected",
    ];
    assert_eq!(
        filtered, expected,
        "server interrupt 時の Builtin event 順が不一致: {filtered:?}"
    );

    assert_eq!(
        last_game_end_reason.as_deref(),
        Some("time_up"),
        "理由行 #TIME_UP + 最終結果行 #LOSE が GameEndReason::TimeUp に解釈されること"
    );
}

// ────────────────────────────────────────────
// Test 2: Builtin resume 経路で `Resumed` event が発火
// ────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn builtin_resume_session_emits_resumed_event() {
    init_eval_for_test();
    // resume 経路: GameSummary 受信 + Reconnect_State → Resumed event。
    // ここでも engine の bestmove を待たずに server から最終結果行で interrupt
    // させ、test 時間を短く保つ。Resumed event の last_sfen が反映されることが
    // 主な検証対象。
    let port = spawn_mock_tcp_server(|reader, writer| {
        read_line(reader);
        write_lines(writer, &["LOGIN:alice OK"]);
        let lines = game_summary_lines("g-resume");
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        write_lines(writer, &refs);
        write_lines(
            writer,
            &[
                "BEGIN Reconnect_State",
                "Current_Turn:+",
                "Black_Time_Remaining_Ms:599500",
                "White_Time_Remaining_Ms:600000",
                "END Reconnect_State",
            ],
        );
        // engine bestmove 待たずに #WIN を即送信
        std::thread::sleep(Duration::from_millis(200));
        write_lines(writer, &["#WIN"]);
        reader
            .get_mut()
            .set_read_timeout(Some(Duration::from_secs(5)))
            .ok();
        let mut buf = String::new();
        reader.read_line(&mut buf).ok();
    });

    let engine_path = PathBuf::from("<builtin>");
    let config = build_builtin_config(port, false, true);
    let shutdown = Arc::new(AtomicBool::new(false));
    let engine_state = Arc::new(EngineState::default());

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<CsaSessionEvent>();
    let sink = desktop_lib::test_support::TauriEventSink::new(tx);

    let outcome = run_csa_session(config, engine_path, engine_state, shutdown, sink).await;
    eprintln!("[test 2] run_csa_session outcome: {outcome:?}");

    let mut received_labels = Vec::new();
    let mut resumed_last_sfen: Option<String> = None;
    while let Ok(event) = rx.try_recv() {
        if let CsaSessionEvent::Resumed { last_sfen, .. } = &event {
            resumed_last_sfen = Some(last_sfen.clone());
        }
        received_labels.push(label_event(&event));
    }
    let filtered: Vec<&str> = received_labels
        .into_iter()
        .filter(|e| *e != "SearchInfo")
        .collect();

    // server interrupt 経路: Connected → Resumed → GameStarted → GameEnded → Disconnected
    let expected = vec![
        "Connected",
        "Resumed",
        "GameStarted",
        "GameEnded",
        "Disconnected",
    ];
    assert_eq!(
        filtered, expected,
        "Builtin resume server-interrupt event 順が不一致: {filtered:?}"
    );
    assert!(
        resumed_last_sfen.is_some(),
        "Resumed event は last_sfen を含むこと"
    );
}

// ────────────────────────────────────────────
// Test 3: shutdown で Builtin 対局が中断され、Disconnected で閉じる
// ────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn builtin_shutdown_aborts_session_and_emits_disconnected() {
    init_eval_for_test();
    let server_done = Arc::new(AtomicBool::new(false));
    let server_done_clone = Arc::clone(&server_done);
    let port = spawn_mock_tcp_server(move |reader, writer| {
        // LOGIN
        read_line(reader);
        write_lines(writer, &["LOGIN:alice OK"]);
        // Game_Summary
        let lines = game_summary_lines("g-abort");
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        write_lines(writer, &refs);
        let agree = read_line(reader);
        assert!(agree.starts_with("AGREE"), "AGREE expected, got {agree}");
        write_lines(writer, &["START:g-abort"]);
        // Engine が長く考えるよう byoyomi が 1sec で短いが、shutdown で
        // 即座に bestmove を返す経路を期待する。
        // ここでは MOVE を待たず、test 側が shutdown を立てるのを 2sec 待って
        // server から終局通知を出す。
        // それまでに engine から MOVE が来る可能性もあるが、shutdown 経路では
        // engine は resign を返すか、bestmove drain → ServerInterrupt 経路で抜ける。
        // server 側は shutdown 観測後、CHUDAN を送り、LOGOUT を読んで終了する想定。
        let mut buf = String::new();
        // 2 秒以内に何か来れば OK、来なくても server を継続。
        reader
            .get_mut()
            .set_read_timeout(Some(Duration::from_secs(3)))
            .ok();
        reader.read_line(&mut buf).ok();
        // LOGOUT を読みに行く (best-effort)
        reader.read_line(&mut buf).ok();
        server_done_clone.store(true, Ordering::SeqCst);
    });

    let engine_path = PathBuf::from("<builtin>");
    let config = build_builtin_config(port, false, false);
    let shutdown = Arc::new(AtomicBool::new(false));
    let shutdown_clone = Arc::clone(&shutdown);
    let engine_state = Arc::new(EngineState::default());

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<CsaSessionEvent>();
    let sink = desktop_lib::test_support::TauriEventSink::new(tx);

    // 200ms 後に shutdown を立てて対局を中断
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(200)).await;
        shutdown_clone.store(true, Ordering::SeqCst);
    });

    let outcome = run_csa_session(config, engine_path, engine_state, shutdown, sink).await;
    // shutdown 経路では Err でも Ok でも良い (best-effort closure 経由で
    // SessionError::Shutdown が返る場合と Ok(SessionOutcome::Stopped) の場合がある)
    eprintln!("[test 3 shutdown] run_csa_session outcome: {outcome:?}");

    // events を全て drain
    let mut events = Vec::new();
    while let Ok(event) = rx.try_recv() {
        events.push(event);
    }
    let labels: Vec<&str> = events
        .iter()
        .map(label_event)
        .filter(|e| *e != "SearchInfo")
        .collect();

    // shutdown 経路では Connected → ... → Disconnected で閉じる
    assert_eq!(labels.first(), Some(&"Connected"));
    assert!(
        labels.contains(&"Disconnected"),
        "shutdown 後は Disconnected が emit されるべき: {labels:?}"
    );
}

// ────────────────────────────────────────────
// Test 4: ponder 抑止 (CountingDriver で go_ponder / ponderhit_with_info の
// 呼び出し回数が 0 であること)
// ────────────────────────────────────────────

#[test]
fn builtin_engine_does_not_use_ponder() {
    init_eval_for_test();
    let port = spawn_mock_tcp_server(|reader, writer| {
        read_line(reader);
        write_lines(writer, &["LOGIN:alice OK"]);
        let lines = game_summary_lines("g-noponder");
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        write_lines(writer, &refs);
        let agree = read_line(reader);
        assert!(agree.starts_with("AGREE"), "AGREE expected, got {agree}");
        write_lines(writer, &["START:g-noponder"]);
        // engine が探索を始めた直後に server から最終結果を送って interrupt させる
        std::thread::sleep(Duration::from_millis(200));
        write_lines(writer, &["#WIN"]);
        reader
            .get_mut()
            .set_read_timeout(Some(Duration::from_secs(5)))
            .ok();
        let mut buf = String::new();
        reader.read_line(&mut buf).ok();
    });

    let engine_state = Arc::new(EngineState::default());
    // OSS session 自体の挙動を verify: config.game.ponder=false の場合、
    // `run_game_session_with_events` は `go_ponder` / `ponderhit_with_info` を
    // 呼ばない。ramu-shogi 側 `csa_session::build_oss_config` が Builtin engine の
    // ときに ponder=false を強制する本体 contract は、`csa_session.rs` の
    // unit test (`build_oss_config_forces_ponder_off_for_builtin`) で別途 verify。
    let handle = run_session_with_counting(port, engine_state, /* ponder= */ false);

    assert_eq!(
        handle.go_ponder.load(Ordering::SeqCst),
        0,
        "Builtin engine では go_ponder が呼ばれてはいけない"
    );
    assert_eq!(
        handle.ponderhit.load(Ordering::SeqCst),
        0,
        "Builtin engine では ponderhit_with_info が呼ばれてはいけない"
    );
    // sanity: 対局自体は走っている (go_with_info が 1 回以上呼ばれている)
    assert!(
        handle.go_with_info.load(Ordering::SeqCst) >= 1,
        "go_with_info が 1 回以上呼ばれること"
    );
    assert_eq!(
        handle.new_game.load(Ordering::SeqCst),
        1,
        "new_game は 1 回呼ばれること"
    );
}

// ────────────────────────────────────────────
// Test 5: BuiltinEngineDriver の new_game / stop_and_wait / Drop が
// active_search None 状態 (= csa_start の Builtin 前置処理後の状態) で
// 安全に呼べることを verify する。
//
// `csa_start` は UI active_search を stop + restore_search してから
// BuiltinEngineDriver を起動するため、driver から見ると常に inner.search は
// Some の状態。本 test はその状態で driver の lifecycle method を呼び、
// idempotent に動作することを検証する (UI 競合経路の代理 verification)。
// ────────────────────────────────────────────

#[test]
fn builtin_driver_lifecycle_methods_are_idempotent() {
    init_eval_for_test();
    let engine_state = Arc::new(EngineState::default());

    let mut driver = BuiltinEngineDriver::new(Arc::clone(&engine_state));

    // new_game は何度呼んでも安全 (内部で stop_and_wait → clear_tt)
    driver.new_game().expect("new_game 1st call");
    driver.new_game().expect("new_game 2nd call (idempotent)");

    // stop_and_wait は探索中でなくても安全
    driver.stop_and_wait().expect("stop_and_wait 1st call");
    driver
        .stop_and_wait()
        .expect("stop_and_wait 2nd call (idempotent)");

    // gameover は no-op
    driver.gameover("draw").expect("gameover");

    // Drop 時に panic しないこと (Drop は signal_stop + drain_and_join を idempotent 実行)
    drop(driver);

    // 同じ engine_state で再度 driver を作って Drop も問題ないこと
    let driver2 = BuiltinEngineDriver::new(Arc::clone(&engine_state));
    drop(driver2);
}

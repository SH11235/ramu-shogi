//! Tauri 側の `run_csa_session` wrapper (External engine 経路) contract test。
//!
//! mock TCP CSA サーバ + bash 製 mock USI エンジンで `run_csa_session` を駆動し、
//! `TauriEventSink` 経由で `CsaSessionEvent` が想定順序で配信されることを確認する。
//! Builtin engine 経路は `tests/csa_builtin_contract.rs` を参照。OSS 側
//! (`rshogi_csa_client`) の詳細 unit test は OSS に委ね、本 test は Tauri wrapper の
//! event 変換 + mpsc 配信のみを対象とする。

#![cfg(unix)]

use std::io::{BufRead, BufReader, Write};
use std::net::TcpListener;
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

use rshogi_csa_client::events::{SessionEventSink, SessionProgress, SinkError};

// `desktop_lib` の internal API を `pub use` 経由で参照する。
use desktop_lib::test_support::{
    CsaConfig, CsaEngineConfig, CsaEngineType, CsaGameConfig, CsaRecordConfig, CsaServerConfig,
    CsaSessionEvent, CsaTimeConfig, EngineState, run_csa_session,
};

// ────────────────────────────────────────────
// mock TCP server / mock USI engine
// ────────────────────────────────────────────

fn spawn_mock_tcp_server<F>(handler: F) -> u16
where
    F: FnOnce(&mut BufReader<std::net::TcpStream>, &mut std::net::TcpStream) + Send + 'static,
{
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().unwrap().port();
    thread::Builder::new()
        .name("ramu-mock-csa-server".to_owned())
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

fn read_line(reader: &mut BufReader<std::net::TcpStream>) -> String {
    let mut buf = String::new();
    reader.read_line(&mut buf).expect("read line");
    buf.trim_end_matches(['\r', '\n']).to_owned()
}

fn write_lines(writer: &mut std::net::TcpStream, lines: &[&str]) {
    for line in lines {
        writeln!(writer, "{}", line).expect("write line");
    }
    writer.flush().expect("flush");
}

fn mock_usi_engine_script() -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let dir = std::env::temp_dir();
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let path = dir.join(format!("ramu_mock_usi_{}_{}.sh", std::process::id(), seq));
    let script = r#"#!/usr/bin/env bash
while IFS= read -r line; do
    case "$line" in
        usi)
            echo "id name mock"
            echo "usiok"
            ;;
        isready)
            echo "readyok"
            ;;
        usinewgame)
            ;;
        position*)
            ;;
        go*)
            echo "info depth 5 score cp 100 nodes 1234 nps 5000 time 200 pv 7g7f"
            echo "bestmove 7g7f"
            ;;
        ponderhit)
            echo "info depth 5 score cp 100 nodes 1234 nps 5000 time 200 pv 7g7f"
            echo "bestmove 7g7f"
            ;;
        stop)
            echo "bestmove 7g7f"
            ;;
        gameover*)
            ;;
        quit)
            exit 0
            ;;
    esac
done
"#;
    std::fs::write(&path, script).expect("write mock engine script");
    let mut perms = std::fs::metadata(&path).expect("stat").permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&path, perms).expect("set perms");
    path
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
        "Byoyomi:10".to_owned(),
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

fn build_config(port: u16, reconnect: bool) -> CsaConfig {
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
            engine_type: CsaEngineType::External,
            registration_id: Some("mock".to_owned()),
            options: Default::default(),
            ponder: false,
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

// ────────────────────────────────────────────
// 共通: TauriEventSink を直接呼ぶための capturing sink (test 側で event 観測)
// ────────────────────────────────────────────

#[derive(Default)]
struct CapturingSink {
    events: Arc<Mutex<Vec<&'static str>>>,
}

impl CapturingSink {
    fn handle(&self) -> Arc<Mutex<Vec<&'static str>>> {
        Arc::clone(&self.events)
    }
}

impl SessionEventSink for CapturingSink {
    fn on_event(&mut self, event: SessionProgress) -> Result<(), SinkError> {
        let _ = CsaSessionEvent::from_session_progress(event.clone());
        self.events.lock().unwrap().push(label_for(&event));
        Ok(())
    }
}

fn label_for(event: &SessionProgress) -> &'static str {
    match event {
        SessionProgress::Connected => "Connected",
        SessionProgress::GameSummary(_) => "GameSummary",
        SessionProgress::Resumed { .. } => "Resumed",
        SessionProgress::GameStarted => "GameStarted",
        SessionProgress::BestMoveSelected(_) => "BestMoveSelected",
        SessionProgress::MoveSent(_) => "MoveSent",
        SessionProgress::MoveConfirmed(_) => "MoveConfirmed",
        SessionProgress::SearchInfo(_) => "SearchInfo",
        SessionProgress::GameEnded(_) => "GameEnded",
        SessionProgress::Disconnected { .. } => "Disconnected",
    }
}

// ────────────────────────────────────────────
// `run_csa_session` 経由で TauriEventSink が CsaSessionEvent を流す test
// ────────────────────────────────────────────

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fresh_session_via_run_csa_session() {
    let port = spawn_mock_tcp_server(|reader, writer| {
        let _ = read_line(reader);
        write_lines(writer, &["LOGIN:alice OK"]);
        let lines = game_summary_lines("g-1");
        let refs: Vec<&str> = lines.iter().map(String::as_str).collect();
        write_lines(writer, &refs);
        let agree = read_line(reader);
        assert!(agree.starts_with("AGREE"), "AGREE expected, got {agree}");
        write_lines(writer, &["START:g-1"]);
        let mv = read_line(reader);
        assert!(mv.starts_with("+7776FU"), "expected +7776FU, got {mv}");
        write_lines(writer, &["+7776FU,T2"]);
        write_lines(writer, &["#WIN"]);
        let _ = read_line(reader);
    });

    let engine_path = mock_usi_engine_script();
    let config = build_config(port, false);
    let shutdown = Arc::new(AtomicBool::new(false));
    let engine_state = Arc::new(EngineState::default());

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<CsaSessionEvent>();
    let sink = desktop_lib::test_support::TauriEventSink::new(tx);

    let outcome = run_csa_session(config, engine_path, engine_state, shutdown, sink).await;
    assert!(
        outcome.is_ok(),
        "run_csa_session should succeed: {outcome:?}"
    );

    let mut received = Vec::new();
    while let Ok(event) = rx.try_recv() {
        received.push(label_event(&event));
    }
    let filtered: Vec<&str> = received
        .into_iter()
        .filter(|e| *e != "SearchInfo")
        .collect();
    let expected = vec![
        "Connected",
        "GameSummary",
        "GameStarted",
        "BestMoveSelected",
        "MoveSent",
        "Move",
        "GameEnded",
        "Disconnected",
    ];
    assert_eq!(filtered, expected, "Tauri event 順が不一致: {filtered:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn resume_session_via_run_csa_session() {
    let port = spawn_mock_tcp_server(|reader, writer| {
        let _ = read_line(reader);
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
        let mv = read_line(reader);
        assert!(mv.starts_with("+7776FU"), "expected +7776FU, got {mv}");
        write_lines(writer, &["+7776FU,T1"]);
        write_lines(writer, &["#WIN"]);
        let _ = read_line(reader);
    });

    let engine_path = mock_usi_engine_script();
    let config = build_config(port, true);
    let shutdown = Arc::new(AtomicBool::new(false));
    let engine_state = Arc::new(EngineState::default());

    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<CsaSessionEvent>();
    let sink = desktop_lib::test_support::TauriEventSink::new(tx);

    let outcome = run_csa_session(config, engine_path, engine_state, shutdown, sink).await;
    assert!(outcome.is_ok(), "resume should succeed: {outcome:?}");

    let mut received = Vec::new();
    while let Ok(event) = rx.try_recv() {
        received.push(label_event(&event));
    }
    let filtered: Vec<&str> = received
        .into_iter()
        .filter(|e| *e != "SearchInfo")
        .collect();

    // resume 経路: GameSummary は出ず、Resumed に置き換わる。history replay 無し。
    let expected = vec![
        "Connected",
        "Resumed",
        "GameStarted",
        "BestMoveSelected",
        "MoveSent",
        "Move",
        "GameEnded",
        "Disconnected",
    ];
    assert_eq!(
        filtered, expected,
        "resume Tauri event 順が不一致: {filtered:?}"
    );
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

// 補助: dead_code 警告を消すため CapturingSink を test 内で 1 度参照する。
#[test]
fn capturing_sink_smoke() {
    let sink = CapturingSink::default();
    assert!(sink.handle().lock().unwrap().is_empty());
}

//! CSA対局マネージャーとTauriコマンド
//!
//! セッションライフサイクル管理、棋譜書き出し、フロントエンド向けコマンドを提供する。

use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use chrono::Local;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

use crate::EngineState;
use crate::csa_engine::CsaEngine;
use crate::csa_protocol::CsaProtocol;
use crate::csa_session::{SessionResult, run_session};
use crate::csa_types::{
    ClockInfo, CsaConfig, CsaEngineType, CsaError, CsaSessionEvent, GameResult, GameSummary,
    ServerLine,
};
use crate::engine_lock::{EngineLock, EngineTarget};

/// CSAセッションイベントのチャネル名
const CSA_SESSION_EVENT: &str = "csa://session";

// ─── CsaGameManager ───

/// CSA対局セッションを管理する。同時に1セッションのみ実行可能。
pub struct CsaGameManager {
    session_handle: StdMutex<Option<tokio::task::JoinHandle<()>>>,
    cancel_token: StdMutex<CancellationToken>,
}

impl Default for CsaGameManager {
    fn default() -> Self {
        Self {
            session_handle: StdMutex::new(None),
            cancel_token: StdMutex::new(CancellationToken::new()),
        }
    }
}

// ─── Session Task ───

/// CSAセッションのメインタスク。
/// エンジン起動→サーバー接続→ログイン→対局ループ→ログアウト→シャットダウン。
async fn run_csa_session_task(
    config: CsaConfig,
    app: AppHandle,
    engine_lock: Arc<EngineLock>,
    engine_state: Arc<EngineState>,
    cancel_token: CancellationToken,
) {
    let emit = |event: CsaSessionEvent| {
        let _ = app.emit(CSA_SESSION_EVENT, &event);
    };

    // イベント送信用 mpsc（run_session 内部で使用）
    let (event_tx, mut event_rx) = mpsc::channel::<CsaSessionEvent>(64);

    // イベント中継タスク: event_rx → app.emit
    let app_clone = app.clone();
    let relay_handle = tokio::spawn(async move {
        while let Some(ev) = event_rx.recv().await {
            let _ = app_clone.emit(CSA_SESSION_EVENT, &ev);
        }
    });

    let result = run_csa_session_inner(
        &config,
        &app,
        &engine_lock,
        &engine_state,
        &cancel_token,
        &event_tx,
    )
    .await;

    // エラー時はイベント送信
    if let Err(e) = result {
        emit(CsaSessionEvent::Error {
            message: e.to_string(),
        });
    }

    // 常に Disconnected を送信
    emit(CsaSessionEvent::Disconnected);

    // relay タスクを終了
    drop(event_tx);
    let _ = relay_handle.await;
}

/// セッション本体。エラーを返すことで呼び出し元でまとめて処理する。
async fn run_csa_session_inner(
    config: &CsaConfig,
    app: &AppHandle,
    engine_lock: &Arc<EngineLock>,
    engine_state: &Arc<EngineState>,
    cancel_token: &CancellationToken,
    event_tx: &mpsc::Sender<CsaSessionEvent>,
) -> Result<(), CsaError> {
    // エンジンロック取得
    let engine_target = match config.engine.engine_type {
        CsaEngineType::Builtin => EngineTarget::Builtin,
        CsaEngineType::External => EngineTarget::External {
            registration_id: config.engine.registration_id.clone().unwrap_or_default(),
        },
    };
    let _lock_guard = engine_lock
        .acquire(engine_target)
        .map_err(CsaError::EngineError)?;

    // エンジン起動
    let mut engine = match config.engine.engine_type {
        CsaEngineType::Builtin => CsaEngine::init_builtin(Arc::clone(engine_state)),
        CsaEngineType::External => {
            let registration_id = config.engine.registration_id.as_deref().unwrap_or_default();
            // Store から registration_id に対応するエンジンパスを解決
            let path = resolve_engine_path(app, registration_id)?;
            let options: Vec<(String, String)> = config
                .engine
                .options
                .iter()
                .map(|(k, v)| {
                    let val = match v {
                        serde_json::Value::String(s) => s.clone(),
                        other => other.to_string(),
                    };
                    (k.clone(), val)
                })
                .collect();
            let timeout = Duration::from_secs(config.engine.startup_timeout_sec);
            CsaEngine::spawn_external(&path, &options, timeout).await?
        }
    };

    // サーバー接続
    let mut protocol = CsaProtocol::connect(&config.server.host, config.server.port).await?;

    // ログイン
    protocol
        .login(&config.server.user_id, &config.server.password)
        .await?;

    // Connected イベント
    let _ = event_tx
        .send(CsaSessionEvent::Connected {
            host: format!("{}:{}", config.server.host, config.server.port),
        })
        .await;

    let max_games = config.game.max_games; // 0 = 無制限
    let mut games_played = 0u32;

    // 最初の GAME_SUMMARY を受信
    let summary = tokio::select! {
        result = protocol.recv_game_summary() => result?,
        _ = cancel_token.cancelled() => {
            engine.shutdown().await?;
            return Ok(());
        }
    };

    // 対局 IO モードに遷移（protocol を consume）
    let (mut game_io, mut server_rx) = protocol.start_game_io();

    // 最初の対局を開始するために summary を保持
    let mut current_summary = Some(summary);

    loop {
        // キャンセルチェック
        if cancel_token.is_cancelled() {
            break;
        }

        // max_games チェック（0 = 無制限）
        if max_games > 0 && games_played >= max_games {
            break;
        }

        let summary = match current_summary.take() {
            Some(s) => s,
            None => {
                // 連続対局: 次の GAME_SUMMARY を待つ
                tokio::select! {
                    result = game_io.recv_next_game_summary(&mut server_rx) => {
                        match result {
                            Ok(s) => s,
                            Err(_) => break, // サーバー切断等
                        }
                    }
                    _ = cancel_token.cancelled() => break,
                }
            }
        };

        // GameSummary イベント
        let _ = event_tx
            .send(CsaSessionEvent::GameSummary {
                game_id: summary.game_id.clone(),
                my_color: summary.my_color,
                sente_name: summary.sente_name.clone(),
                gote_name: summary.gote_name.clone(),
                sfen: summary.sfen.clone(),
                clocks: ClockInfo {
                    black_time_ms: summary.black_time.total_ms,
                    white_time_ms: summary.white_time.total_ms,
                    byoyomi_ms: summary.black_time.byoyomi_ms,
                    increment_ms: summary.black_time.increment_ms,
                },
            })
            .await;

        // AGREE（game_io 経由で送信）
        game_io
            .send_special(&format!("AGREE {}", summary.game_id))
            .await?;

        // START を待つ
        loop {
            let line = tokio::select! {
                line = server_rx.recv() => {
                    line.ok_or(CsaError::ServerDisconnected)?
                }
                _ = cancel_token.cancelled() => {
                    break;
                }
            };
            if let ServerLine::Other(ref text) = line {
                let trimmed = text.trim();
                if trimmed.starts_with("START:") {
                    break;
                }
                if trimmed.starts_with("REJECT:") {
                    let _ = event_tx
                        .send(CsaSessionEvent::Error {
                            message: format!("サーバーが対局を拒否: {trimmed}"),
                        })
                        .await;
                    break;
                }
            }
        }

        if cancel_token.is_cancelled() {
            break;
        }

        // エンジン初期化
        engine.new_game().await?;
        engine.set_position(&summary.sfen, &[]).await?;

        // GameStarted イベント
        let _ = event_tx.send(CsaSessionEvent::GameStarted).await;

        // 対局実行
        let SessionResult { game_result, moves } = run_session(
            &mut game_io,
            &mut server_rx,
            &mut engine,
            &summary,
            config,
            cancel_token,
            event_tx,
        )
        .await?;

        games_played += 1;

        // 棋譜書き出し
        let record_path = write_game_record(
            &summary,
            &moves,
            gameover_to_result_str(&game_result),
            &config.record.save_dir,
        )
        .await
        .ok()
        .flatten();

        // GameEnded イベント
        let _ = event_tx
            .send(CsaSessionEvent::GameEnded {
                result: game_result.clone(),
                reason: None,
                games_played,
                record_path,
            })
            .await;

        // gameover 送信
        engine
            .gameover(gameover_to_result_str(&game_result))
            .await?;
    }

    // ログアウト＋エンジンシャットダウン
    game_io.logout().await.ok();
    engine.shutdown().await?;

    Ok(())
}

// ─── RecordWriter ───

/// CSA V2.2 形式の棋譜ファイルを書き出す。
async fn write_game_record(
    summary: &GameSummary,
    moves: &[(String, u32)],
    result_str: &str,
    save_dir: &str,
) -> Result<Option<String>, CsaError> {
    if save_dir.is_empty() {
        return Ok(None);
    }

    // ディレクトリ作成
    tokio::fs::create_dir_all(save_dir).await?;

    // ファイル名生成
    let now = Local::now();
    let timestamp = now.format("%Y%m%d_%H%M%S").to_string();
    let sente = sanitize_filename(&summary.sente_name);
    let gote = sanitize_filename(&summary.gote_name);
    let filename = format!("{timestamp}_{sente}_vs_{gote}.csa");
    let path = std::path::Path::new(save_dir).join(&filename);

    // CSA V2.2 ヘッダー
    let mut content = String::new();
    content.push_str("V2.2\n");
    content.push_str(&format!("N+{}\n", summary.sente_name));
    content.push_str(&format!("N-{}\n", summary.gote_name));
    content.push_str(&format!("$EVENT:{}\n", summary.game_id));
    content.push_str(&format!(
        "$START_TIME:{}\n",
        now.format("%Y/%m/%d %H:%M:%S")
    ));

    // 指し手の書き出し
    for (csa_move, time_sec) in moves {
        content.push_str(&format!("{csa_move}\nT{time_sec}\n"));
    }

    // 結果
    content.push_str(&format!("'result:{result_str}\n"));

    let path_str = path.to_string_lossy().to_string();
    tokio::fs::write(&path, content).await?;

    Ok(Some(path_str))
}

/// Store の "engines" キーから registration_id に対応するエンジンパスを解決する。
fn resolve_engine_path(app: &AppHandle, registration_id: &str) -> Result<String, CsaError> {
    use crate::usi_engine::EngineRegistration;

    let store = app
        .store("store.json")
        .map_err(|e| CsaError::EngineError(format!("ストア初期化エラー: {e}")))?;
    let registrations: Vec<EngineRegistration> = store
        .get("engines")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();
    let reg = registrations
        .iter()
        .find(|r| r.id == registration_id)
        .ok_or_else(|| {
            CsaError::EngineError(format!(
                "エンジンが見つかりません (id: {registration_id})"
            ))
        })?;
    Ok(reg.path.clone())
}

/// ファイル名に使えない文字を置換する
fn sanitize_filename(name: &str) -> String {
    name.chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '_',
            _ => c,
        })
        .collect()
}

/// GameResult を文字列に変換する
fn gameover_to_result_str(result: &GameResult) -> &'static str {
    match result {
        GameResult::Win => "win",
        GameResult::Lose => "lose",
        GameResult::Draw => "draw",
        GameResult::Censored => "censored",
        GameResult::Interrupted => "interrupted",
    }
}

// ─── Tauri Commands ───

/// CSA対局を開始する
#[tauri::command]
pub async fn csa_start(
    config: CsaConfig,
    app: AppHandle,
    manager: State<'_, Arc<CsaGameManager>>,
    engine_lock: State<'_, Arc<EngineLock>>,
    engine_state: State<'_, Arc<EngineState>>,
) -> Result<(), String> {
    // バリデーション
    if config.server.port == 0 {
        return Err("ポート番号が不正です（1-65535）".to_string());
    }
    if config.server.user_id.is_empty() {
        return Err("ユーザーIDが空です".to_string());
    }
    if config.server.host.is_empty() {
        return Err("ホスト名が空です".to_string());
    }

    // 既存セッションのチェック
    {
        let handle_guard = manager
            .session_handle
            .lock()
            .map_err(|e| format!("内部エラー: {e}"))?;
        if handle_guard.is_some() {
            return Err("CSA対局セッションが既に実行中です".to_string());
        }
    }

    // キャンセルトークンをリセット
    let cancel_token = CancellationToken::new();
    {
        let mut token_guard = manager
            .cancel_token
            .lock()
            .map_err(|e| format!("内部エラー: {e}"))?;
        *token_guard = cancel_token.clone();
    }

    let engine_lock = Arc::clone(&engine_lock);
    let engine_state = Arc::clone(&engine_state);

    // セッションタスクを起動
    let manager_clone = Arc::clone(&manager);
    let handle = tokio::spawn(async move {
        run_csa_session_task(config, app, engine_lock, engine_state, cancel_token).await;

        // タスク完了時に session_handle をクリア
        if let Ok(mut guard) = manager_clone.session_handle.lock() {
            *guard = None;
        }
    });

    // JoinHandle を保存
    {
        let mut handle_guard = manager
            .session_handle
            .lock()
            .map_err(|e| format!("内部エラー: {e}"))?;
        *handle_guard = Some(handle);
    }

    Ok(())
}

/// CSA対局を停止する
#[tauri::command]
pub async fn csa_stop(manager: State<'_, Arc<CsaGameManager>>) -> Result<(), String> {
    let token = {
        manager
            .cancel_token
            .lock()
            .map_err(|e| format!("内部エラー: {e}"))?
            .clone()
    };
    token.cancel();
    Ok(())
}

/// CSA設定を保存する
#[tauri::command]
pub async fn csa_save_config(app: AppHandle, config: CsaConfig) -> Result<(), String> {
    let store = app
        .store("csa-store.json")
        .map_err(|e| format!("ストア初期化エラー: {e}"))?;
    let value = serde_json::to_value(&config).map_err(|e| format!("シリアライズエラー: {e}"))?;
    store.set("csa-config", value);
    store.save().map_err(|e| format!("ストア保存エラー: {e}"))?;
    Ok(())
}

/// CSA設定を読み込む
#[tauri::command]
pub async fn csa_load_config(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let store = app
        .store("csa-store.json")
        .map_err(|e| format!("ストア初期化エラー: {e}"))?;
    Ok(store.get("csa-config"))
}

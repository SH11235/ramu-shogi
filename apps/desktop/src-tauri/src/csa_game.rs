//! CSA 対局マネージャと Tauri コマンド。
//!
//! - `csa_start`: 設定を受け取り CSA 対局セッションを開始する
//! - `csa_stop`: shutdown フラグを立て対局を中断する
//! - `csa_save_config` / `csa_load_config`: tauri-plugin-store への永続化
//!
//! セッション本体は [`crate::csa_session::run_csa_session`] が `tokio::task::spawn_blocking`
//! 経由で `rshogi_csa_client` の同期 API を駆動する (External / Builtin engine の
//! いずれも対応)。`SessionEventSink` から流れる `CsaSessionEvent` は mpsc を介して
//! `csa://session` チャネルに emit される。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;
use tokio::sync::mpsc;

use crate::EngineState;
use crate::csa_engine::resolve_engine_path;
use crate::csa_session::run_csa_session;
use crate::csa_sink::TauriEventSink;
use crate::csa_types::{CsaConfig, CsaEngineType, CsaSessionEvent};
use crate::engine_lock::{EngineLock, EngineTarget};

/// CSA セッションイベントの Tauri チャネル名
const CSA_SESSION_EVENT: &str = "csa://session";

// ─── CsaGameManager ───

/// CSA 対局セッションを管理する。同時に 1 セッションのみ実行可能。
pub struct CsaGameManager {
    session_handle: StdMutex<Option<tokio::task::JoinHandle<()>>>,
    shutdown: Arc<AtomicBool>,
}

impl Default for CsaGameManager {
    fn default() -> Self {
        Self {
            session_handle: StdMutex::new(None),
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }
}

// ─── Session task ───

async fn run_csa_session_task(
    config: CsaConfig,
    engine_path: PathBuf,
    app: AppHandle,
    engine_lock: Arc<EngineLock>,
    engine_state: Arc<EngineState>,
    shutdown: Arc<AtomicBool>,
) {
    let target = match config.engine.engine_type {
        CsaEngineType::External => EngineTarget::External {
            registration_id: config.engine.registration_id.clone().unwrap_or_default(),
        },
        CsaEngineType::Builtin => EngineTarget::Builtin,
    };
    let lock_guard = match engine_lock.acquire(target) {
        Ok(guard) => guard,
        Err(message) => {
            let _ = app.emit(
                CSA_SESSION_EVENT,
                &CsaSessionEvent::Error {
                    kind: "engine_lock",
                    message,
                },
            );
            return;
        }
    };

    let (tx, mut rx) = mpsc::unbounded_channel::<CsaSessionEvent>();

    let app_clone = app.clone();
    let relay_handle = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = app_clone.emit(CSA_SESSION_EVENT, &event);
        }
    });

    let sink = TauriEventSink::new(tx.clone());
    let result = run_csa_session(
        config,
        engine_path,
        engine_state,
        Arc::clone(&shutdown),
        sink,
    )
    .await;

    if let Err(err) = result {
        let _ = tx.send(CsaSessionEvent::Error {
            kind: "session",
            message: err.to_string(),
        });
    }

    drop(tx);
    let _ = relay_handle.await;
    drop(lock_guard);
}

// ─── Tauri commands ───

#[tauri::command]
pub async fn csa_start(
    config: CsaConfig,
    app: AppHandle,
    manager: State<'_, Arc<CsaGameManager>>,
    engine_lock: State<'_, Arc<EngineLock>>,
    engine_state: State<'_, Arc<EngineState>>,
) -> Result<(), String> {
    // 入力バリデーション
    if config.server.host.trim().is_empty() {
        return Err("ホスト名が空です".to_string());
    }
    if config.server.port == 0 {
        return Err("ポート番号が不正です（1-65535）".to_string());
    }
    if config.server.user_id.trim().is_empty() {
        return Err("ユーザーIDが空です".to_string());
    }

    // engine_path: External は registration から解決、Builtin は使用しない sentinel
    let engine_path_buf = match config.engine.engine_type {
        CsaEngineType::External => {
            let registration_id = config
                .engine
                .registration_id
                .as_deref()
                .filter(|s| !s.is_empty())
                .ok_or_else(|| "外部エンジン未選択です".to_string())?;
            let engine_path = resolve_engine_path(&app, registration_id)?;
            PathBuf::from(engine_path)
        }
        CsaEngineType::Builtin => PathBuf::from("<builtin>"),
    };

    {
        let handle_guard = manager
            .session_handle
            .lock()
            .map_err(|e| format!("内部エラー: {e}"))?;
        if handle_guard.is_some() {
            return Err("CSA 対局セッションが既に実行中です".to_string());
        }
    }

    // Builtin engine は in-process Search を利用するため、UI 検索が active なら
    // 先に停止して JoinHandle を回収し、search instance を inner.search に戻す
    // (CSA Builtin が `inner.search.take()` できる状態にする)。External engine は
    // EngineState を触らないため不要。
    if config.engine.engine_type == CsaEngineType::Builtin {
        let active = {
            let mut inner = engine_state.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.stop_active_search()
        };
        if let Some(active) = active {
            let join_result = active.handle.join();
            let mut inner = engine_state.inner.lock().unwrap_or_else(|e| e.into_inner());
            inner.restore_search(join_result);
        }
    }

    // shutdown フラグを reset (前回 run の残留値を消す)
    manager.shutdown.store(false, Ordering::SeqCst);
    let shutdown = Arc::clone(&manager.shutdown);

    let engine_lock_clone = Arc::clone(&engine_lock);
    let engine_state_clone = Arc::clone(&engine_state);
    let manager_clone = Arc::clone(&manager);

    let handle = tokio::spawn(async move {
        run_csa_session_task(
            config,
            engine_path_buf,
            app,
            engine_lock_clone,
            engine_state_clone,
            shutdown,
        )
        .await;
        if let Ok(mut guard) = manager_clone.session_handle.lock() {
            *guard = None;
        }
    });

    {
        let mut handle_guard = manager
            .session_handle
            .lock()
            .map_err(|e| format!("内部エラー: {e}"))?;
        *handle_guard = Some(handle);
    }

    Ok(())
}

#[tauri::command]
pub async fn csa_stop(manager: State<'_, Arc<CsaGameManager>>) -> Result<(), String> {
    manager.shutdown.store(true, Ordering::SeqCst);
    Ok(())
}

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

#[tauri::command]
pub async fn csa_load_config(app: AppHandle) -> Result<Option<serde_json::Value>, String> {
    let store = app
        .store("csa-store.json")
        .map_err(|e| format!("ストア初期化エラー: {e}"))?;
    Ok(store.get("csa-config"))
}

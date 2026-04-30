//! CSA 対局マネージャと Tauri コマンド。
//!
//! - `csa_start`: 設定を受け取り CSA 対局セッションを開始する
//! - `csa_stop`: shutdown フラグを立て対局を中断する
//! - `csa_save_config` / `csa_load_config`: tauri-plugin-store への永続化
//!
//! セッション本体は [`crate::csa_session::run_external_session`] が `tokio::task::spawn_blocking`
//! 経由で `rshogi_csa_client` の同期 API を駆動する。`SessionEventSink` から流れる
//! `CsaSessionEvent` は mpsc を介して `csa://session` チャネルに emit される。

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex};

use tauri::{AppHandle, Emitter, State};
use tauri_plugin_store::StoreExt;
use tokio::sync::mpsc;

use crate::csa_engine::resolve_engine_path;
use crate::csa_session::run_external_session;
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
    shutdown: Arc<AtomicBool>,
) {
    let target = EngineTarget::External {
        registration_id: config.engine.registration_id.clone().unwrap_or_default(),
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
    let result = run_external_session(config, engine_path, Arc::clone(&shutdown), sink).await;

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

    if config.engine.engine_type == CsaEngineType::Builtin {
        return Err(
            "Builtin engine 経路は移行作業中のため一時的に利用できません。External engine を選択してください。"
                .to_string(),
        );
    }

    let registration_id = config
        .engine
        .registration_id
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "外部エンジン未選択です".to_string())?;
    let engine_path = resolve_engine_path(&app, registration_id)?;
    let engine_path_buf = PathBuf::from(engine_path);

    {
        let handle_guard = manager
            .session_handle
            .lock()
            .map_err(|e| format!("内部エラー: {e}"))?;
        if handle_guard.is_some() {
            return Err("CSA 対局セッションが既に実行中です".to_string());
        }
    }

    // shutdown フラグを reset (前回 run の残留値を消す)
    manager.shutdown.store(false, Ordering::SeqCst);
    let shutdown = Arc::clone(&manager.shutdown);

    let engine_lock_clone = Arc::clone(&engine_lock);
    let manager_clone = Arc::clone(&manager);

    let handle = tokio::spawn(async move {
        run_csa_session_task(config, engine_path_buf, app, engine_lock_clone, shutdown).await;
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

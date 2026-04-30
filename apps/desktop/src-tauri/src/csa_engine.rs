//! CSA 対局用エンジンの補助ロジック。
//!
//! 外部 USI エンジンの起動 / プロトコル制御は `rshogi_csa_client` 側に寄せて
//! いるため、本モジュールに残るのは UI 側の `registration_id` から実行
//! ファイルパスを解決する helper のみ。Builtin engine 経路は
//! [`crate::csa_builtin_engine`] が `UsiEngineDriver` 実装として担当する。
//!
//! `tauri-plugin-store` の `store.json` (key `engines`) に保存された
//! `EngineRegistration` 配列を引き、引数の id にマッチするエンジンの `path`
//! を返す。

use tauri::AppHandle;
use tauri_plugin_store::StoreExt;

use crate::usi_engine::EngineRegistration;

/// `registration_id` から外部 USI エンジンの実行ファイルパスを解決する。
pub fn resolve_engine_path(app: &AppHandle, registration_id: &str) -> Result<String, String> {
    let store = app
        .store("store.json")
        .map_err(|e| format!("store error: {e}"))?;
    let registrations: Vec<EngineRegistration> = store
        .get("engines")
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default();

    let registration = registrations
        .iter()
        .find(|r| r.id == registration_id)
        .ok_or_else(|| format!("engine registration not found: {registration_id}"))?;

    Ok(registration.path.clone())
}

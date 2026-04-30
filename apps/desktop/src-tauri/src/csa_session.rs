//! `rshogi_csa_client` を駆動して 1 つの CSA 対局セッションを実行する。
//!
//! `tokio::task::spawn_blocking` で sync な OSS API を呼ぶラッパー。
//! - `CsaConnection::connect` → `login` または `login_reconnect`
//! - `UsiEngine::spawn` (External) / `BuiltinEngineDriver::new` (Builtin)
//! - `run_game_session_with_events` / `run_resumed_session_with_events`
//!
//! shutdown 信号 ([`Arc<AtomicBool>`]) は `CsaGameManager` から受け取り、
//! `csa_stop` から立てられる。
//!
//! # Builtin / External 共通の ponder 設定伝搬
//!
//! Builtin / External どちらの engine_type でも `CsaConfig.engine.ponder` を
//! そのまま `CsaClientConfig.game.ponder` に伝搬する。Builtin engine は
//! `Search::ponderhit_handle()` (rshogi-core 2693dd45+) で取得した
//! `PonderhitHandle` 経由で真の ponder 探索を駆動する。詳細は
//! `csa_builtin_engine.rs` の module doc を参照。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::AtomicBool;
use std::time::Duration;

use rshogi_csa_client::config::{
    CsaClientConfig, EngineConfig as OssEngineConfig, GameConfig as OssGameConfig,
    KeepaliveConfig as OssKeepaliveConfig, RecordConfig as OssRecordConfig,
    ServerConfig as OssServerConfig, TimeConfig as OssTimeConfig,
};
use rshogi_csa_client::engine::{UsiEngine, UsiEngineDriver};
use rshogi_csa_client::events::SearchInfoEmitPolicy;
use rshogi_csa_client::protocol::CsaConnection;
use rshogi_csa_client::session::{run_game_session_with_events, run_resumed_session_with_events};

use crate::EngineState;
use crate::csa_builtin_engine::BuiltinEngineDriver;
use crate::csa_sink::TauriEventSink;
use crate::csa_types::{CsaConfig, CsaEngineType, CsaError};

/// CSA 対局を 1 局実行する。`engine_type` で External / Builtin を切り替える。
///
/// `tokio::task::spawn_blocking` で同期 OSS API を駆動する。Builtin engine は
/// `engine_state` 経由で in-process `Search` を共有する。
pub async fn run_csa_session(
    config: CsaConfig,
    engine_path: PathBuf,
    engine_state: Arc<EngineState>,
    shutdown: Arc<AtomicBool>,
    sink: TauriEventSink,
) -> Result<(), CsaError> {
    tokio::task::spawn_blocking(move || {
        run_csa_session_blocking(config, engine_path, engine_state, shutdown, sink)
    })
    .await
    .map_err(|e| CsaError::Session(format!("spawn_blocking join error: {e}")))?
}

fn run_csa_session_blocking(
    config: CsaConfig,
    engine_path: PathBuf,
    engine_state: Arc<EngineState>,
    shutdown: Arc<AtomicBool>,
    mut sink: TauriEventSink,
) -> Result<(), CsaError> {
    let oss_config = build_oss_config(&config, &engine_path)?;

    oss_config
        .validate()
        .map_err(|e| CsaError::ConfigInvalid(format!("CsaClientConfig 検証失敗: {e}")))?;

    // CSA サーバ接続
    let mut conn = CsaConnection::connect(
        &oss_config.server.host,
        oss_config.server.port,
        oss_config.server.keepalive.tcp,
    )
    .map_err(|e| CsaError::Session(format!("接続失敗: {e}")))?;

    // ログイン (新規 or resume)
    if let Some(reconnect) = config.reconnect.as_ref() {
        conn.login_reconnect(
            &oss_config.server.id,
            &oss_config.server.password,
            &reconnect.game_id,
            &reconnect.token,
        )
        .map_err(|e| CsaError::Session(format!("再接続ログイン失敗: {e}")))?;
    } else {
        conn.login(&oss_config.server.id, &oss_config.server.password)
            .map_err(|e| CsaError::Session(format!("ログイン失敗: {e}")))?;
    }

    // engine 構築 (Builtin / External で分岐、共通に Box<dyn UsiEngineDriver>)
    let mut engine: Box<dyn UsiEngineDriver> = match config.engine.engine_type {
        CsaEngineType::External => {
            let timeout = Duration::from_secs(oss_config.engine.startup_timeout_sec);
            let usi_engine = UsiEngine::spawn(
                &oss_config.engine.path,
                &oss_config.engine.options,
                oss_config.game.ponder,
                timeout,
            )
            .map_err(|e| CsaError::EngineError(format!("外部エンジン起動失敗: {e}")))?;
            Box::new(usi_engine)
        }
        CsaEngineType::Builtin => Box::new(BuiltinEngineDriver::new(Arc::clone(&engine_state))),
    };

    // 対局ループを駆動
    let outcome = if config.reconnect.is_some() {
        run_resumed_session_with_events(
            &oss_config,
            &mut conn,
            engine.as_mut(),
            shutdown,
            &mut sink,
        )
    } else {
        run_game_session_with_events(&oss_config, &mut conn, engine.as_mut(), shutdown, &mut sink)
    };

    match outcome {
        Ok(_outcome) => Ok(()),
        Err(err) => Err(CsaError::Session(err.to_string())),
    }
}

/// Tauri 側 `CsaConfig` を OSS の `CsaClientConfig` に変換する。
fn build_oss_config(config: &CsaConfig, engine_path: &Path) -> Result<CsaClientConfig, CsaError> {
    let server = OssServerConfig {
        host: config.server.host.clone(),
        port: config.server.port,
        id: config.server.user_id.clone(),
        password: config.server.password.clone(),
        floodgate: config.server.floodgate,
        keepalive: OssKeepaliveConfig {
            tcp: config.server.tcp_keepalive,
            ..OssKeepaliveConfig::default()
        },
        ws_origin: None,
    };

    let options =
        convert_engine_options(&config.engine.options).map_err(CsaError::ConfigInvalid)?;

    let engine = OssEngineConfig {
        path: engine_path.to_path_buf(),
        options,
        ..OssEngineConfig::default()
    };

    let time = OssTimeConfig {
        margin_msec: config.time.margin_ms,
    };

    // External / Builtin 共通: UI 設定の ponder 値をそのまま OSS session に伝搬する。
    // Builtin engine は USI_Ponder setoption を持たないが、OssGameConfig.ponder=true で
    // OSS session が go_ponder / ponderhit_with_info を呼び出し、Builtin driver 側で
    // 真の ponder 探索を駆動する (rshogi#583 / ramu-shogi#44)。
    let ponder = config.engine.ponder;

    let game = OssGameConfig {
        max_games: config.game.max_games,
        restart_engine_every_game: config.game.restart_engine_every_game,
        ponder,
        search_info_emit: SearchInfoEmitPolicy::default(),
    };

    let record = OssRecordConfig {
        enabled: false,
        ..OssRecordConfig::default()
    };

    Ok(CsaClientConfig {
        server,
        engine,
        time,
        game,
        record,
        ..CsaClientConfig::default()
    })
}

/// `serde_json::Value` の engine options を `toml::Value` に変換する (USI scalar 限定)。
pub(crate) fn convert_engine_options(
    src: &HashMap<String, serde_json::Value>,
) -> Result<HashMap<String, toml::Value>, String> {
    let mut result = HashMap::new();
    for (key, value) in src {
        let toml_value = match value {
            serde_json::Value::Bool(b) => toml::Value::Boolean(*b),
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() {
                    toml::Value::Integer(i)
                } else if let Some(u) = n.as_u64() {
                    if u <= i64::MAX as u64 {
                        toml::Value::Integer(u as i64)
                    } else {
                        return Err(format!(
                            "engine_options[{key}] integer out of i64 range: {u}"
                        ));
                    }
                } else if let Some(f) = n.as_f64() {
                    toml::Value::Float(f)
                } else {
                    return Err(format!("engine_options[{key}] is unsupported number"));
                }
            }
            serde_json::Value::String(s) => toml::Value::String(s.clone()),
            serde_json::Value::Null
            | serde_json::Value::Array(_)
            | serde_json::Value::Object(_) => {
                return Err(format!(
                    "engine_options[{key}] must be a USI scalar (string/int/float/bool), got {value:?}"
                ));
            }
        };
        result.insert(key.clone(), toml_value);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn convert_engine_options_accepts_scalars() {
        let mut src: HashMap<String, serde_json::Value> = HashMap::new();
        src.insert("USI_Hash".into(), serde_json::Value::Number(256.into()));
        src.insert("USI_Ponder".into(), serde_json::Value::Bool(true));
        src.insert(
            "EvalDir".into(),
            serde_json::Value::String("eval".to_string()),
        );
        src.insert(
            "Threshold".into(),
            serde_json::Value::Number(serde_json::Number::from_f64(0.25).unwrap()),
        );

        let dst = convert_engine_options(&src).unwrap();
        assert_eq!(dst.get("USI_Hash").unwrap(), &toml::Value::Integer(256));
        assert_eq!(dst.get("USI_Ponder").unwrap(), &toml::Value::Boolean(true));
        assert_eq!(
            dst.get("EvalDir").unwrap(),
            &toml::Value::String("eval".into())
        );
        assert_eq!(dst.get("Threshold").unwrap(), &toml::Value::Float(0.25));
    }

    #[test]
    fn convert_engine_options_rejects_array() {
        let mut src: HashMap<String, serde_json::Value> = HashMap::new();
        src.insert("Bad".into(), serde_json::json!([1, 2, 3]));
        assert!(convert_engine_options(&src).is_err());
    }

    #[test]
    fn convert_engine_options_rejects_null() {
        let mut src: HashMap<String, serde_json::Value> = HashMap::new();
        src.insert("Bad".into(), serde_json::Value::Null);
        assert!(convert_engine_options(&src).is_err());
    }

    #[test]
    fn convert_engine_options_handles_u64_within_i64() {
        let mut src: HashMap<String, serde_json::Value> = HashMap::new();
        let v: u64 = (i64::MAX as u64) - 1;
        src.insert(
            "Big".into(),
            serde_json::Value::Number(serde_json::Number::from(v)),
        );
        let dst = convert_engine_options(&src).unwrap();
        assert_eq!(
            dst.get("Big").unwrap(),
            &toml::Value::Integer((i64::MAX) - 1)
        );
    }

    fn make_csa_config(engine_type: CsaEngineType, ponder: bool) -> CsaConfig {
        use crate::csa_types::{
            CsaEngineConfig, CsaGameConfig, CsaRecordConfig, CsaServerConfig, CsaTimeConfig,
        };
        CsaConfig {
            server: CsaServerConfig {
                host: "127.0.0.1".into(),
                port: 4081,
                user_id: "tester".into(),
                password: "pw".into(),
                floodgate: false,
                tcp_keepalive: false,
            },
            engine: CsaEngineConfig {
                engine_type,
                registration_id: None,
                options: HashMap::new(),
                ponder,
                startup_timeout_sec: 30,
            },
            time: CsaTimeConfig { margin_ms: 0 },
            game: CsaGameConfig {
                max_games: 1,
                restart_engine_every_game: false,
            },
            record: CsaRecordConfig {
                save_dir: String::new(),
            },
            reconnect: None,
        }
    }

    /// External engine の場合は Tauri 側 `CsaConfig.engine.ponder` がそのまま
    /// `oss_config.game.ponder` に伝搬されることを verify する。
    #[test]
    fn build_oss_config_preserves_ponder_for_external_true() {
        let config = make_csa_config(CsaEngineType::External, /* ponder= */ true);
        let oss = build_oss_config(&config, Path::new("/tmp/engine")).unwrap();
        assert!(
            oss.game.ponder,
            "External engine では UI 設定の ponder=true がそのまま伝搬する"
        );
    }

    #[test]
    fn build_oss_config_preserves_ponder_for_external_false() {
        let config = make_csa_config(CsaEngineType::External, /* ponder= */ false);
        let oss = build_oss_config(&config, Path::new("/tmp/engine")).unwrap();
        assert!(
            !oss.game.ponder,
            "External engine では UI 設定の ponder=false もそのまま伝搬する"
        );
    }

    /// Builtin engine の場合も Tauri 側 `CsaConfig.engine.ponder` がそのまま
    /// `oss_config.game.ponder` に伝搬されることを verify する (rshogi#583 /
    /// ramu-shogi#44 で真の ponder 対応した結果、強制無効化が外れた)。
    #[test]
    fn build_oss_config_preserves_ponder_for_builtin_true() {
        let config = make_csa_config(CsaEngineType::Builtin, /* ponder= */ true);
        let oss = build_oss_config(&config, Path::new("<builtin>")).unwrap();
        assert!(
            oss.game.ponder,
            "Builtin engine でも UI 設定の ponder=true がそのまま伝搬する"
        );
    }

    #[test]
    fn build_oss_config_preserves_ponder_for_builtin_false() {
        let config = make_csa_config(CsaEngineType::Builtin, /* ponder= */ false);
        let oss = build_oss_config(&config, Path::new("<builtin>")).unwrap();
        assert!(
            !oss.game.ponder,
            "Builtin engine でも UI 設定の ponder=false がそのまま伝搬する"
        );
    }
}

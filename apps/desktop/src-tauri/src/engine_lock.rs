//! CSA対局中のエンジン排他制御
//!
//! CSA対局中は使用エンジンを専有し、通常のエンジン操作を排他する。
//! EngineLockGuard の RAII Drop により、パニック時もロックが自動解放される。
//!
//! ## TOCTOU に関する設計判断
//!
//! `check_engine_available()` によるロックチェックと後続のエンジン操作は
//! 原子的ではない（TOCTOU gap がある）。ただし以下の理由から実害はない:
//! - CSA ロック取得はユーザーの手動操作（「接続」ボタン）でのみ発生する
//! - エンジンコマンドも同様にユーザー操作起点であり、同時発生は想定外
//! - 仮に競合しても最悪ケースは「エンジン操作が失敗する」のみで、
//!   データ破損やクラッシュには至らない（EngineState 自体が Mutex で保護）

use std::sync::{Arc, Mutex, MutexGuard};

/// ロック対象のエンジン種別
#[allow(dead_code)] // CSA対局実装タスクで使用予定
#[derive(Clone, Debug)]
pub enum EngineTarget {
    Builtin,
    External { registration_id: String },
}

/// エンジン排他制御
pub struct EngineLock {
    locked: Mutex<Option<EngineTarget>>,
}

/// Mutex の poison を回復してガードを返す。
/// パニックしたスレッドが残した状態でも継続可能にする。
fn recover_lock(mutex: &Mutex<Option<EngineTarget>>) -> MutexGuard<'_, Option<EngineTarget>> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl EngineLock {
    pub fn new() -> Self {
        Self {
            locked: Mutex::new(None),
        }
    }

    /// ロックを取得し、RAII ガードを返す。既にロック中ならエラー。
    #[allow(dead_code)] // CSA対局実装タスクで使用予定
    pub fn acquire(self: &Arc<Self>, target: EngineTarget) -> Result<EngineLockGuard, String> {
        let mut guard = recover_lock(&self.locked);
        if guard.is_some() {
            return Err("CSA対局中のためエンジンは使用できません".to_string());
        }
        *guard = Some(target);
        Ok(EngineLockGuard {
            lock: Arc::clone(self),
        })
    }

    /// 現在ロックされているかどうか
    pub fn is_locked(&self) -> bool {
        recover_lock(&self.locked).is_some()
    }

    /// 現在のロック対象を返す（UIステータス表示用）
    #[allow(dead_code)] // CSA対局実装タスクで使用予定
    pub fn locked_target(&self) -> Option<EngineTarget> {
        recover_lock(&self.locked).clone()
    }
}

impl Default for EngineLock {
    fn default() -> Self {
        Self::new()
    }
}

/// RAII ガード — Drop 時に自動でロック解放
#[allow(dead_code)] // CSA対局実装タスクで使用予定
pub struct EngineLockGuard {
    lock: Arc<EngineLock>,
}

impl Drop for EngineLockGuard {
    fn drop(&mut self) {
        *recover_lock(&self.lock.locked) = None;
    }
}

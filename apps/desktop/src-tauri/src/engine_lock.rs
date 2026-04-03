//! CSA対局中のエンジン排他制御
//!
//! CSA対局中は使用エンジンを専有し、通常のエンジン操作を排他する。
//! EngineLockGuard の RAII Drop により、パニック時もロックが自動解放される。
#![allow(dead_code)] // acquire/EngineLockGuard は後続タスクで使用予定

use std::sync::{Arc, Mutex};

/// ロック対象のエンジン種別
#[derive(Clone, Debug)]
pub enum EngineTarget {
    Builtin,
    External { registration_id: String },
}

/// エンジン排他制御
pub struct EngineLock {
    locked: Mutex<Option<EngineTarget>>,
}

impl EngineLock {
    pub fn new() -> Self {
        Self {
            locked: Mutex::new(None),
        }
    }

    /// ロックを取得し、RAII ガードを返す。既にロック中ならエラー。
    pub fn acquire(self: &Arc<Self>, target: EngineTarget) -> Result<EngineLockGuard, String> {
        let mut guard = self
            .locked
            .lock()
            .map_err(|e| format!("EngineLock mutex poisoned: {e}"))?;
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
        self.locked.lock().map(|g| g.is_some()).unwrap_or(false)
    }

    /// 現在のロック対象を返す（UIステータス表示用）
    pub fn locked_target(&self) -> Option<EngineTarget> {
        self.locked.lock().ok().and_then(|g| g.clone())
    }
}

impl Default for EngineLock {
    fn default() -> Self {
        Self::new()
    }
}

/// RAII ガード — Drop 時に自動でロック解放
pub struct EngineLockGuard {
    lock: Arc<EngineLock>,
}

impl Drop for EngineLockGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.lock.locked.lock() {
            *guard = None;
        }
    }
}

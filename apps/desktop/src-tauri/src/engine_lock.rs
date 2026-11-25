//! CSA対局中のエンジン排他制御
//!
//! CSA対局中は使用エンジンを専有し、通常のエンジン操作を排他する。
//! EngineLockGuard の RAII Drop により、パニック時もロックが自動解放される。

use std::sync::{Arc, Mutex, MutexGuard};

/// エンジン排他制御
pub struct EngineLock {
    locked: Mutex<bool>,
}

/// Mutex の poison を回復してガードを返す。
/// パニックしたスレッドが残した状態でも継続可能にする。
fn recover_lock(mutex: &Mutex<bool>) -> MutexGuard<'_, bool> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl EngineLock {
    pub fn new() -> Self {
        Self {
            locked: Mutex::new(false),
        }
    }

    /// ロックを取得し、RAII ガードを返す。既にロック中ならエラー。
    pub fn acquire(self: &Arc<Self>) -> Result<EngineLockGuard, String> {
        let mut guard = self.available()?;
        *guard = true;
        Ok(EngineLockGuard {
            lock: Arc::clone(self),
        })
    }

    pub(crate) fn available(&self) -> Result<MutexGuard<'_, bool>, String> {
        let guard = recover_lock(&self.locked);
        if *guard {
            return Err("CSA対局中のためエンジンは使用できません".to_string());
        }
        Ok(guard)
    }

    /// 現在ロックされているかどうか
    pub fn is_locked(&self) -> bool {
        *recover_lock(&self.locked)
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
        *recover_lock(&self.lock.locked) = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn acquire_and_release() {
        let lock = Arc::new(EngineLock::new());
        assert!(!lock.is_locked());
        let guard = lock.acquire().unwrap();
        assert!(lock.is_locked());
        drop(guard);
        assert!(!lock.is_locked());
    }

    #[test]
    fn double_acquire_fails() {
        let lock = Arc::new(EngineLock::new());
        let _guard = lock.acquire().unwrap();
        assert!(lock.acquire().is_err());
    }
}

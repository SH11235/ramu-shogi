use std::collections::HashMap;
use std::collections::hash_map::Entry;
use std::ptr;

// Web の NNUE インポート上限（app-core の NNUE_MAX_SIZE_BYTES）に合わせる。
const MAX_NNUE_SIZE: usize = 300 * 1024 * 1024;

#[derive(Default)]
pub(super) struct NnueBuffers {
    buffers: HashMap<usize, Vec<u8>>,
    allocated: usize,
}

impl NnueBuffers {
    pub(super) fn alloc(&mut self, len: usize) -> *mut u8 {
        if len == 0 || len > MAX_NNUE_SIZE - self.allocated {
            return ptr::null_mut();
        }

        let mut bytes = Vec::new();
        if self.buffers.try_reserve(1).is_err() || bytes.try_reserve_exact(len).is_err() {
            return ptr::null_mut();
        }

        bytes.resize(len, 0);
        let ptr = bytes.as_mut_ptr();
        self.buffers.insert(ptr as usize, bytes);
        self.allocated += len;
        ptr
    }

    pub(super) fn take(&mut self, ptr: *mut u8, len: usize) -> Result<Vec<u8>, &'static str> {
        let Entry::Occupied(entry) = self.buffers.entry(ptr as usize) else {
            return Err("Unknown or already consumed NNUE buffer");
        };
        if entry.get().len() != len {
            return Err("NNUE buffer size mismatch");
        }

        let bytes = entry.remove();
        self.allocated -= bytes.len();
        Ok(bytes)
    }

    pub(super) fn clear(&mut self) {
        self.buffers.clear();
        self.allocated = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allocation_is_zero_initialized_and_consumed_once() {
        let mut buffers = NnueBuffers::default();
        let ptr = buffers.alloc(8);
        assert!(!ptr.is_null());
        assert_eq!(buffers.take(ptr, 8).unwrap(), [0; 8]);
        assert!(buffers.take(ptr, 8).is_err());
        assert_eq!(buffers.allocated, 0);
    }

    #[test]
    fn invalid_pointer_or_length_preserves_the_live_buffer() {
        let mut buffers = NnueBuffers::default();
        let ptr = buffers.alloc(8);
        assert!(buffers.take(ptr::null_mut(), 8).is_err());
        assert!(buffers.take(ptr.wrapping_add(1), 8).is_err());
        assert!(buffers.take(ptr, 0).is_err());
        assert!(buffers.take(ptr, 9).is_err());
        assert_eq!(buffers.take(ptr, 8).unwrap().len(), 8);
    }

    #[test]
    fn total_limit_accounts_for_multiple_live_buffers() {
        let mut buffers = NnueBuffers::default();
        assert!(buffers.alloc(0).is_null());
        assert!(buffers.alloc(MAX_NNUE_SIZE + 1).is_null());
        let first = buffers.alloc(8);
        let second = buffers.alloc(8);
        assert_ne!(first, second);
        assert_eq!(buffers.allocated, 16);
        assert!(buffers.alloc(MAX_NNUE_SIZE - 8).is_null());
        drop(buffers.take(first, 8).unwrap());
        assert_eq!(buffers.allocated, 8);
        assert_eq!(buffers.take(second, 8).unwrap().len(), 8);
    }

    #[test]
    fn clear_releases_all_live_buffers_and_resets_the_budget() {
        let mut buffers = NnueBuffers::default();
        let first = buffers.alloc(8);
        let second = buffers.alloc(16);
        buffers.clear();
        assert!(buffers.take(first, 8).is_err());
        assert!(buffers.take(second, 16).is_err());
        assert_eq!(buffers.allocated, 0);
        assert!(!buffers.alloc(8).is_null());
    }
}

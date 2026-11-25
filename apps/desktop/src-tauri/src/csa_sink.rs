//! `SessionEventSink` の Tauri 側実装。
//!
//! `rshogi_csa_client` の対局ループから発火される [`SessionProgress`] を
//! [`CsaSessionEvent`] に変換し、tokio mpsc 経由で UI 中継タスクに渡す。
//!
//! UI receiver (mpsc 受信側) が閉じた場合、即時 abort せず graceful shutdown
//! 経路へ流すために `should_continue` で `false` を返し、対局ループ側で
//! best-effort closure (CHUDAN → LOGOUT → close) を経由させる。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use rshogi_core::types::Value;
use rshogi_csa_client::events::{SessionError, SessionEventSink, SessionProgress, SinkError};
use tokio::sync::mpsc::UnboundedSender;

use crate::csa_types::{CsaSearchInfo, CsaSessionEvent};

/// `tx` が閉じた時の inner error。
#[derive(Debug, thiserror::Error)]
#[error("UI receiver closed")]
pub struct ReceiverClosed;

/// Tauri UI へ `CsaSessionEvent` を流す sink。
pub struct TauriEventSink {
    tx: UnboundedSender<CsaSessionEvent>,
    receiver_closed: Arc<AtomicBool>,
    builtin_engine: bool,
}

impl TauriEventSink {
    /// 新しい sink を作成する。
    pub fn new(tx: UnboundedSender<CsaSessionEvent>, builtin_engine: bool) -> Self {
        Self {
            tx,
            receiver_closed: Arc::new(AtomicBool::new(false)),
            builtin_engine,
        }
    }
}

fn show_builtin_mate(search: &mut CsaSearchInfo) {
    if let Some(plies) = search
        .score_cp
        .and_then(|score| crate::mate_score(Value::new(score)))
    {
        search.score_cp = None;
        search.score_mate = Some(plies);
    }
}

impl SessionEventSink for TauriEventSink {
    fn on_event(&mut self, event: SessionProgress) -> Result<(), SinkError> {
        let mut csa_event = CsaSessionEvent::from_session_progress(event);
        if self.builtin_engine {
            match &mut csa_event {
                CsaSessionEvent::SearchInfo { info }
                | CsaSessionEvent::Move {
                    search: Some(info), ..
                } => show_builtin_mate(info),
                _ => {}
            }
        }
        match self.tx.send(csa_event) {
            Ok(()) => Ok(()),
            Err(_) => {
                // UI receiver が閉じた場合、対局ループは即 abort せず graceful shutdown
                // 経路へ流す。NonFatal を返すと対局継続するため、receiver_closed フラグを
                // 立てて should_continue から false を返すことで CHUDAN → LOGOUT → close の
                // best-effort closure に到達させる。
                self.receiver_closed.store(true, Ordering::SeqCst);
                Err(SinkError::NonFatal(Box::new(ReceiverClosed)))
            }
        }
    }

    fn on_error(&mut self, error: &SessionError) -> Result<(), SinkError> {
        let _ = self.tx.send(CsaSessionEvent::from_session_error(error));
        Ok(())
    }

    fn should_continue(&self) -> bool {
        !self.receiver_closed.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc::unbounded_channel;

    #[test]
    fn forwards_event_to_channel() {
        let (tx, mut rx) = unbounded_channel();
        let mut sink = TauriEventSink::new(tx, false);
        sink.on_event(SessionProgress::Connected).unwrap();
        let event = rx.try_recv().expect("event should be queued");
        assert!(matches!(event, CsaSessionEvent::Connected));
    }

    #[test]
    fn marks_receiver_closed_on_send_error() {
        let (tx, rx) = unbounded_channel();
        drop(rx);
        let mut sink = TauriEventSink::new(tx, false);
        let result = sink.on_event(SessionProgress::Connected);
        assert!(matches!(result, Err(SinkError::NonFatal(_))));
        assert!(!sink.should_continue());
    }

    #[test]
    fn only_builtin_scores_are_decoded_to_mate() {
        use rshogi_csa_client::events::SearchInfoSnapshot;

        for (builtin, score_cp, expected_mate) in [
            (true, Value::mate_in(3).raw(), Some(3)),
            (true, Value::mated_in(2).raw(), Some(-2)),
            (true, Value::INFINITE.raw(), None),
            (true, 123, None),
            (false, Value::mate_in(3).raw(), None),
        ] {
            let (tx, mut rx) = unbounded_channel();
            let mut sink = TauriEventSink::new(tx, builtin);
            sink.on_event(SessionProgress::SearchInfo(SearchInfoSnapshot {
                score_cp: Some(score_cp),
                ..SearchInfoSnapshot::default()
            }))
            .unwrap();
            let CsaSessionEvent::SearchInfo { info } = rx.try_recv().unwrap() else {
                panic!("expected a search info event");
            };
            assert_eq!(info.score_mate, expected_mate);
            assert_eq!(info.score_cp, expected_mate.is_none().then_some(score_cp));
        }
    }
}

use std::collections::HashMap;

use rshogi_core::eval::{self, MaterialLevel};
use rshogi_core::nnue::{get_fv_scale_override, is_nnue_initialized, set_fv_scale_override};
use tauri::ipc::Channel;

use super::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Evaluator {
    material: Option<MaterialLevel>,
    fv_scale: i32,
}

impl Evaluator {
    fn current() -> Self {
        Self {
            material: eval::is_material_enabled().then(eval::get_material_level),
            fv_scale: get_fv_scale_override().unwrap_or(0),
        }
    }

    fn apply(self) {
        if let Some(level) = self.material {
            eval::set_material_level(level);
        } else {
            eval::disable_material();
        }
        set_fv_scale_override(self.fv_scale);
    }
}

struct BatchWorker {
    inner: EngineStateInner,
    evaluator: Evaluator,
    cached_evaluator: Option<Evaluator>,
    search_id: Option<String>,
}

impl BatchWorker {
    fn new(opts: Option<InitOptions>) -> Self {
        let mut options = EngineOptions {
            tt_size_mb: 16,
            ..EngineOptions::default()
        };
        if let Some(opts) = opts {
            options.update_from_init(&opts);
        }
        Self {
            inner: EngineStateInner::with_options(options, 0),
            evaluator: Evaluator {
                material: Some(eval::material::DEFAULT_MATERIAL_LEVEL),
                fv_scale: 0,
            },
            cached_evaluator: None,
            search_id: None,
        }
    }

    fn running(&self) -> bool {
        self.inner
            .active_search
            .as_ref()
            .is_some_and(|active| !active.evaluation_finished.load(Ordering::Acquire))
    }
}

#[derive(Default)]
pub(crate) struct BatchEngines {
    workers: HashMap<String, BatchWorker>,
    // ワーカーが走っている間は評価設定を切り替えられない。停止後は GUI/CSA で使っていた設定へ戻す。
    evaluator: Option<(Evaluator, Evaluator)>,
}

impl BatchEngines {
    fn restore_if_idle(&mut self) -> usize {
        let running = self
            .workers
            .values()
            .filter(|worker| worker.running())
            .count();
        if running == 0
            && let Some((_, previous)) = self.evaluator.take()
        {
            previous.apply();
        }
        running
    }

    pub(crate) fn require_idle(&mut self) -> Result<(), String> {
        if self.restore_if_idle() != 0 {
            return Err("一括解析中のため内蔵エンジンは使用できません".to_string());
        }
        Ok(())
    }

    fn worker(&mut self, id: &str) -> Result<&mut BatchWorker, String> {
        self.workers
            .get_mut(id)
            .ok_or_else(|| "Batch worker is unavailable".to_string())
    }

    pub(crate) fn worker_threads(&mut self, id: &str) -> Result<usize, String> {
        Ok(self.worker(id)?.inner.options.num_threads)
    }

    fn start(
        &mut self,
        worker_id: &str,
        search_id: String,
        params: &SearchParamsInput,
        emit: impl Fn(EngineEvent) + Send + 'static,
    ) -> Result<(), String> {
        let worker = self.worker(worker_id)?;
        if worker.running() {
            return Err("Batch worker is already searching".to_string());
        }
        worker.inner.stop_and_reclaim();
        validate_search_position(&worker.inner.position)?;
        let evaluator = worker.evaluator;
        let running = self.restore_if_idle();
        if running >= available_logical_cpus() {
            return Err("一括解析の同時実行数が上限に達しました".to_string());
        }
        if let Some((current, _)) = self.evaluator {
            if current != evaluator {
                return Err("異なる評価設定で一括解析を実行中です".to_string());
            }
        } else {
            let previous = Evaluator::current();
            evaluator.apply();
            self.evaluator = Some((evaluator, previous));
        }

        let worker = self.worker(worker_id)?;
        let position = worker.inner.position.clone();
        if worker
            .cached_evaluator
            .is_some_and(|cached| cached != evaluator)
        {
            worker.inner.clear_search_cache();
        }
        worker.cached_evaluator = Some(evaluator);
        let search = worker
            .inner
            .search
            .take()
            .unwrap_or_else(|| worker.inner.create_search());
        let limits = build_limits(params, &worker.inner.options);
        let result = spawn_search(search, position, limits, emit);
        match result {
            Ok(active) => {
                worker.inner.active_search = Some(active);
                worker.search_id = Some(search_id);
                Ok(())
            }
            Err(error) => {
                self.restore_if_idle();
                Err(error)
            }
        }
    }

    fn stop(&mut self, worker_id: &str, search_id: Option<&str>) {
        if let Some(worker) = self.workers.get_mut(worker_id)
            && (search_id.is_none() || search_id == worker.search_id.as_deref())
        {
            worker.inner.stop_and_reclaim();
            worker.search_id = None;
        }
        self.restore_if_idle();
    }

    pub(crate) fn dispose(&mut self) {
        for worker in self.workers.values_mut() {
            if let Some(active) = &worker.inner.active_search {
                active.stop_flag.store(true, Ordering::SeqCst);
            }
        }
        for (_, mut worker) in self.workers.drain() {
            if let Some(active) = worker.inner.stop_active_search() {
                let _ = active.handle.join();
            }
        }
        self.restore_if_idle();
    }
}

fn require_main_idle(state: &EngineState) -> Result<(), String> {
    let mut main = lock_engine(&state.inner)?;
    main.reclaim_finished();
    if let Some(active) = main.active_search.as_ref()
        && !active.evaluation_finished.load(Ordering::Acquire)
    {
        return Err("内蔵エンジンで別の探索を実行中です".to_string());
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn engine_batch_init(
    worker_id: String,
    opts: Option<InitOptions>,
    lock: State<'_, Arc<engine_lock::EngineLock>>,
    state: State<'_, Arc<EngineState>>,
) -> Result<(), String> {
    let _admission = lock.available()?;
    let mut batch = lock_engine(&state.batch)?;
    if batch.workers.contains_key(&worker_id) {
        return Err("Batch worker is already initialized".to_string());
    }
    batch.workers.insert(worker_id, BatchWorker::new(opts));
    Ok(())
}

#[tauri::command]
pub(crate) fn engine_batch_position(
    worker_id: String,
    sfen: String,
    moves: Option<Vec<String>>,
    pass_rights: Option<PassRightsInput>,
    state: State<'_, Arc<EngineState>>,
) -> Result<(), String> {
    let position = parse_position(&sfen, moves, pass_rights)?;
    lock_engine(&state.batch)?
        .worker(&worker_id)?
        .inner
        .position = position;
    Ok(())
}

#[tauri::command]
pub(crate) fn engine_batch_option(
    worker_id: String,
    name: String,
    value: serde_json::Value,
    state: State<'_, Arc<EngineState>>,
) -> Result<(), String> {
    let mut batch = lock_engine(&state.batch)?;
    let worker = batch.worker(&worker_id)?;
    match name.as_str() {
        "MaterialLevel" => worker.evaluator.material = Some(parse_material_level(&value)?),
        "FV_SCALE" => worker.evaluator.fv_scale = parse_fv_scale(&value)?,
        _ => {
            worker.inner.stop_and_reclaim();
            apply_engine_option(&mut worker.inner, &name, &value)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn engine_batch_load_nnue(
    worker_id: String,
    app: AppHandle,
    args: EngineLoadNnueArgs,
    lock: State<'_, Arc<engine_lock::EngineLock>>,
    state: State<'_, Arc<EngineState>>,
) -> Result<(), String> {
    let _admission = lock.available()?;
    let mut batch = lock_engine(&state.batch)?;
    if !is_nnue_initialized() {
        batch.require_idle()?;
        require_main_idle(&state)?;
    }
    batch.worker(&worker_id)?;
    load_nnue_model(&app, &mut lock_engine(&state.inner)?.loaded_nnue, &args)?;
    batch.worker(&worker_id)?.evaluator.material = None;
    Ok(())
}

#[tauri::command]
pub(crate) fn engine_batch_search(
    worker_id: String,
    search_id: String,
    params: SearchParamsInput,
    events: Channel<EngineEvent>,
    lock: State<'_, Arc<engine_lock::EngineLock>>,
    state: State<'_, Arc<EngineState>>,
) -> Result<(), String> {
    let _admission = lock.available()?;
    require_main_idle(&state)?;

    lock_engine(&state.batch)?.start(&worker_id, search_id, &params, move |event| {
        if let Err(error) = events.send(event) {
            log::debug!("Could not send batch search event: {error}");
        }
    })
}

#[tauri::command]
pub(crate) fn engine_batch_stop(
    worker_id: String,
    search_id: Option<String>,
    state: State<'_, Arc<EngineState>>,
) -> Result<(), String> {
    lock_engine(&state.batch)?.stop(&worker_id, search_id.as_deref());
    Ok(())
}

#[tauri::command]
pub(crate) fn engine_batch_dispose(
    worker_id: String,
    state: State<'_, Arc<EngineState>>,
) -> Result<(), String> {
    let mut batch = lock_engine(&state.batch)?;
    if let Some(mut worker) = batch.workers.remove(&worker_id)
        && let Some(active) = worker.inner.stop_active_search()
    {
        let _ = active.handle.join();
    }
    batch.restore_if_idle();
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;
    use std::sync::mpsc;
    use std::time::Duration;

    use rshogi_core::movegen::generate_legal_with_pass;

    use super::*;

    #[test]
    fn concurrent_workers_keep_positions_and_ignore_stale_stops() {
        let previous = Evaluator::current();
        let mut batch = BatchEngines::default();
        for (id, moves) in [("black", vec![]), ("white", vec!["7g7f".to_string()])] {
            let mut worker = BatchWorker::new(None);
            worker.inner.position = parse_position("startpos", Some(moves), None).unwrap();
            batch.workers.insert(id.to_string(), worker);
        }
        let params = SearchParamsInput {
            limits: Some(SearchLimitsInput {
                max_depth: Some(1),
                nodes: None,
                btime_ms: None,
                wtime_ms: None,
                byoyomi_ms: None,
                binc_ms: None,
                winc_ms: None,
                movetime_ms: None,
            }),
            ponder: None,
        };
        let (black_tx, black_rx) = mpsc::channel();
        let (white_tx, white_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let wait = Duration::from_secs(10);
        let held = Cell::new(false);
        batch
            .start("black", "black-job".into(), &params, move |event| {
                let info = matches!(event, EngineEvent::Info { .. });
                black_tx.send(event).unwrap();
                if info && !held.replace(true) {
                    let _ = release_rx.recv_timeout(wait * 2);
                }
            })
            .unwrap();
        assert!(matches!(
            black_rx.recv_timeout(wait),
            Ok(EngineEvent::Info { .. })
        ));
        assert!(batch.require_idle().is_err());

        let live_flag = Arc::clone(
            &batch
                .worker("black")
                .unwrap()
                .inner
                .active_search
                .as_ref()
                .unwrap()
                .stop_flag,
        );
        batch.stop("black", Some("previous-job"));
        assert!(!live_flag.load(Ordering::SeqCst));

        let concurrent = available_logical_cpus() >= 2;
        if concurrent {
            let worker = batch.worker("white").unwrap();
            let evaluator = worker.evaluator;
            worker.evaluator.fv_scale = 10;
            assert!(
                batch
                    .start("white", "incompatible".into(), &params, |_| {})
                    .is_err()
            );
            batch.worker("white").unwrap().evaluator = evaluator;
            batch
                .start("white", "white-job".into(), &params, move |event| {
                    white_tx.send(event).unwrap();
                })
                .unwrap();
            assert_legal_result(&white_rx, &batch.worker("white").unwrap().inner.position);
        }
        release_tx.send(()).unwrap();
        assert_legal_result(&black_rx, &batch.worker("black").unwrap().inner.position);
        batch.require_idle().unwrap();
        assert_eq!(Evaluator::current(), previous);
        batch.dispose();
    }

    fn assert_legal_result(events: &mpsc::Receiver<EngineEvent>, position: &Position) {
        while let Ok(event) = events.recv_timeout(Duration::from_secs(10)) {
            match event {
                EngineEvent::Info { .. } => {}
                EngineEvent::BestMove { mv, .. } => {
                    let mut legal = MoveList::new();
                    generate_legal_with_pass(position, &mut legal);
                    assert!(legal.iter().any(|candidate| candidate.to_usi() == mv));
                    return;
                }
                EngineEvent::Error { message } => panic!("{message}"),
            }
        }
        panic!(
            "Search did not produce a bestmove for {}",
            position.to_sfen()
        );
    }
}

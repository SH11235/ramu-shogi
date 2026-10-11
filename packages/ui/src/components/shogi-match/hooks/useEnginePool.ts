import {
    createStudyAnalysisCollector,
    type Player,
    type StudyAnalysisCollector,
    type StudyAnalysisCompletion,
    type StudyLayerRef,
} from "@shogi/app-core";
import type {
    EngineClient,
    EngineInfoEvent,
    LayerStacksOptions,
    SearchHandle,
} from "@shogi/engine-client";
import { useEffect, useEffectEvent, useRef, useState } from "react";

/**
 * 解析ジョブ
 */
export interface AnalysisJob {
    ply: number;
    sfen: string;
    moves: string[];
    timeMs: number;
    depth: number;
    /** 分岐解析用のノードID（オプション） */
    nodeId?: string;
    /**
     * 解析する局面（moves を適用した後）の実際の手番。
     * 指定すると、探索が終わったときに `onPositionAnalyzed` で先手視点の解析結果を通知する。
     */
    sideToMove?: Player;
}

/**
 * 一括解析の進捗情報
 */
interface BatchAnalysisProgress {
    completed: number;
    total: number;
    inProgress: number[]; // 解析中の手番号
}

/**
 * エンジンプールの設定
 */
interface UseEnginePoolOptions {
    /** エンジンクライアントを生成するファクトリ関数 */
    createClient: () => EngineClient;
    /** エンジン切り替え検知用のキー */
    clientKey?: string;
    /** ワーカー数 */
    workerCount: number;
    /** 進捗更新時のコールバック */
    onProgress?: (progress: BatchAnalysisProgress) => void;
    /** 解析結果のコールバック */
    onResult?: (ply: number, event: EngineInfoEvent, nodeId?: string) => void;
    /** 全ジョブ完了時のコールバック */
    onComplete?: () => void;
    /** エラー時のコールバック */
    onError?: (ply: number, error: Error) => void;
    /**
     * 1 局面の探索が終わるごとに 1 回だけ呼ばれる（途中経過ごとには呼ばれない）。
     * `sideToMove` を指定したジョブだけが対象。研究ノートの保存層につなぐのに使う。
     * キャンセルで止まった探索は、そこまでの結果を `completion: "aborted"` で通知する。
     */
    onPositionAnalyzed?: (completion: StudyAnalysisCompletion) => void;
    /** 使用する NNUE の ID（null = NNUEなし（Material評価）） */
    nnueId?: string | null;
}

/**
 * start関数のオプション
 */
interface StartOptions {
    layerStacks?: LayerStacksOptions;
    /** 使用するNNUE ID（指定するとoptions.nnueIdを上書き） */
    nnueId?: string | null;
    /** FV_SCALE 値 */
    fvScale?: number;
    /** 候補手数（MultiPV）。省略時は 1 */
    multiPv?: number;
    /**
     * 解析を始めた時点のレイヤー。この start で積んだジョブの終了通知にそのまま載る
     * （途中で設定を変えて start し直しても、前のジョブの結果には混ざらない）。
     */
    layer?: StudyLayerRef;
}

/**
 * エンジンプールのハンドル
 */
export interface EnginePoolHandle {
    /** 実行中かどうか */
    isRunning: boolean;
    /** 現在の進捗 */
    progress: BatchAnalysisProgress | null;
    /** 一括解析を開始する */
    start: (jobs: AnalysisJob[], options?: StartOptions) => void;
    /** 一括解析をキャンセルする */
    cancel: () => Promise<void>;
    /** プールを破棄する */
    dispose: () => Promise<void>;
}

/** キューに積んだジョブ。start の時点のレイヤーを一緒に持つ。 */
interface QueuedJob extends AnalysisJob {
    layer: StudyLayerRef | null;
}

/** 進行中の 1 局面の探索。結果をまとめ、終わったら 1 回だけ通知する。 */
interface ActiveRun {
    job: QueuedJob;
    collector: StudyAnalysisCollector;
}

interface EngineWorker {
    client: EngineClient;
    handle: SearchHandle | null;
    currentPly: number | null;
    subscription: (() => void) | null;
    run: ActiveRun | null;
}

/**
 * エンジンプールを管理するフック
 * 複数のエンジンインスタンスを並列で使用して一括解析を行う
 */
export function useEnginePool(options: UseEnginePoolOptions): EnginePoolHandle {
    const {
        createClient,
        clientKey,
        workerCount,
        onProgress,
        onResult,
        onComplete,
        onError,
        onPositionAnalyzed,
        nnueId,
    } = options;

    const [isRunning, setIsRunning] = useState(false);
    const [progress, setProgress] = useState<BatchAnalysisProgress | null>(null);

    // マウント状態を追跡（Strict Mode対応）
    const mountedRef = useRef(true);

    // 内部状態をrefで管理（レンダリングに依存しない）
    const stateRef = useRef<{
        workers: EngineWorker[];
        jobQueue: QueuedJob[];
        /** start()で渡されたMultiPV */
        multiPv: number;
        completed: number;
        total: number;
        inProgress: Set<number>;
        cancelled: boolean;
        initialized: boolean;
        /** start()で渡されたnnueId（options.nnueIdを上書き） */
        overrideNnueId: string | null | undefined;
        /** 初期化済みワーカーが使用しているNNUE ID（null=Material） */
        currentNnueId: string | null | undefined;
        /** start()で渡されたfvScale */
        overrideLayerStacks?: LayerStacksOptions;
        currentLayerStacks?: LayerStacksOptions;
        overrideFvScale: number | undefined;
        /** 初期化済みワーカーが使用しているFV_SCALE */
        currentFvScale: number | undefined;
        /** 初期化済みワーカーが使用しているエンジンキー */
        currentClientKey: string | undefined;
        currentWorkerCount?: number;
    }>({
        workers: [],
        jobQueue: [],
        multiPv: 1,
        completed: 0,
        total: 0,
        inProgress: new Set(),
        cancelled: false,
        initialized: false,
        overrideNnueId: undefined,
        currentNnueId: undefined,
        overrideFvScale: undefined,
        currentFvScale: undefined,
        currentClientKey: undefined,
    });

    // コールバックをrefで保持（依存配列の問題を回避）
    const callbacksRef = useRef({
        onProgress,
        onResult,
        onComplete,
        onError,
        onPositionAnalyzed,
    });
    useEffect(() => {
        callbacksRef.current = { onProgress, onResult, onComplete, onError, onPositionAnalyzed };
    }, [onProgress, onResult, onComplete, onError, onPositionAnalyzed]);

    // 進行中の探索の結果をまとめて通知する（1 回の探索につき 1 回だけ）
    const finishRun = (worker: EngineWorker, completion: "completed" | "aborted") => {
        const run = worker.run;
        worker.run = null;
        if (!run) return;
        const result = run.collector.finish(completion);
        if (!result) return;
        callbacksRef.current.onPositionAnalyzed?.({
            runtimeNodeId: run.job.nodeId ?? null,
            ply: run.job.ply,
            layer: run.job.layer,
            result,
        });
    };

    // 進捗を更新する
    const updateProgress = () => {
        const state = stateRef.current;
        const newProgress: BatchAnalysisProgress = {
            completed: state.completed,
            total: state.total,
            inProgress: Array.from(state.inProgress),
        };
        setProgress(newProgress);
        callbacksRef.current.onProgress?.(newProgress);
    };

    // 次のジョブを取得して実行する
    // Note: JavaScriptはシングルスレッドのため、複数ワーカーが同時にこの関数を呼び出しても
    // jobQueue.shift() は安全にアトミックに実行される
    const processNextJob = async (worker: EngineWorker) => {
        const state = stateRef.current;

        // キャンセルされた場合は処理しない
        if (state.cancelled) {
            return;
        }

        // キューからジョブを取得（シングルスレッドのため競合なし）
        const job = state.jobQueue.shift();
        if (!job) {
            // ジョブがない場合、全ワーカーがアイドルかチェック
            const allIdle = state.workers.every((w) => w.currentPly === null);
            if (allIdle && state.completed === state.total) {
                setIsRunning(false);
                callbacksRef.current.onComplete?.();
            }
            return;
        }

        // ジョブを実行
        worker.currentPly = job.ply;
        state.inProgress.add(job.ply);
        updateProgress();

        try {
            // 局面を読み込み
            await worker.client.loadPosition(job.sfen, job.moves);

            // 既存のサブスクリプションを解除
            if (worker.subscription) {
                worker.subscription();
                worker.subscription = null;
            }

            // この局面の探索の結果をまとめる（手番が分かるジョブだけ）
            const run: ActiveRun | null = job.sideToMove
                ? {
                      job,
                      collector: createStudyAnalysisCollector({
                          runId: crypto.randomUUID(),
                          sideToMove: job.sideToMove,
                          execution: { threads: 1, parallelWorkers: state.workers.length },
                      }),
                  }
                : null;
            worker.run = run;

            // イベントを購読
            worker.subscription = worker.client.subscribe((event) => {
                if (state.cancelled) return;

                if (event.type === "info") {
                    if (run && worker.run === run) run.collector.push(event);
                    // 評価値が含まれている場合のみコールバック
                    if (event.scoreCp !== undefined || event.scoreMate !== undefined) {
                        callbacksRef.current.onResult?.(job.ply, event, job.nodeId);
                    }
                }

                if (event.type === "bestmove") {
                    // 解析完了
                    if (run && worker.run === run) {
                        // bestmove にだけ評価値が載るエンジンでも、最善候補を残す。
                        if (event.scoreCp !== undefined || event.scoreMate !== undefined) {
                            run.collector.push({
                                depth: event.depth,
                                scoreCp: event.scoreCp,
                                scoreMate: event.scoreMate,
                                pv: event.pv,
                            });
                        }
                        finishRun(worker, "completed");
                    }
                    worker.handle = null;
                    worker.currentPly = null;
                    state.inProgress.delete(job.ply);
                    state.completed++;
                    updateProgress();

                    // 次のジョブを処理
                    void processNextJob(worker);
                }

                if (event.type === "error") {
                    callbacksRef.current.onError?.(job.ply, new Error(event.message));
                    if (worker.run === run) worker.run = null;
                    worker.handle = null;
                    worker.currentPly = null;
                    state.inProgress.delete(job.ply);
                    state.completed++;
                    updateProgress();

                    // エラーでも次のジョブを処理
                    void processNextJob(worker);
                }
            });

            // 探索開始
            worker.handle = await worker.client.search({
                limits: {
                    movetimeMs: job.timeMs,
                    maxDepth: job.depth,
                },
                ponder: false,
            });
        } catch (error) {
            callbacksRef.current.onError?.(job.ply, error as Error);
            worker.run = null;
            worker.handle = null;
            worker.currentPly = null;
            state.inProgress.delete(job.ply);
            state.completed++;
            updateProgress();

            // エラーでも次のジョブを処理
            void processNextJob(worker);
        }
    };

    // ワーカーを初期化する
    const initializeWorkers = async () => {
        const state = stateRef.current;
        if (state.initialized) return;

        // start()で渡されたnnueIdを優先、なければoptions.nnueIdを使用
        const effectiveNnueId =
            (state.overrideNnueId !== undefined ? state.overrideNnueId : nnueId) ?? null;
        // start()で渡されたfvScaleを使用
        const effectiveFvScale = state.overrideFvScale;

        const workers: EngineWorker[] = [];
        for (let i = 0; i < workerCount; i++) {
            let client: EngineClient | undefined;
            try {
                client = createClient();
                // 一括解析は局面単位で並列化し、各エンジン内の並列化との積を避ける。
                await client.init({ threads: 1, usiThreads: 1 });

                // NNUE をロード（指定されている場合）
                if (effectiveNnueId && client.loadNnue) {
                    try {
                        await client.loadNnue(effectiveNnueId, state.overrideLayerStacks);
                        // FV_SCALE を設定（指定されている場合）
                        if (effectiveFvScale !== undefined) {
                            await client.setOption("FV_SCALE", effectiveFvScale);
                        }
                    } catch (error) {
                        console.warn(
                            `Failed to load NNUE for pool worker ${i} (${effectiveNnueId}):`,
                            error,
                        );
                        throw error;
                    }
                }

                workers.push({
                    client,
                    handle: null,
                    currentPly: null,
                    subscription: null,
                    run: null,
                });
            } catch (error) {
                await client?.dispose().catch(() => undefined);
                console.error(`Failed to initialize worker ${i}:`, error);
            }
        }

        // 初期化に成功したワーカーが1つもない場合はエラー
        if (workers.length === 0) {
            const error = new Error("No workers could be initialized");
            callbacksRef.current.onError?.(0, error);
            // アンマウント後は状態を更新しない
            if (mountedRef.current) {
                setIsRunning(false);
            }
            return;
        }

        // 要求された数より少ないワーカーしか初期化できなかった場合は警告
        if (workers.length < workerCount) {
            console.warn(
                `Only ${workers.length}/${workerCount} workers initialized. ` +
                    "Analysis will continue with fewer parallel workers.",
            );
        }

        state.workers = workers;
        state.initialized = true;
        state.currentNnueId = effectiveNnueId;
        state.currentFvScale = effectiveFvScale;
        state.currentLayerStacks = state.overrideLayerStacks;
        state.currentClientKey = clientKey;
        state.currentWorkerCount = workerCount;
    };

    // 一括解析を開始する
    const start = (jobs: AnalysisJob[], startOptions?: StartOptions) => {
        const state = stateRef.current;

        // 状態をリセット（レイヤーは start の時点のものをジョブごとに持たせる）
        const layer = startOptions?.layer ?? null;
        state.jobQueue = jobs.map((job) => ({ ...job, layer }));
        state.multiPv = Math.max(1, Math.trunc(startOptions?.multiPv ?? 1));
        state.completed = 0;
        state.total = jobs.length;
        state.inProgress.clear();
        state.cancelled = false;

        // start()で渡されたnnueIdとfvScaleを記録
        state.overrideNnueId = startOptions?.nnueId;
        state.overrideFvScale = startOptions?.fvScale;
        state.overrideLayerStacks = startOptions?.layerStacks;

        const nextNnueId =
            (state.overrideNnueId !== undefined ? state.overrideNnueId : nnueId) ?? null;
        const nextFvScale = state.overrideFvScale;
        const currentNnueId = state.currentNnueId ?? null;
        const currentFvScale = state.currentFvScale;
        const nextClientKey = clientKey;
        const currentClientKey = state.currentClientKey;

        // NNUEまたはFV_SCALEが変わった場合は再初期化
        const shouldReinitialize =
            state.initialized &&
            (nextNnueId !== currentNnueId ||
                nextFvScale !== currentFvScale ||
                JSON.stringify(state.overrideLayerStacks) !==
                    JSON.stringify(state.currentLayerStacks) ||
                nextClientKey !== currentClientKey ||
                workerCount !== state.currentWorkerCount);
        if (shouldReinitialize) {
            state.initialized = false;
        }

        setIsRunning(true);
        updateProgress();

        // 遅延初期化してジョブを開始
        void (async () => {
            // 再初期化が必要な場合は既存ワーカーを破棄
            if (shouldReinitialize) {
                const disposePromises = state.workers.map(async (worker) => {
                    try {
                        await worker.client.dispose();
                    } catch {
                        // 無視
                    }
                });
                await Promise.all(disposePromises);
                state.workers = [];
            }

            await initializeWorkers();

            // 候補手数（MultiPV）を毎回設定する（前回の一括解析の設定を残さない）
            const multiPv = state.multiPv;
            await Promise.all(
                state.workers.map(async (worker) => {
                    try {
                        await worker.client.setOption("MultiPV", String(multiPv));
                    } catch {
                        // MultiPV 非対応のエンジンは既定（1）のまま解析する
                    }
                }),
            );

            // 各ワーカーにジョブを割り当て
            for (const worker of state.workers) {
                if (!state.cancelled) {
                    void processNextJob(worker);
                }
            }
        })();
    };

    // 一括解析をキャンセルする
    const cancel = async () => {
        const state = stateRef.current;
        state.cancelled = true;
        state.jobQueue = [];

        // 全ワーカーを停止
        const stopPromises = state.workers.map(async (worker) => {
            // 途中で止めた探索も、そこまでの結果を「中断」として通知する（アンマウント後は捨てる）
            if (mountedRef.current) finishRun(worker, "aborted");
            else worker.run = null;
            if (worker.handle) {
                try {
                    await worker.handle.cancel();
                } catch {
                    // 無視
                }
                worker.handle = null;
            }
            if (worker.subscription) {
                worker.subscription();
                worker.subscription = null;
            }
            worker.currentPly = null;
        });

        await Promise.all(stopPromises);

        state.inProgress.clear();

        // アンマウント後は状態を更新しない
        if (mountedRef.current) {
            setIsRunning(false);
            setProgress(null);
        }
    };

    // プールを破棄する
    const dispose = async () => {
        await cancel();

        const state = stateRef.current;
        const disposePromises = state.workers.map(async (worker) => {
            try {
                await worker.client.dispose();
            } catch {
                // 無視
            }
        });

        await Promise.all(disposePromises);
        state.workers = [];
        state.initialized = false;
        state.currentNnueId = undefined;
        state.currentWorkerCount = undefined;
    };

    const disposeEvent = useEffectEvent(dispose);

    // nnueId が変更された時にプールを破棄（次回一括解析開始時に新しい NNUE でロード）
    const prevNnueIdRef = useRef(nnueId);
    useEffect(() => {
        if (prevNnueIdRef.current !== nnueId) {
            prevNnueIdRef.current = nnueId;
            void disposeEvent();
        }
    }, [nnueId]);

    // マウント時の初期化とアンマウント時のクリーンアップ
    // React 18 Strict Mode では2回実行されるため、mountedRef で状態を追跡
    useEffect(() => {
        mountedRef.current = true;

        return () => {
            mountedRef.current = false;
            // 非同期の dispose を実行（完了を待たない）
            // Strict Mode では2回目のマウント前にクリーンアップが実行される
            void disposeEvent();
        };
    }, []);

    return {
        isRunning,
        progress,
        start,
        cancel,
        dispose,
    };
}

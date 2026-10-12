import {
    createStudyAnalysisCollector,
    isStudyPassMove,
    type Player,
    type StudyAnalysisCollector,
    type StudyAnalysisCompletion,
    type StudyLayerRef,
    studyLineFitsPassLimit,
    studyPassRightsForLine,
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
    /**
     * エンジンが、パス権つきの局面（パスを含む手順）を読み込めるか（既定は true）。
     * 外部の USI エンジンは、変則ルールのパスを解釈できないので false にする。false のとき、
     * パスを含む手順のジョブは、エンジンに渡さずに失敗として数える（解釈できないまま渡すと、
     * 別の局面を探索した結果が、その局面の結果として残ってしまう）。
     */
    supportsPassRights?: boolean;
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
    /**
     * このワーカーへの操作（局面読込 → 探索の開始、探索の停止）を順番に行うための列。
     *
     * エンジンの停止は「その探索」ではなく「いま動いている探索」を止める（WASM は Worker を
     * 終了し、Tauri は `engine_stop` を送る）。前の実行の `search()` の応答が遅れて返り、その
     * 後始末（停止）が次の実行の探索を止めてしまわないよう、1 つのワーカーは、前の操作の後始末が
     * 済むまで次の操作を始めない。
     */
    chain: Promise<void>;
}

/** ワーカーへの操作を、そのワーカーの列の最後に積む。前の操作が失敗していても実行する。 */
function enqueueOnWorker(worker: EngineWorker, task: () => Promise<void>): Promise<void> {
    const next = worker.chain.then(task, task);
    worker.chain = next.catch(() => undefined);
    return next;
}

/** ワーカーの探索を止める操作を、そのワーカーの列に積む（次の探索の開始より前に済ませる）。 */
function enqueueStop(worker: EngineWorker, handle: SearchHandle): Promise<void> {
    return enqueueOnWorker(worker, async () => {
        try {
            await handle.cancel();
        } catch {
            // 無視
        }
    });
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
        supportsPassRights = true,
    } = options;
    const supportsPassRightsRef = useRef(supportsPassRights);
    useEffect(() => {
        supportsPassRightsRef.current = supportsPassRights;
    }, [supportsPassRights]);

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
        /**
         * 実行の世代。start() と cancel() のたびに進む。
         * 初期化・局面読込・探索開始・結果通知の各段階で、自分の世代がまだ現在のものかを確かめる
         * （中止した・次の解析が始まったあとに、古い実行の続きが動かないように）。
         */
        runId: number;
        /** ワーカーの初期化・作り直し・破棄を順番に行うための列（同時に走らせない）。 */
        initChain: Promise<void>;
        initialized: boolean;
        /** 初期化済みワーカーが使用しているNNUE ID（null=Material） */
        currentNnueId: string | null | undefined;
        currentLayerStacks?: LayerStacksOptions;
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
        runId: 0,
        initChain: Promise.resolve(),
        initialized: false,
        currentNnueId: undefined,
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

    // 次のジョブを取得して実行する。ワーカーごとの列に積み、前の操作（前の実行の探索の開始待ちと
    // その後始末を含む）が済んでから始める。
    const processNextJob = (worker: EngineWorker, runId: number): Promise<void> =>
        enqueueOnWorker(worker, () => startNextJob(worker, runId));

    // Note: JavaScriptはシングルスレッドのため、複数ワーカーが同時にこの関数を呼び出しても
    // jobQueue.shift() は安全にアトミックに実行される
    const startNextJob = async (worker: EngineWorker, runId: number) => {
        const state = stateRef.current;
        const isCurrent = () => state.runId === runId;

        // 中止された・次の実行が始まった場合は処理しない
        if (!isCurrent()) {
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
            // エンジンが読み込めない回数のパスを含む手順は、エンジンに渡さずに失敗として数える
            // （他の端末から届いたノートや、読み筋から足した変化に含まれうる）。
            if (!studyLineFitsPassLimit(job.sfen, job.moves)) {
                throw new Error("パスが多すぎる手順は解析できません");
            }
            if (!supportsPassRightsRef.current && job.moves.some((move) => isStudyPassMove(move))) {
                throw new Error("この解析エンジンは、パスを含む局面を解析できません");
            }
            // パスを含む手順は、パス権を有効にしないと読み込めない（回数の決め方は
            // `studyPassRightsForLine`。パスを含まなければ何も渡さない）。
            const passRights = studyPassRightsForLine(job.sfen, job.moves);
            await worker.client.loadPosition(
                job.sfen,
                job.moves,
                passRights ? { passRights } : undefined,
            );
            // 読み込みを待つ間に中止された・次の実行が始まったら、探索を始めない。
            // （進捗やワーカーの状態は、中止・次の実行の側が持っているので触らない）
            if (!isCurrent()) return;

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
            // この探索が（`search()` の応答より先に）終わったか。終わっていたら、遅れて届いた
            // ハンドルは、もう止める対象ではない。
            let finished = false;

            // イベントを購読
            const unsubscribe = worker.client.subscribe((event) => {
                // 古い実行のイベントは、結果にも進捗にも使わない
                if (!isCurrent()) return;

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
                    finished = true;
                    worker.handle = null;
                    worker.currentPly = null;
                    state.inProgress.delete(job.ply);
                    state.completed++;
                    updateProgress();

                    // 次のジョブを処理
                    void processNextJob(worker, runId);
                }

                if (event.type === "error") {
                    callbacksRef.current.onError?.(job.ply, new Error(event.message));
                    if (worker.run === run) worker.run = null;
                    finished = true;
                    worker.handle = null;
                    worker.currentPly = null;
                    state.inProgress.delete(job.ply);
                    state.completed++;
                    updateProgress();

                    // エラーでも次のジョブを処理
                    void processNextJob(worker, runId);
                }
            });
            worker.subscription = unsubscribe;

            // 探索開始
            const handle = await worker.client.search({
                limits: {
                    movetimeMs: job.timeMs,
                    maxDepth: job.depth,
                },
                ponder: false,
            });
            // 探索の開始を待つ間に中止されていたら、中止の時点ではハンドルが無く止められて
            // いないので、ここで止める。この停止は、このワーカーの列の中（次の実行の探索を
            // 始める前）で済ませる。
            if (!isCurrent()) {
                try {
                    await handle.cancel();
                } catch {
                    // 無視
                }
                if (worker.subscription === unsubscribe) {
                    unsubscribe();
                    worker.subscription = null;
                }
                return;
            }
            if (!finished) worker.handle = handle;
        } catch (error) {
            // 古い実行の失敗は、現在の実行の進捗に数えない
            if (!isCurrent()) return;
            callbacksRef.current.onError?.(job.ply, error as Error);
            worker.run = null;
            worker.handle = null;
            worker.currentPly = null;
            state.inProgress.delete(job.ply);
            state.completed++;
            updateProgress();

            // エラーでも次のジョブを処理
            void processNextJob(worker, runId);
        }
    };

    /** ワーカーの初期化に使う条件（start() の時点の値を、その実行の最後まで使う）。 */
    interface WorkerParams {
        nnueId: string | null;
        fvScale: number | undefined;
        layerStacks: LayerStacksOptions | undefined;
        clientKey: string | undefined;
        workerCount: number;
        createClient: () => EngineClient;
    }

    /** いまあるワーカーをすべて破棄する。 */
    const disposeWorkers = async () => {
        const state = stateRef.current;
        const workers = state.workers;
        state.workers = [];
        state.initialized = false;
        state.currentNnueId = undefined;
        state.currentWorkerCount = undefined;
        await Promise.all(
            workers.map(async (worker) => {
                try {
                    await worker.client.dispose();
                } catch {
                    // 無視
                }
            }),
        );
    };

    // ワーカーを初期化する（`initChain` の中で 1 つずつ実行する。同時には走らせない）
    const initializeWorkers = async (params: WorkerParams, runId: number) => {
        const state = stateRef.current;
        if (state.initialized) return;

        const workers: EngineWorker[] = [];
        for (let i = 0; i < params.workerCount; i++) {
            // 初期化の途中で中止された・次の実行が始まったら、残りは作らない
            // （ここまでに作ったワーカーは、次の実行が条件に合えばそのまま使う）。
            if (state.runId !== runId && workers.length > 0) break;
            let client: EngineClient | undefined;
            try {
                client = params.createClient();
                // 一括解析は局面単位で並列化し、各エンジン内の並列化との積を避ける。
                await client.init({ threads: 1, usiThreads: 1 });

                // NNUE をロード（指定されている場合）
                if (params.nnueId && client.loadNnue) {
                    try {
                        await client.loadNnue(params.nnueId, params.layerStacks);
                        // FV_SCALE を設定（指定されている場合）
                        if (params.fvScale !== undefined) {
                            await client.setOption("FV_SCALE", params.fvScale);
                        }
                    } catch (error) {
                        console.warn(
                            `Failed to load NNUE for pool worker ${i} (${params.nnueId}):`,
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
                    chain: Promise.resolve(),
                });
            } catch (error) {
                await client?.dispose().catch(() => undefined);
                console.error(`Failed to initialize worker ${i}:`, error);
            }
        }

        // 初期化に成功したワーカーが1つもない場合はエラー
        if (workers.length === 0) {
            if (state.runId === runId) {
                callbacksRef.current.onError?.(0, new Error("No workers could be initialized"));
                // アンマウント後は状態を更新しない
                if (mountedRef.current) {
                    setIsRunning(false);
                }
            }
            return;
        }

        // 要求された数より少ないワーカーしか初期化できなかった場合は警告
        if (workers.length < params.workerCount && state.runId === runId) {
            console.warn(
                `Only ${workers.length}/${params.workerCount} workers initialized. ` +
                    "Analysis will continue with fewer parallel workers.",
            );
        }

        state.workers = workers;
        state.initialized = true;
        state.currentNnueId = params.nnueId;
        state.currentFvScale = params.fvScale;
        state.currentLayerStacks = params.layerStacks;
        state.currentClientKey = params.clientKey;
        // 途中で打ち切った場合は、実際に作れた数を覚える（次の実行が足りなければ作り直す）。
        state.currentWorkerCount =
            workers.length < params.workerCount && state.runId !== runId
                ? workers.length
                : params.workerCount;
    };

    // 一括解析を開始する
    const start = (jobs: AnalysisJob[], startOptions?: StartOptions) => {
        const state = stateRef.current;

        // 新しい実行を始める。前の実行の続き（初期化・局面読込・探索・結果通知）は、世代が
        // 変わったことを見て自分で止まる。
        state.runId += 1;
        const runId = state.runId;
        const isCurrent = () => state.runId === runId;

        // 状態をリセット（レイヤーは start の時点のものをジョブごとに持たせる）
        const layer = startOptions?.layer ?? null;
        state.jobQueue = jobs.map((job) => ({ ...job, layer }));
        state.multiPv = Math.max(1, Math.trunc(startOptions?.multiPv ?? 1));
        state.completed = 0;
        state.total = jobs.length;
        state.inProgress.clear();
        // 前の実行が持っていたワーカーの状態を外す（前の実行は、もう触らない）
        for (const worker of state.workers) {
            if (worker.subscription) {
                worker.subscription();
                worker.subscription = null;
            }
            worker.run = null;
            worker.currentPly = null;
            // 前の実行の探索が残っていれば止める（この実行の探索を始める前に済ませる）
            const handle = worker.handle;
            worker.handle = null;
            if (handle) void enqueueStop(worker, handle);
        }

        // start()で渡されたnnueIdを優先、なければoptions.nnueIdを使用
        const params: WorkerParams = {
            nnueId: (startOptions?.nnueId !== undefined ? startOptions.nnueId : nnueId) ?? null,
            fvScale: startOptions?.fvScale,
            layerStacks: startOptions?.layerStacks,
            clientKey,
            workerCount,
            createClient,
        };
        const multiPv = state.multiPv;

        setIsRunning(true);
        updateProgress();

        // 遅延初期化してジョブを開始。初期化・作り直しは順番に行い、前の実行の初期化が
        // 終わってから、この実行の条件で確かめ直す。
        const prepare = async () => {
            if (!isCurrent()) return;
            // NNUE・FV_SCALE・エンジン・並列数が変わった場合は再初期化
            const shouldReinitialize =
                state.initialized &&
                (params.nnueId !== (state.currentNnueId ?? null) ||
                    params.fvScale !== state.currentFvScale ||
                    JSON.stringify(params.layerStacks) !==
                        JSON.stringify(state.currentLayerStacks) ||
                    params.clientKey !== state.currentClientKey ||
                    params.workerCount !== state.currentWorkerCount);
            if (shouldReinitialize) {
                await disposeWorkers();
            }

            await initializeWorkers(params, runId);
            if (!isCurrent()) return;

            // 候補手数（MultiPV）を毎回設定する（前回の一括解析の設定を残さない）
            await Promise.all(
                state.workers.map(async (worker) => {
                    try {
                        await worker.client.setOption("MultiPV", String(multiPv));
                    } catch {
                        // MultiPV 非対応のエンジンは既定（1）のまま解析する
                    }
                }),
            );
        };
        state.initChain = state.initChain.then(prepare, prepare);
        void state.initChain.then(() => {
            if (!isCurrent()) return;
            // 各ワーカーにジョブを割り当て
            for (const worker of state.workers) {
                void processNextJob(worker, runId);
            }
        });
    };

    // 一括解析をキャンセルする
    const cancel = async () => {
        const state = stateRef.current;
        // 世代を進める。待機中（初期化・局面読込・探索開始）の処理は、戻ってきたときに
        // 世代が変わっているのを見て止まる。
        state.runId += 1;
        state.jobQueue = [];

        // 全ワーカーを停止
        const stopPromises = state.workers.map(async (worker) => {
            // 途中で止めた探索も、そこまでの結果を「中断」として通知する（アンマウント後は捨てる）
            if (mountedRef.current) finishRun(worker, "aborted");
            else worker.run = null;
            const handle = worker.handle;
            worker.handle = null;
            if (worker.subscription) {
                worker.subscription();
                worker.subscription = null;
            }
            worker.currentPly = null;
            // 停止は、このワーカーの列に積む（直後に次の実行を始めても、その探索より前に済む）。
            if (handle) await enqueueStop(worker, handle);
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

        // 進行中の初期化が終わってから破棄する（初期化の途中で作られたワーカーを残さない）
        const state = stateRef.current;
        state.initChain = state.initChain.then(disposeWorkers, disposeWorkers);
        await state.initChain;
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

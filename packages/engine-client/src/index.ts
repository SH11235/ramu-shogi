export interface LayerStacksOptions {
    bucketMode: "kingrank9" | "progresskpabs" | "progresskpabsq16";
    progressBuckets?: number;
    /** Raw little-endian f64 progress coefficients, encoded as Base64. */
    progressCoeffBase64?: string;
}

type EngineBackend = "native" | "wasm" | "external-usi";

export type EngineStopMode = "terminate" | "cooperative";

// ============================================================
// Skill Level Settings
// ============================================================

/**
 * Skill Level 設定
 *
 * エンジンの強さを制御するための設定。
 * - skillLevel: 0-20 の整数（0=最弱、20=全力）
 */
export interface SkillLevelSettings {
    /** スキルレベル (0-20, 20=全力) */
    skillLevel: number;
}

/** Skill Level の有効範囲 */
export const SKILL_LEVEL_MIN = 0;
export const SKILL_LEVEL_MAX = 20;

/**
 * SkillLevelSettings のバリデーション結果
 */
interface SkillLevelValidationResult {
    valid: boolean;
    errors: string[];
}

/**
 * SkillLevelSettings をバリデーションする
 */
export function validateSkillLevelSettings(
    settings: SkillLevelSettings,
): SkillLevelValidationResult {
    const errors: string[] = [];

    if (settings.skillLevel < SKILL_LEVEL_MIN || settings.skillLevel > SKILL_LEVEL_MAX) {
        errors.push(
            `skillLevel must be between ${SKILL_LEVEL_MIN} and ${SKILL_LEVEL_MAX}, got ${settings.skillLevel}`,
        );
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * SkillLevelSettings の値をクランプして正規化する
 */
export function normalizeSkillLevelSettings(settings: SkillLevelSettings): SkillLevelSettings {
    const skillLevel = Math.max(SKILL_LEVEL_MIN, Math.min(SKILL_LEVEL_MAX, settings.skillLevel));
    return { skillLevel };
}

export interface EngineInitOptions {
    /** バックエンドの種類 (native/wasm/external-usi) */
    backend?: EngineBackend;
    /** 並列設定 (native / wasm の threaded build で使用) */
    threads?: number;
    /** 外部 USI の保存済み Threads を起動時に明示的に上書きする。一括解析用。 */
    usiThreads?: number;
    /** Worker 数 (将来の並列用) */
    workers?: number;
    /** 停止モード: terminate または cooperative */
    stopMode?: EngineStopMode;
    /** NNUE/モデルのパス/URI */
    nnuePath?: string;
    modelUri?: string;
    /** 定跡パス */
    bookPath?: string;
    /** トランスポジションテーブルサイズ (MB) */
    ttSizeMb?: number;
    /** マルチPVの出力本数 */
    multiPv?: number;
}

/**
 * loadPosition のオプション
 */
export interface LoadPositionOptions {
    /**
     * パス権の設定
     * - sente: 先手の初期パス権数
     * - gote: 後手の初期パス権数
     *
     * 設定すると USI コマンドに "passrights <sente> <gote>" が追加される
     */
    passRights?: { sente: number; gote: number };
}

export interface SearchLimits {
    /** 探索最大深さ */
    maxDepth?: number;
    /** ノード数上限 */
    nodes?: number;
    /** 先手の残り持ち時間 (ms) */
    btimeMs?: number;
    /** 後手の残り持ち時間 (ms) */
    wtimeMs?: number;
    /** 秒読み (ms) */
    byoyomiMs?: number;
    /** 先手の 1 手ごとの加算（フィッシャー、ms） */
    bincMs?: number;
    /** 後手の 1 手ごとの加算（フィッシャー、ms） */
    wincMs?: number;
    /** 固定消費時間 (ms) */
    movetimeMs?: number;
}

export interface SearchParams {
    /** 探索条件 */
    limits?: SearchLimits;
    /** 先読みモード */
    ponder?: boolean;
}

export interface EngineInfoEvent {
    type: "info";
    depth?: number;
    seldepth?: number;
    /** 評価値 (センチポーン) */
    scoreCp?: number;
    /** メイトスコア (手数) */
    scoreMate?: number;
    nodes?: number;
    nps?: number;
    timeMs?: number;
    multipv?: number;
    pv?: string[];
    hashfull?: number;
}

interface EngineBestMoveEvent {
    type: "bestmove";
    move: string;
    ponder?: string;
    pv?: string[];
    /** 評価値 (センチポーン) */
    scoreCp?: number;
    /** メイトスコア (手数) */
    scoreMate?: number;
    depth?: number;
}

type EngineErrorSeverity = "warning" | "error" | "fatal";

/**
 * Well-known error codes for type-safe error handling.
 *
 * - WASM_* : Wasm固有のエラー（初期化失敗、スレッド関連）
 * - General : 一般的なエラー（モデル読み込み、局面、探索）
 * - ENGINE_ERROR_STATE : エンジンがエラー状態のため操作が拒否されたことを示す
 *   （エラー原因ではなく、エラー状態にあることを通知するために使用）
 */
export type EngineErrorCode =
    // Wasm-specific errors (fatal/recoverable)
    | "WASM_INIT_FAILED" // 一般的な初期化失敗
    | "WASM_NETWORK_ERROR" // Wasmファイル取得失敗（ネットワーク）
    | "WASM_MEMORY_ERROR" // メモリ不足
    | "WASM_WORKER_SPAWN_ERROR" // Worker生成失敗
    | "WASM_INIT_TIMEOUT" // 初期化タイムアウト
    // Wasm-specific warnings
    | "WASM_THREADS_UNAVAILABLE"
    | "WASM_THREADS_CLAMPED"
    | "WASM_THREADS_INIT_FAILED"
    | "WASM_THREADS_DEFERRED"
    | "WASM_WORKER_FAILED"
    // General errors
    | "MODEL_LOAD_FAILED"
    | "POSITION_INVALID"
    | "SEARCH_FAILED"
    | "TIMEOUT"
    | "UNKNOWN"
    // Error state indicator (not a failure cause, but indicates engine is in error state)
    | "ENGINE_ERROR_STATE";

/**
 * エラーコードに対応するユーザー向け情報
 */
interface EngineErrorInfo {
    /** ユーザー向けメッセージ */
    userMessage: string;
    /** 考えられる原因 */
    possibleCauses: string[];
    /** 対処法 */
    solutions: string[];
    /** リトライ可能か */
    canRetry: boolean;
}

/**
 * エラーコードからユーザー向け情報を取得
 */
export function getEngineErrorInfo(code: EngineErrorCode | undefined): EngineErrorInfo {
    switch (code) {
        case "WASM_NETWORK_ERROR":
            return {
                userMessage: "エンジンの読み込みに失敗しました",
                possibleCauses: ["ネットワーク接続が不安定", "サーバーに一時的な問題が発生"],
                solutions: [
                    "ネットワーク接続を確認してください",
                    "しばらく待ってから再試行してください",
                ],
                canRetry: true,
            };
        case "WASM_MEMORY_ERROR":
            return {
                userMessage: "メモリ不足でエンジンを起動できません",
                possibleCauses: ["ブラウザのメモリ使用量が多い", "他のタブやアプリがメモリを消費"],
                solutions: [
                    "不要なタブを閉じてメモリを解放してください",
                    "ブラウザを再起動してください",
                ],
                canRetry: true,
            };
        case "WASM_WORKER_SPAWN_ERROR":
            return {
                userMessage: "エンジンの起動に失敗しました",
                possibleCauses: ["ブラウザのWorker生成制限に到達", "ブラウザの一時的な問題"],
                solutions: ["他のタブを閉じて再試行してください", "ブラウザを再起動してください"],
                canRetry: true,
            };
        case "WASM_INIT_TIMEOUT":
            return {
                userMessage: "エンジンの起動に時間がかかっています",
                possibleCauses: ["デバイスの処理能力が不足", "他のアプリがリソースを消費"],
                solutions: ["しばらく待ってから再試行してください", "他のアプリを終了してください"],
                canRetry: true,
            };
        case "WASM_INIT_FAILED":
            return {
                userMessage: "エンジンの初期化に失敗しました",
                possibleCauses: ["ブラウザがWebAssemblyに非対応", "一時的なエラー"],
                solutions: ["最新版のブラウザをお使いください", "ページを再読み込みしてください"],
                canRetry: true,
            };
        case "WASM_THREADS_UNAVAILABLE":
            return {
                userMessage: "マルチスレッド機能が利用できません",
                possibleCauses: [
                    "ブラウザがSharedArrayBufferに非対応",
                    "セキュリティヘッダーが設定されていない",
                ],
                solutions: ["シングルスレッドモードで動作します"],
                canRetry: false,
            };
        case "WASM_THREADS_INIT_FAILED":
            return {
                userMessage: "マルチスレッド初期化に失敗しました",
                possibleCauses: ["メモリ不足", "ブラウザの制限"],
                solutions: ["シングルスレッドモードで再試行します"],
                canRetry: false,
            };
        case "ENGINE_ERROR_STATE":
            return {
                userMessage: "エンジンがエラー状態です",
                possibleCauses: ["前回の操作でエラーが発生"],
                solutions: ["再試行ボタンを押してエンジンを再起動してください"],
                canRetry: true,
            };
        default:
            return {
                userMessage: "予期しないエラーが発生しました",
                possibleCauses: ["不明なエラー"],
                solutions: [
                    "ページを再読み込みしてください",
                    "問題が続く場合はブラウザを再起動してください",
                ],
                canRetry: true,
            };
    }
}

/** Backend status for error state management */
export type EngineBackendStatus = "ready" | "error" | "mock";

interface EngineErrorEvent {
    type: "error";
    message: string;
    severity?: EngineErrorSeverity;
    code?: EngineErrorCode;
}

export type EngineEvent = EngineInfoEvent | EngineBestMoveEvent | EngineErrorEvent;

export type EngineEventHandler = (event: EngineEvent) => void;

export interface SearchHandle {
    cancel(): Promise<void>;
}

/**
 * Thread information for debugging and monitoring parallel search.
 */
export interface ThreadInfo {
    /** Number of threads currently active (1 = single-threaded) */
    activeThreads: number;
    /** Maximum threads allowed (based on hardware and wasm limits) */
    maxThreads: number;
    /** Whether threaded execution is available (SharedArrayBuffer, crossOriginIsolated) */
    threadedAvailable: boolean;
    /** Hardware concurrency reported by navigator */
    hardwareConcurrency: number;
}

export interface EngineClient {
    /** 実行時能力を検査する解析専用 API。未対応バックエンドでは存在しない。 */
    analysis?: AnalysisClient;
    /** 詰み探索 (df-pn)。未対応バックエンドでは存在しない。 */
    mate?: MateClient;
    init(opts?: EngineInitOptions): Promise<void>;
    /**
     * 局面を読み込む
     * @param sfen SFEN文字列（"startpos" または完全なSFEN）
     * @param moves USI形式の指し手配列（"pass" を含むことが可能）
     * @param options 追加オプション（パス権設定など）
     */
    loadPosition(sfen: string, moves?: string[], options?: LoadPositionOptions): Promise<void>;
    search(params: SearchParams): Promise<SearchHandle>;
    stop(): Promise<void>;
    setOption(name: string, value: string | number | boolean): Promise<void>;
    subscribe(handler: EngineEventHandler): () => void;
    dispose(): Promise<void>;
    /**
     * Get thread information for debugging parallel search.
     * Optional - may not be implemented by all backends.
     */
    getThreadInfo?(): ThreadInfo;
    /**
     * Send a button-type USI option (no value).
     * Optional - only implemented by external USI backends.
     */
    sendButton?(name: string): Promise<void>;
    /**
     * Get the session ID for external USI engines.
     * Optional - only implemented by external USI backends.
     */
    getSessionId?(): string | null;
    /**
     * Reset the engine to allow retry after error.
     * - Clears error state and allows reinitialization
     * - Does NOT automatically call init() - caller must do so after reset
     * - Safe to call even when engine is not in error state (no-op)
     * - Terminates any existing worker and cancels pending operations
     * Optional - only implemented by wasm backend.
     */
    reset?(): Promise<void>;
    /**
     * Get current backend status.
     * Optional - only implemented by wasm backend.
     */
    getBackendStatus?(): EngineBackendStatus;
    /**
     * NNUE をロードする
     * @param nnueId NNUE の ID（各プラットフォームで解釈）
     * - Web: IndexedDB の ID
     * - Desktop: ファイルシステムの ID（パスに変換）
     * Optional - only implemented by wasm/tauri backends.
     */
    loadNnue?(nnueId: string, layerStacks?: LayerStacksOptions): Promise<void>;
}

/**
 * Simple in-memory mock that emits a single bestmove.
 * Useful for wiring UI before the real backends (Wasm/Tauri) are ready.
 */
export function createMockEngineClient(): EngineClient {
    const listeners = new Set<EngineEventHandler>();
    let activeHandle: { cancelled: boolean } | null = null;
    let activeTimeout: ReturnType<typeof setTimeout> | null = null;

    const emit = (event: EngineEvent) => {
        for (const listener of listeners) {
            listener(event);
        }
    };

    return {
        async init() {
            return;
        },
        async loadPosition(_sfen: string, _moves?: string[], _options?: LoadPositionOptions) {
            return;
        },
        async search(): Promise<SearchHandle> {
            if (activeHandle) {
                activeHandle.cancelled = true;
                if (activeTimeout) {
                    clearTimeout(activeTimeout);
                    activeTimeout = null;
                }
            }
            const handle = { cancelled: false };
            activeHandle = handle;

            // Emit a tiny info then a bestmove after a short delay.
            setTimeout(() => {
                if (handle.cancelled) return;
                emit({
                    type: "info",
                    depth: 1,
                    scoreCp: 0,
                    nodes: 128,
                    nps: 1024,
                    pv: [],
                });
            }, 10);

            activeTimeout = setTimeout(() => {
                if (handle.cancelled) return;
                emit({ type: "bestmove", move: "resign" });
                activeHandle = null;
                activeTimeout = null;
            }, 50);

            return {
                async cancel() {
                    handle.cancelled = true;
                    if (activeTimeout) {
                        clearTimeout(activeTimeout);
                        activeTimeout = null;
                    }
                    activeHandle = null;
                },
            };
        },
        async stop() {
            if (activeHandle) {
                activeHandle.cancelled = true;
                activeHandle = null;
                if (activeTimeout) {
                    clearTimeout(activeTimeout);
                    activeTimeout = null;
                }
            }
        },
        async setOption() {
            return;
        },
        subscribe(handler: EngineEventHandler) {
            listeners.add(handler);
            return () => listeners.delete(handler);
        },
        async dispose() {
            listeners.clear();
            if (activeHandle) {
                activeHandle.cancelled = true;
                activeHandle = null;
                if (activeTimeout) {
                    clearTimeout(activeTimeout);
                    activeTimeout = null;
                }
            }
        },
    };
}

/** 対話解析の今回の追加予算。 */
export type AnalysisBudget =
    | { type: "unlimited" }
    | { type: "time"; milliseconds: number }
    | { type: "nodes"; nodes: number };
export interface AnalysisFinished {
    sessionId: string;
    runId: number;
    reason: "paused" | "budgetReached" | "depthReached" | "terminal";
    resumable: boolean;
    completedDepth: number;
    nodes: number;
    timeMs: number;
    totalNodes: number;
    totalTimeMs: number;
    workerDepths: [number, number][];
}
export interface AnalysisRun {
    sessionId: string;
    runId: number;
    finished: Promise<AnalysisFinished>;
    /** 全 worker が停止してから返る。失敗時は再開状態を破棄する。 */
    pause(): Promise<AnalysisFinished>;
}
export interface AnalysisClient {
    /** 初期化後の実効能力。 */
    available(): boolean;
    /** loadPosition と設定適用後に新規開始する。 */
    start(
        sessionId: string,
        budget: AnalysisBudget,
        onInfo: (info: EngineInfoEvent) => void,
    ): Promise<AnalysisRun>;
    resume(
        sessionId: string,
        budget: AnalysisBudget,
        onInfo: (info: EngineInfoEvent) => void,
    ): Promise<AnalysisRun>;
    release(): Promise<void>;
}

/**
 * 詰み探索の進め方。
 * - `Speed`: 速さ優先 (不詰の多い詰めろ判定向け)
 * - `Power`: 解く力優先 (証明駒・反証駒で持駒違いの局面に流用する。詰む問題・長手数・難問向け)
 * - `Auto`: 証明駒を使わずに読み、決まらなければ解く力優先で続ける
 */
export type MateMode = "Speed" | "Power" | "Auto";
export interface MateParams {
    /** 既定 `Auto` */
    mode?: MateMode;
    /** 1 局面を解くスレッド数。既定 1。エンジンのスレッド数を上限に丸める (スレッドが使えないときは 1)。 */
    threads?: number;
    /** 置換表の大きさ (MB)。既定 64 */
    hashMb?: number;
    /** 時間の上限 (ミリ秒)。0 か省略で無制限 */
    timeMs?: number;
    /** ノード数の上限。0 か省略で無制限 */
    nodes?: number;
}
export type MateResult =
    /** 詰み。攻め方の手から始まる USI 形式の手順 (最後の手で受け方が詰む) */
    | { kind: "mate"; pv: string[] }
    /** 不詰 (王手を続けて詰ませる手順は無い) */
    | { kind: "noMate" }
    /** 時間・ノード数の上限で打ち切った、または判定できなかった */
    | { kind: "unknown" }
    /** 扱えない局面 (玉が無い、手番でない側が王手されている) */
    | { kind: "unsupported" };
export interface MateOutcome {
    result: MateResult;
    nodes: number;
    elapsedMs: number;
}
export interface MateProgress {
    nodes: number;
    elapsedMs: number;
}
export interface MateClient {
    /**
     * loadPosition で読み込んだ局面の手番側が詰ませられるかを解く。
     * 終わるまでほかの操作 (探索・局面の読み込みなど) は待たされる。途中で止めるには上限を指定する
     * (stop() はエンジンを作り直して止め、待っている solve は失敗する)。
     * @param onProgress 約 1 秒ごとに呼ばれる
     */
    solve(params: MateParams, onProgress?: (progress: MateProgress) => void): Promise<MateOutcome>;
}

type EngineBackend = "native" | "wasm" | "external-usi";
export type EngineStopMode = "terminate" | "cooperative";
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
export declare const SKILL_LEVEL_MIN = 0;
export declare const SKILL_LEVEL_MAX = 20;
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
export declare function validateSkillLevelSettings(
    settings: SkillLevelSettings,
): SkillLevelValidationResult;
/**
 * SkillLevelSettings の値をクランプして正規化する
 */
export declare function normalizeSkillLevelSettings(
    settings: SkillLevelSettings,
): SkillLevelSettings;
export interface EngineInitOptions {
    /** バックエンドの種類 (native/wasm/external-usi) */
    backend?: EngineBackend;
    /** 並列設定 (native / wasm の threaded build で使用) */
    threads?: number;
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
    passRights?: {
        sente: number;
        gote: number;
    };
}
export interface SearchLimits {
    /** 探索最大深さ */
    maxDepth?: number;
    /** ノード数上限 */
    nodes?: number;
    /** 秒読み (ms) */
    byoyomiMs?: number;
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
    | "WASM_INIT_FAILED"
    | "WASM_NETWORK_ERROR"
    | "WASM_MEMORY_ERROR"
    | "WASM_WORKER_SPAWN_ERROR"
    | "WASM_INIT_TIMEOUT"
    | "WASM_THREADS_UNAVAILABLE"
    | "WASM_THREADS_CLAMPED"
    | "WASM_THREADS_INIT_FAILED"
    | "WASM_THREADS_DEFERRED"
    | "WASM_WORKER_FAILED"
    | "MODEL_LOAD_FAILED"
    | "POSITION_INVALID"
    | "SEARCH_FAILED"
    | "TIMEOUT"
    | "UNKNOWN"
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
export declare function getEngineErrorInfo(code: EngineErrorCode | undefined): EngineErrorInfo;
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
    loadNnue?(nnueId: string): Promise<void>;
}
/**
 * Simple in-memory mock that emits a single bestmove.
 * Useful for wiring UI before the real backends (Wasm/Tauri) are ready.
 */
export declare function createMockEngineClient(): EngineClient;
export {};
//# sourceMappingURL=index.d.ts.map

import type {
    GameResult,
    MoveSearchStats,
    NnueSelection,
    Player,
    ResolvedNnue,
    StudyAnalysisCollector,
    StudyAnalysisCompletion,
    StudyLayerRef,
} from "@shogi/app-core";
import { createStudyAnalysisCollector, detectParallelism } from "@shogi/app-core";
import type {
    EngineClient,
    EngineErrorCode,
    EngineEvent,
    EngineInfoEvent,
    SearchHandle,
    SkillLevelSettings,
} from "@shogi/engine-client";
import { getEngineErrorInfo, normalizeSkillLevelSettings } from "@shogi/engine-client";

export type EngineStatus = "idle" | "thinking" | "error";

export interface EngineErrorDetails {
    hasError: boolean;
    errorCode?: EngineErrorCode;
    errorMessage?: string;
    canRetry: boolean;
}

export type EngineOption = {
    id: string;
    label: string;
    createClient: () => EngineClient;
    kind?: "internal" | "external";
    /**
     * 同時に動かせるクライアントの数の上限（省略時は制限なし）。
     * Desktop の内蔵エンジンは、アプリに 1 つしか無いネイティブのエンジンを全クライアントが
     * 共有するので 1。複数の局面を並列に解析すると、互いの局面を上書きしてしまう。
     */
    maxParallel?: number;
    /**
     * 1 クライアントが使えるスレッド数の上限（省略時は端末のコア数まで）。
     * Web の wasm エンジンは線形メモリ（2 GiB）の都合で 8 まで。超えた分は黙って丸められる。
     */
    maxThreads?: number;
    /** 詰み探索（`EngineClient.mate`）を持つか（省略時は持たない）。 */
    supportsMate?: boolean;
};

type SideRole = "human" | "engine";

export type SideSetting = {
    role: SideRole;
    engineId?: string;
    skillLevel?: SkillLevelSettings;
};

type EngineControllerSides = {
    sente: SideSetting;
    gote: SideSetting;
};

type EngineSideClock = {
    mainMs: number;
    byoyomiMs: number;
    /** 1 手ごとに持ち時間へ足す時間（フィッシャー）。無ければ 0 と同じ */
    incrementMs?: number;
};

type EngineClockState = {
    sente: EngineSideClock;
    gote: EngineSideClock;
    lastUpdatedAt: number;
    ticking?: Player | null;
};

export interface PassRightsSettings {
    enabled: boolean;
    senteInitialCount: number;
    goteInitialCount: number;
}

type EngineControllerPosition = {
    startSfen: string;
    moves: string[];
    turn: Player;
    ready: boolean;
    passRightsSettings?: PassRightsSettings;
};

interface AnalysisRun {
    nodeId: string | null;
    ply: number;
    layer: StudyLayerRef | null;
    collector: StudyAnalysisCollector;
}

export interface AnalysisRequest {
    sfen: string;
    moves: string[];
    ply: number;
    depth?: number;
    timeMs?: number;
    multiPv?: number;
    engineId?: string;
    /** 解析するノードの実行時 ID（探索の終了通知にそのまま載る）。 */
    nodeId?: string;
    /**
     * 解析する局面の実際の手番。指定すると、探索が終わったときに `onAnalysisComplete` で
     * 先手視点の解析結果を通知する（研究ノートの保存用）。
     */
    sideToMove?: Player;
    /** 解析を始めた時点のレイヤー。探索の終了通知にそのまま載る。 */
    layer?: StudyLayerRef;
}

export type EngineControllerEvent = {
    id: number;
    atMs: number;
    side?: Player;
    engineId?: string;
    event: EngineEvent;
};

export type EngineControllerErrorLog = {
    id: number;
    atMs: number;
    side?: Player;
    engineId?: string;
    code?: EngineErrorCode;
    message: string;
};

export interface EngineControllerState {
    engineReady: Record<Player, boolean>;
    engineStatus: Record<Player, EngineStatus>;
    engineErrorDetails: Record<Player, EngineErrorDetails | null>;
    eventLogs: EngineControllerEvent[];
    errorLogs: EngineControllerErrorLog[];
    isAnalyzing: boolean;
    isRetrying: Record<Player, boolean>;
    isEngineRestarting: boolean;
}

/**
 * 対局で AI が 1 手に読む量の決め方。"clock" は時計（秒読み・持ち時間）どおりに考える。
 * "nodes"・"depth" はその量だけ読んで指し、時計は渡さない。
 */
export type EngineSearchLimit =
    | { kind: "clock" }
    | { kind: "nodes"; nodes: number }
    | { kind: "depth"; depth: number };

interface EngineControllerSyncContext {
    sides?: EngineControllerSides;
    nnueSelections?: {
        sente?: NnueSelection;
        gote?: NnueSelection;
        analysis?: NnueSelection;
    };
    position?: EngineControllerPosition | null;
    matchRunning?: boolean;
    /** 対局用スレッド数（0または未指定は自動） */
    engineThreads?: Record<Player, number>;
    /** 対局で AI が 1 手に読む量（未指定は時計どおり） */
    engineSearchLimits?: Record<Player, EngineSearchLimit>;
}

interface EngineControllerCommand {
    syncContext: (context: EngineControllerSyncContext) => void;
    setSides: (sides: EngineControllerSides) => void;
    setNnueSelection: (side: Player, selection: NnueSelection | undefined) => void;
    setAnalysisNnueSelection: (selection: NnueSelection | undefined) => void;
    setMatchRunning: (isRunning: boolean) => void;
    setPosition: (position: EngineControllerPosition | null) => void;
    logError: (
        message: string,
        options?: { side?: Player; engineId?: string; code?: EngineErrorCode },
    ) => void;
    /**
     * エンジンを初期化して探索可能な状態にする（探索は開始しない）。
     * 準備に成功したか（エンジンサイドでなければ true）を返す。
     */
    prepare: (side: Player) => Promise<boolean>;
    startTurn: (side: Player) => Promise<void>;
    dispose: (side: Player) => Promise<void>;
    disposeAll: () => Promise<void>;
    retry: (side: Player) => Promise<void>;
    restartForNnue: (side: Player, selection?: NnueSelection) => Promise<void>;
    startAnalysis: (request: AnalysisRequest) => Promise<void>;
    cancelAnalysis: () => Promise<void>;
}

export interface EngineController {
    getState: () => EngineControllerState;
    subscribe: (listener: (state: EngineControllerState) => void) => () => void;
    command: EngineControllerCommand;
    /** 指定サイドのアクティブなEngineClientを取得（外部エンジンのsessionId取得等に使用） */
    getClientForSide: (side: Player) => EngineClient | null;
    /** 解析用のアクティブなEngineClientを取得 */
    getAnalysisClient: () => EngineClient | null;
}

interface EngineControllerCallbacks {
    onMoveFromEngine: (move: string) => void;
    onMatchEnd: (result: GameResult) => Promise<void>;
    onEvalUpdate?: (ply: number, event: EngineInfoEvent) => void;
    onSearchComplete?: (ply: number, stats: MoveSearchStats) => void;
    onLiveInfo?: (side: Player, event: EngineInfoEvent) => void;
    /**
     * 解析（`startAnalysis`）の 1 局面の探索が終わったときに 1 回だけ呼ばれる。
     * 途中経過ごとには呼ばれない。`sideToMove` を指定した解析だけが対象。
     */
    onAnalysisComplete?: (completion: StudyAnalysisCompletion) => void;
}

interface EngineControllerDependencies {
    createClient: (engineId: string) => EngineClient;
    getClockState: () => EngineClockState;
    now: () => number;
    resolveNnue: (selection: NnueSelection) => Promise<ResolvedNnue | null>;
    maxLogs?: number;
    /** 対局中でも解析を許可する（オンライン対戦の AI サポート用） */
    allowAnalysisDuringMatch?: boolean;
    callbacks?: EngineControllerCallbacks;
}

interface EngineControllerContext {
    sides: EngineControllerSides;
    matchRunning: boolean;
    position: EngineControllerPosition | null;
    nnueSelections: Record<Player, NnueSelection | undefined> & {
        analysis?: NnueSelection;
    };
    /** 対局用スレッド数（0=自動） */
    engineThreads: Record<Player, number>;
    engineSearchLimits: Record<Player, EngineSearchLimit>;
}

interface EngineInternalState {
    client: EngineClient | null;
    subscription: (() => void) | null;
    selectedId: string | null;
    ready: boolean;
}

type EngineControllerSearchState = {
    handle: SearchHandle | null;
    pending: boolean;
    requestPly: number | null;
};

type EngineControllerActiveSearch = {
    side: Player;
    engineId: string;
};

interface AnalysisEngineState {
    client: EngineClient | null;
    ready: boolean;
    subscription: (() => void) | null;
    handle: SearchHandle | null;
    ply: number | null;
    engineId: string | null;
}

const DEFAULT_ANALYSIS_TIME_MS = 3000;
const DEFAULT_ANALYSIS_DEPTH = 15;

const createDefaultContext = (): EngineControllerContext => ({
    sides: {
        sente: { role: "human" },
        gote: { role: "human" },
    },
    matchRunning: false,
    position: null,
    nnueSelections: {
        sente: undefined,
        gote: undefined,
        analysis: undefined,
    },
    engineThreads: { sente: 0, gote: 0 },
    engineSearchLimits: { sente: { kind: "clock" }, gote: { kind: "clock" } },
});

const normalizeThreadCount = (value?: number): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (value <= 0) return undefined;
    return Math.trunc(value);
};

// 0 (自動) は UI が「自動（推奨: N）」と表示する検出値に解決する。
// undefined のまま init に渡すとクライアントごとの既定値に落ち、
// UI の「自動（推奨: N）」と実際のスレッド数が食い違う
const getThreadCountForSide = (threads: Record<Player, number>, side: Player): number =>
    normalizeThreadCount(threads[side]) ?? detectParallelism().recommendedWorkers;

const getAnalysisThreadCount = (threads: Record<Player, number>) =>
    Math.max(getThreadCountForSide(threads, "sente"), getThreadCountForSide(threads, "gote"));

const createInitialState = (): EngineControllerState => ({
    engineReady: { sente: false, gote: false },
    engineStatus: { sente: "idle", gote: "idle" },
    engineErrorDetails: { sente: null, gote: null },
    eventLogs: [],
    errorLogs: [],
    isAnalyzing: false,
    isRetrying: { sente: false, gote: false },
    isEngineRestarting: false,
});

const createInitialEngineStates = (): Record<Player, EngineInternalState> => ({
    sente: { client: null, subscription: null, selectedId: null, ready: false },
    gote: { client: null, subscription: null, selectedId: null, ready: false },
});

const createInitialSearchStates = (): Record<Player, EngineControllerSearchState> => ({
    sente: { handle: null, pending: false, requestPly: null },
    gote: { handle: null, pending: false, requestPly: null },
});

const createInitialAnalysisState = (): AnalysisEngineState => ({
    client: null,
    ready: false,
    subscription: null,
    handle: null,
    ply: null,
    engineId: null,
});

/** パス権の設定（または指し手にあるパス）を、局面の読み込みの指定にする。 */
export function buildPassRightsOption(
    passRightsSettings: PassRightsSettings | undefined,
    moves: string[],
) {
    const hasPassInMoves = moves.some((m) => m.toLowerCase() === "pass");

    if (passRightsSettings?.enabled) {
        return {
            passRights: {
                sente: passRightsSettings.senteInitialCount,
                gote: passRightsSettings.goteInitialCount,
            },
        };
    }

    if (hasPassInMoves) {
        let sentePassCount = 0;
        let gotePassCount = 0;
        let isSenteTurn = true;
        for (const move of moves) {
            if (move.toLowerCase() === "pass") {
                if (isSenteTurn) {
                    sentePassCount++;
                } else {
                    gotePassCount++;
                }
            }
            isSenteTurn = !isSenteTurn;
        }
        const minSenteRights = sentePassCount + 1;
        const minGoteRights = gotePassCount + 1;
        return {
            passRights: {
                sente: minSenteRights,
                gote: minGoteRights,
            },
        };
    }

    return undefined;
}

async function applySkillLevelSettings(
    client: EngineClient,
    settings: SkillLevelSettings,
): Promise<void> {
    const normalized = normalizeSkillLevelSettings(settings);
    await client.setOption("Skill Level", normalized.skillLevel);
}

interface EngineControllerBestmoveResult {
    action: "apply_move" | "end_match" | "skip";
    move?: string;
    gameResult?: GameResult;
    shouldClearActive: boolean;
    shouldUpdateRequestPly: boolean;
}

interface EngineControllerBestmoveParams {
    move: string;
    side: Player;
    engineId: string;
    activeSearch: EngineControllerActiveSearch | null;
    movesCount: number;
}

export function determineBestmoveAction(
    params: EngineControllerBestmoveParams,
): EngineControllerBestmoveResult {
    const { move, side, engineId, activeSearch, movesCount } = params;

    if (!activeSearch || activeSearch.engineId !== engineId || activeSearch.side !== side) {
        return {
            action: "skip",
            shouldClearActive: false,
            shouldUpdateRequestPly: false,
        };
    }

    const trimmed = move.trim();
    const token = trimmed.toLowerCase();
    const winner: Player = side === "sente" ? "gote" : "sente";

    switch (token) {
        case "win":
            return {
                action: "end_match",
                gameResult: {
                    winner: side,
                    reason: { kind: "win_declaration", winner: side },
                    totalMoves: movesCount,
                },
                shouldClearActive: true,
                shouldUpdateRequestPly: true,
            };
        case "resign":
            return {
                action: "end_match",
                gameResult: {
                    winner,
                    reason: { kind: "resignation", loser: side },
                    totalMoves: movesCount,
                },
                shouldClearActive: true,
                shouldUpdateRequestPly: true,
            };
        case "none":
            return {
                action: "end_match",
                gameResult: {
                    winner,
                    reason: { kind: "checkmate", loser: side },
                    totalMoves: movesCount,
                },
                shouldClearActive: true,
                shouldUpdateRequestPly: true,
            };
        default:
            return {
                action: "apply_move",
                move: trimmed,
                shouldClearActive: true,
                shouldUpdateRequestPly: true,
            };
    }
}

interface EngineControllerBestmoveHandlerParams {
    side: Player;
    engineId: string;
    activeSearch: EngineControllerActiveSearch | null;
    movesCount: number;
    onMatchEnd: (result: GameResult) => Promise<void>;
    onMoveFromEngine: (move: string) => void;
    onError: (message: string) => void;
}

export function handleBestmove(
    event: EngineEvent,
    params: EngineControllerBestmoveHandlerParams,
): EngineControllerBestmoveResult | null {
    if (event.type !== "bestmove") return null;

    const result = determineBestmoveAction({
        move: event.move,
        side: params.side,
        engineId: params.engineId,
        activeSearch: params.activeSearch,
        movesCount: params.movesCount,
    });

    if (result.action === "apply_move" && result.move) {
        params.onMoveFromEngine(result.move);
    }

    if (result.action === "end_match" && result.gameResult) {
        params.onMatchEnd(result.gameResult).catch((error) => {
            params.onError(`match end failed: ${String(error)}`);
        });
    }

    return result;
}

interface EngineControllerInfoHandlerParams {
    onEvalUpdate?: (ply: number, event: EngineInfoEvent) => void;
    ply: number;
}

export function handleInfoEvent(
    event: EngineEvent,
    params: EngineControllerInfoHandlerParams,
): void {
    if (event.type !== "info") return;
    if (!params.onEvalUpdate) return;

    if (event.scoreCp !== undefined || event.scoreMate !== undefined) {
        params.onEvalUpdate(params.ply, event);
    }
}

export function accumulateSearchStats(
    current: MoveSearchStats,
    event: EngineInfoEvent,
): MoveSearchStats {
    if (event.multipv !== undefined && event.multipv !== 1) return current;
    const next = { ...current };
    const fields = [
        "depth",
        "seldepth",
        "nodes",
        "nps",
        "timeMs",
        "hashfull",
        "multipv",
        "pv",
    ] as const;
    for (const field of fields) {
        const value = event[field];
        if (value !== undefined) (next as Record<string, unknown>)[field] = value;
    }
    // 探索を打ち切った最後の info は、読み筋が最善手 1 手だけに縮むことがある。新しい読み筋がそれまでの
    // 読み筋の先頭と同じ手順なら、長い方を残す（途中から別の手順になったら、短くても新しい読み筋にする）。
    // Desktop の外部 USI からは、読み筋の無い info が pv: null で届く。
    const previousPv = current.pv;
    if (
        Array.isArray(event.pv) &&
        Array.isArray(previousPv) &&
        event.pv.length < previousPv.length &&
        event.pv.every((move, index) => previousPv[index] === move)
    ) {
        next.pv = previousPv;
    }
    // 同一探索内で通常評価と詰み評価が入れ替わることがあるため、評価種別は排他で保持する
    if (event.scoreCp !== undefined) {
        next.scoreCp = event.scoreCp;
        delete next.scoreMate;
    } else if (event.scoreMate !== undefined) {
        next.scoreMate = event.scoreMate;
        delete next.scoreCp;
    }
    return next;
}

export function createEngineController(
    dependencies: EngineControllerDependencies,
): EngineController {
    const listeners = new Set<(state: EngineControllerState) => void>();
    let state = createInitialState();
    let context = createDefaultContext();
    const engineStates = createInitialEngineStates();
    const searchStates = createInitialSearchStates();
    const analysisState = createInitialAnalysisState();
    /** 進行中の解析の、結果をまとめるための情報。通知したら null に戻す。 */
    let analysisRun: AnalysisRun | null = null;
    /** 解析用エンジンを初期化したときのスレッド数（結果の実行情報に残す）。 */
    let analysisThreads: number | null = null;
    const liveSearchStats = { sente: {}, gote: {} } as Record<Player, MoveSearchStats>;
    const liveThinkLimitMs = { sente: undefined, gote: undefined } as Record<
        Player,
        number | undefined
    >;
    // 側ごとの in-flight 初期化。並行呼び出しは同じ Promise を共有して二重初期化を防ぐ
    const initializing = { sente: null, gote: null } as Record<
        Player,
        Promise<{
            client: EngineClient;
            engineId: string;
        } | null> | null
    >;
    const sideGeneration = { sente: 0, gote: 0 };
    let activeSearch: EngineControllerActiveSearch | null = null;
    let logId = 0;
    const maxLogs = dependencies.maxLogs ?? 80;
    const callbacks = dependencies.callbacks ?? {
        onMoveFromEngine: () => undefined,
        onMatchEnd: async () => undefined,
    };
    const now = dependencies.now;

    const emit = () => {
        for (const listener of listeners) {
            listener(state);
        }
    };

    const setState = (next: EngineControllerState) => {
        state = next;
        emit();
    };

    const updateState = (updater: (prev: EngineControllerState) => EngineControllerState) => {
        setState(updater(state));
    };

    const pushEventLog = (event: EngineControllerEvent) => {
        updateState((prev) => ({
            ...prev,
            eventLogs: [event, ...prev.eventLogs].slice(0, maxLogs),
        }));
    };

    const pushErrorLog = (log: EngineControllerErrorLog) => {
        updateState((prev) => ({
            ...prev,
            errorLogs: [log, ...prev.errorLogs].slice(0, maxLogs),
        }));
    };

    const setEngineStatus = (side: Player, status: EngineStatus) => {
        updateState((prev) => ({
            ...prev,
            engineStatus: { ...prev.engineStatus, [side]: status },
        }));
    };

    const setEngineReady = (side: Player, ready: boolean) => {
        updateState((prev) => ({
            ...prev,
            engineReady: { ...prev.engineReady, [side]: ready },
        }));
    };

    const setEngineErrorDetails = (side: Player, details: EngineErrorDetails | null) => {
        updateState((prev) => ({
            ...prev,
            engineErrorDetails: { ...prev.engineErrorDetails, [side]: details },
        }));
    };

    const setIsRetrying = (side: Player, value: boolean) => {
        updateState((prev) => ({
            ...prev,
            isRetrying: { ...prev.isRetrying, [side]: value },
        }));
    };

    const setIsEngineRestarting = (value: boolean) => {
        updateState((prev) => ({
            ...prev,
            isEngineRestarting: value,
        }));
    };

    const addErrorLog = (
        message: string,
        options?: { side?: Player; engineId?: string; code?: EngineErrorCode },
    ) => {
        pushErrorLog({
            id: ++logId,
            atMs: now(),
            side: options?.side,
            engineId: options?.engineId,
            code: options?.code,
            message,
        });
    };

    const attachSubscription = (side: Player, client: EngineClient, engineId: string) => {
        const engineState = engineStates[side];
        if (engineState.subscription) return;
        const generation = sideGeneration[side];

        const unsub = client.subscribe((event) => {
            if (sideGeneration[side] !== generation || engineState.client !== client) return;
            pushEventLog({
                id: ++logId,
                atMs: now(),
                side,
                engineId,
                event,
            });

            if (event.type === "bestmove") {
                const searchState = searchStates[side];

                if (!context.matchRunning) {
                    searchState.pending = false;
                    searchState.handle = null;
                    searchState.requestPly = null;
                    if (activeSearch?.side === side) {
                        activeSearch = null;
                    }
                    setEngineStatus(side, "idle");
                    return;
                }

                setEngineStatus(side, "idle");
                searchState.pending = false;
                searchState.handle = null;

                const movesCount = context.position?.moves.length ?? 0;
                const result = determineBestmoveAction({
                    move: event.move,
                    side,
                    engineId,
                    activeSearch,
                    movesCount,
                });

                if (result.shouldClearActive) {
                    activeSearch = null;
                }
                if (result.shouldUpdateRequestPly) {
                    searchState.requestPly = movesCount;
                }

                if (result.action === "apply_move" && result.move) {
                    // 実際に使ったスレッド数（threaded の初期化に失敗して 1 スレッドに戻ることもあるので、設定値でなく
                    // エンジンに聞く）。
                    const threads = engineStates[side].client?.getThreadInfo?.().activeThreads;
                    callbacks.onSearchComplete?.(movesCount, {
                        ...liveSearchStats[side],
                        thinkLimitMs: liveThinkLimitMs[side],
                        engineId,
                        ...(threads ? { threads } : {}),
                    });
                    callbacks.onMoveFromEngine(result.move);
                }

                if (result.action === "end_match" && result.gameResult) {
                    callbacks.onMatchEnd(result.gameResult).catch((error) => {
                        if (sideGeneration[side] !== generation) return;
                        addErrorLog(`match end failed: ${String(error)}`, { side, engineId });
                    });
                }
            }

            if (event.type === "info") {
                callbacks.onLiveInfo?.(side, event);
                liveSearchStats[side] = accumulateSearchStats(liveSearchStats[side], event);
                if (
                    callbacks.onEvalUpdate &&
                    (event.scoreCp !== undefined || event.scoreMate !== undefined)
                ) {
                    const ply = context.position?.moves.length ?? 0;
                    callbacks.onEvalUpdate(ply, event);
                }
            }

            if (event.type === "error") {
                if (event.severity === "warning") {
                    return;
                }

                const searchState = searchStates[side];

                setEngineStatus(side, "error");
                searchState.handle = null;
                searchState.pending = false;
                searchState.requestPly = null;
                if (activeSearch?.side === side) {
                    activeSearch = null;
                }

                addErrorLog(event.message, { side, engineId, code: event.code });

                const errorInfo = getEngineErrorInfo(event.code);
                setEngineErrorDetails(side, {
                    hasError: true,
                    errorCode: event.code,
                    errorMessage: event.message,
                    canRetry: errorInfo.canRetry,
                });
            }
        });

        engineState.subscription = unsub;
    };

    // EngineClient に中断用 signal がないため、実行中の呼び出しが戻ってから破棄する。
    const sideOps = { sente: Promise.resolve(), gote: Promise.resolve() } as Record<
        Player,
        Promise<unknown>
    >;
    const withSideOp = <T>(side: Player, fn: () => Promise<T>): Promise<T> => {
        const run = sideOps[side].then(fn);
        sideOps[side] = run.then(
            () => undefined,
            () => undefined,
        );
        return run;
    };

    const disposeEngineForSide = (side: Player): Promise<void> => {
        sideGeneration[side] += 1;
        initializing[side] = null;
        engineStates[side].ready = false;
        const previousSearch = searchStates[side];
        searchStates[side] = { handle: null, pending: false, requestPly: null };
        if (activeSearch?.side === side) activeSearch = null;
        const disposing = withSideOp(side, () => disposeEngineForSideInner(side, previousSearch));
        setEngineReady(side, false);
        return disposing;
    };

    const disposeEngineForSideInner = async (side: Player, searchState = searchStates[side]) => {
        const engineState = engineStates[side];
        const client = engineState.client;
        const handle = searchState.handle;
        const unsubscribe = engineState.subscription;
        engineState.client = null;
        engineState.subscription = null;
        engineState.selectedId = null;
        engineState.ready = false;
        searchState.handle = null;
        searchState.pending = false;
        searchState.requestPly = null;
        if (activeSearch?.side === side) activeSearch = null;

        try {
            unsubscribe?.();
        } catch (error) {
            addErrorLog(`サブスクリプション解除に失敗 (${side}): ${String(error)}`, { side });
        }

        try {
            // WASM の cancel/stop は Worker を再初期化するため、破棄時は dispose を使う。
            if (client?.dispose) await client.dispose();
            else await handle?.cancel();
        } catch (error) {
            addErrorLog(`エンジン破棄に失敗 (${side}): ${String(error)}`, { side });
        }

        setEngineReady(side, false);
        setEngineStatus(side, "idle");
    };

    const reinitializeEngineCore = (
        side: Player,
        options: {
            loadPosition: boolean;
            errorLogPrefix: string;
            nnueSelection?: NnueSelection;
        },
    ): Promise<boolean> => {
        const generation = sideGeneration[side];
        return withSideOp(side, () => reinitializeEngineCoreInner(side, options, generation));
    };

    const reinitializeEngineCoreInner = async (
        side: Player,
        options: {
            loadPosition: boolean;
            errorLogPrefix: string;
            nnueSelection?: NnueSelection;
        },
        generation: number,
    ): Promise<boolean> => {
        const isCurrent = () => sideGeneration[side] === generation;
        if (!isCurrent()) return false;
        const engineState = engineStates[side];
        const client = engineState.client;
        if (!client) return false;

        try {
            if ("reset" in client && typeof client.reset === "function") {
                await client.reset();
                if (!isCurrent()) return false;
            }

            setEngineErrorDetails(side, null);
            setEngineStatus(side, "idle");
            engineState.ready = false;

            const threadCount = getThreadCountForSide(context.engineThreads, side);
            await client.init({ threads: threadCount });
            if (!isCurrent()) return false;

            const selection =
                options.nnueSelection ??
                (side === "sente" ? context.nnueSelections.sente : context.nnueSelections.gote);
            if (selection && (selection.presetKey || selection.nnueId) && client.loadNnue) {
                const resolved = await dependencies.resolveNnue(selection);
                if (!isCurrent()) return false;
                if (resolved) {
                    await client.loadNnue(resolved.nnueId, resolved.layerStacks);
                    if (!isCurrent()) return false;
                    await client.setOption("FV_SCALE", resolved.fvScale);
                    if (!isCurrent()) return false;
                }
            }

            const skillSettings = context.sides[side].skillLevel;
            if (skillSettings) {
                await applySkillLevelSettings(client, skillSettings);
                if (!isCurrent()) return false;
            }

            if (options.loadPosition && context.position) {
                await client.loadPosition(
                    context.position.startSfen,
                    context.position.moves,
                    buildPassRightsOption(
                        context.position.passRightsSettings,
                        context.position.moves,
                    ),
                );
                if (!isCurrent()) return false;
            }

            engineState.ready = true;
            setEngineReady(side, true);
            return true;
        } catch (error) {
            if (!isCurrent()) return false;
            addErrorLog(`${options.errorLogPrefix} (${side}): ${String(error)}`, { side });
            setEngineStatus(side, "error");
            const errorInfo = getEngineErrorInfo("WASM_INIT_FAILED");
            setEngineErrorDetails(side, {
                hasError: true,
                errorCode: "WASM_INIT_FAILED",
                errorMessage: String(error),
                canRetry: errorInfo.canRetry,
            });
            return false;
        }
    };

    const ensureEngineReady = (
        side: Player,
    ): Promise<{ client: EngineClient; engineId: string } | null> => {
        const inflight = initializing[side];
        if (inflight) return inflight;

        const generation = sideGeneration[side];
        const promise = withSideOp(side, () => ensureEngineReadyInner(side, generation))
            .catch((error) => {
                if (sideGeneration[side] !== generation) return null;
                throw error;
            })
            .finally(() => {
                if (initializing[side] === promise) initializing[side] = null;
            });
        initializing[side] = promise;
        return promise;
    };

    const ensureEngineReadyInner = async (
        side: Player,
        generation: number,
    ): Promise<{ client: EngineClient; engineId: string } | null> => {
        const isCurrent = () => sideGeneration[side] === generation;
        if (!isCurrent()) return null;
        const setting = context.sides[side];
        if (setting.role !== "engine") return null;
        const selectedId = setting.engineId;
        if (!selectedId) return null;

        const engineState = engineStates[side];

        if (engineState.selectedId && engineState.selectedId !== selectedId) {
            // ensureEngineReadyInner は sideOps ロック内で実行されるため、
            // ロックを取る disposeEngineForSide を呼ぶとデッドロックする
            await disposeEngineForSideInner(side);
            if (!isCurrent()) return null;
        }

        let client = engineState.client;
        if (!client) {
            client = dependencies.createClient(selectedId);
            engineState.client = client;
            engineState.selectedId = selectedId;
            engineState.ready = false;
        }

        attachSubscription(side, client, selectedId);

        if (!engineState.ready) {
            const threadCount = getThreadCountForSide(context.engineThreads, side);
            await client.init({ threads: threadCount });
            if (!isCurrent()) return null;

            const selection =
                side === "sente" ? context.nnueSelections.sente : context.nnueSelections.gote;
            if (selection && (selection.presetKey || selection.nnueId) && client.loadNnue) {
                const resolved = await dependencies.resolveNnue(selection);
                if (!isCurrent()) return null;
                if (resolved) {
                    await client.loadNnue(resolved.nnueId, resolved.layerStacks);
                    if (!isCurrent()) return null;
                    await client.setOption("FV_SCALE", resolved.fvScale);
                    if (!isCurrent()) return null;
                }
            }

            const skillSettings = setting.skillLevel;
            if (skillSettings) {
                await applySkillLevelSettings(client, skillSettings);
                if (!isCurrent()) return null;
            }

            if (context.position) {
                await client.loadPosition(
                    context.position.startSfen,
                    context.position.moves,
                    buildPassRightsOption(
                        context.position.passRightsSettings,
                        context.position.moves,
                    ),
                );
                if (!isCurrent()) return null;
            }
            engineState.ready = true;
            setEngineReady(side, true);
        }

        return { client, engineId: selectedId };
    };

    const startEngineTurn = async (side: Player) => {
        const generation = sideGeneration[side];
        const isCurrent = () => sideGeneration[side] === generation;
        if (!context.position || !context.position.ready) return;
        if (!context.matchRunning) return;

        const searchState = searchStates[side];
        if (searchState.pending) return;
        // ensureEngineReady が in-flight 初期化を共有するため、pending は
        // ターン開始全体を覆って同一サイドの並行ターン開始（二重探索）を防ぐ
        searchState.pending = true;

        try {
            const ready = await ensureEngineReady(side);
            if (!ready || !isCurrent()) return;
            const { client, engineId } = ready;

            const engineState = engineStates[side];
            if (engineState.client !== client || !context.matchRunning) {
                return;
            }

            if (searchState.handle) {
                const current = activeSearch;
                if (current && current.side === side && current.engineId === engineId) {
                    return;
                }
                await searchState.handle.cancel().catch(() => undefined);
                if (!isCurrent()) return;
            }

            setEngineStatus(side, "thinking");

            if (!context.position) return;
            await client.loadPosition(
                context.position.startSfen,
                context.position.moves,
                buildPassRightsOption(context.position.passRightsSettings, context.position.moves),
            );

            if (!isCurrent() || engineState.client !== client || !context.matchRunning) {
                return;
            }

            const clocks = dependencies.getClockState();
            const clockState = clocks[side];
            const elapsedSinceUpdate = dependencies.now() - clocks.lastUpdatedAt;
            const remainingMainMs = Math.max(0, clockState.mainMs - elapsedSinceUpdate);
            let remainingByoyomiMs = clockState.byoyomiMs;

            if (remainingMainMs <= 0 && clockState.mainMs > 0) {
                const overTime = elapsedSinceUpdate - clockState.mainMs;
                remainingByoyomiMs = Math.max(0, clockState.byoyomiMs - overTime);
            } else if (clockState.mainMs === 0) {
                remainingByoyomiMs = Math.max(0, clockState.byoyomiMs - elapsedSinceUpdate);
            }

            const effectiveByoyomiMs = Math.max(100, remainingByoyomiMs);
            const hasMainTime = clocks.sente.mainMs > 0 || clocks.gote.mainMs > 0;
            const ownIncrementMs = clockState.incrementMs ?? 0;
            // エンジン（YaneuraOu 系の時間管理）は「残り時間 + 加算」まで考えてよいと読むが、この時計は
            // 加算を指し終えてから足す。残り時間から加算を引いて渡さないと、終盤に送った時間を超えて考え、
            // 時間切れになる。
            // 残りが加算より少ないときは加算のほうを残りまでに抑え、渡す合計が残り時間を超えないようにする。
            const ownIncrementSentMs = Math.min(ownIncrementMs, remainingMainMs);
            const ownTimeMs = remainingMainMs - ownIncrementSentMs;
            const btimeMs = side === "sente" ? ownTimeMs : clocks.sente.mainMs;
            const wtimeMs = side === "gote" ? ownTimeMs : clocks.gote.mainMs;
            const bincMs = side === "sente" ? ownIncrementSentMs : (clocks.sente.incrementMs ?? 0);
            const wincMs = side === "gote" ? ownIncrementSentMs : (clocks.gote.incrementMs ?? 0);
            // 秒読みの下限 100ms が要るのは、持ち時間の無い「1 手◯秒」だけ。切れ負けや加算の側に渡すと、
            // エンジンは持ち時間を使い切っても秒読みがあると見て指し遅れ、時間切れになる。
            const sendByoyomi = clockState.byoyomiMs > 0 || clockState.mainMs === 0;

            const searchLimit = context.engineSearchLimits[side];
            liveSearchStats[side] = {};
            liveThinkLimitMs[side] =
                searchLimit.kind === "clock" && sendByoyomi ? effectiveByoyomiMs : undefined;

            const handle = await client.search({
                limits:
                    searchLimit.kind === "nodes"
                        ? { nodes: searchLimit.nodes }
                        : searchLimit.kind === "depth"
                          ? { maxDepth: searchLimit.depth }
                          : {
                                ...(sendByoyomi ? { byoyomiMs: effectiveByoyomiMs } : {}),
                                ...(hasMainTime ? { btimeMs, wtimeMs } : {}),
                                // 秒読みで指す側には加算を渡さない（秒読みと加算を同時に受けると戸惑う外部エンジンがある）。
                                ...(ownIncrementMs > 0 ? { bincMs, wincMs } : {}),
                            },
                ponder: false,
            });

            if (!isCurrent() || engineState.client !== client) {
                if (!client.dispose) await handle.cancel().catch(() => undefined);
                return;
            }
            if (!context.matchRunning) {
                await handle.cancel().catch(() => undefined);
                return;
            }

            searchState.handle = handle;
            activeSearch = { side, engineId };
        } catch (error) {
            if (isCurrent()) throw error;
        } finally {
            if (isCurrent()) searchState.pending = false;
        }
    };

    const maybeStartTurn = (side: Player) => {
        if (!context.position || !context.position.ready) return;
        if (!context.matchRunning) return;
        if (context.sides[side].role !== "engine") return;

        const selectedId = context.sides[side].engineId;
        if (!selectedId) return;

        const searchState = searchStates[side];
        const current = activeSearch;
        const movesCount = context.position.moves.length;

        if (current && current.side === side && current.engineId === selectedId) {
            return;
        }
        if (searchState.requestPly === movesCount) return;

        searchState.requestPly = movesCount;
        const generation = sideGeneration[side];

        void startEngineTurn(side).catch((error) => {
            if (sideGeneration[side] !== generation) return;
            setEngineStatus(side, "error");
            addErrorLog(`engine error: ${String(error)}`, { side, engineId: selectedId });
        });
    };

    /** 進行中の解析の結果をまとめて通知する（1 回の探索につき 1 回だけ）。 */
    const completeAnalysisRun = (completion: "completed" | "aborted") => {
        const run = analysisRun;
        analysisRun = null;
        if (!run) return;
        const result = run.collector.finish(completion);
        if (!result) return;
        callbacks.onAnalysisComplete?.({
            runtimeNodeId: run.nodeId,
            ply: run.ply,
            layer: run.layer,
            result,
        });
    };

    let analysisGeneration = 0;
    let reuseSupersededAnalysis = false;
    let analysisOps: Promise<unknown> = Promise.resolve();
    const withAnalysisOp = (operation: () => Promise<void>): Promise<void> => {
        const run = analysisOps.then(operation);
        analysisOps = run.catch(() => undefined);
        return run;
    };

    const invalidateAnalysis = (reuseReadyClient = false) => {
        analysisGeneration += 1;
        reuseSupersededAnalysis = reuseReadyClient;
        completeAnalysisRun("aborted");
        analysisState.subscription?.();
        analysisState.subscription = null;
        analysisState.ply = null;
        updateState((prev) => ({ ...prev, isAnalyzing: false }));
        return analysisGeneration;
    };

    const cancelAnalysisInner = async () => {
        const handle = analysisState.handle;
        analysisState.handle = null;
        try {
            await handle?.cancel();
        } catch {
            // ignore
        }
    };

    const disposeAnalysisEngineInner = async () => {
        const client = analysisState.client;
        const handle = analysisState.handle;
        analysisState.subscription?.();
        analysisState.subscription = null;
        analysisState.client = null;
        analysisState.ready = false;
        analysisState.engineId = null;
        analysisState.handle = null;
        analysisThreads = null;
        try {
            // WASM の cancel は Worker を再初期化するため、破棄時は dispose だけを使う。
            if (client?.dispose) await client.dispose();
            else await handle?.cancel();
        } catch (error) {
            addErrorLog(`解析エンジンの破棄に失敗: ${String(error)}`);
        }
    };

    const cancelAnalysis = () => {
        invalidateAnalysis();
        return withAnalysisOp(cancelAnalysisInner);
    };

    const disposeAnalysisEngine = () => {
        invalidateAnalysis();
        return withAnalysisOp(disposeAnalysisEngineInner);
    };

    const startAnalysisInner = async (request: AnalysisRequest, generation: number) => {
        const isCurrent = () => analysisGeneration === generation;
        if (!isCurrent()) return;
        await cancelAnalysisInner();
        if (!isCurrent()) return;
        if (context.matchRunning && !dependencies.allowAnalysisDuringMatch) {
            addErrorLog("対局中は解析できません");
            return;
        }

        const engineId =
            request.engineId ?? context.sides.sente.engineId ?? context.sides.gote.engineId;
        if (!engineId) {
            addErrorLog("利用可能なエンジンがありません");
            return;
        }

        updateState((prev) => ({ ...prev, isAnalyzing: true }));
        analysisState.ply = request.ply;
        // 初期化や局面の読み込みに失敗した場合に、前の探索の情報が残らないようにする。
        analysisRun = null;

        let client = analysisState.client;
        if (!client || analysisState.engineId !== engineId) {
            if (client && analysisState.engineId !== engineId) {
                await disposeAnalysisEngineInner();
                if (!isCurrent()) return;
            }
            try {
                client = dependencies.createClient(engineId);
                analysisState.client = client;
                analysisState.ready = false;
                analysisState.engineId = engineId;
                const threadCount = getAnalysisThreadCount(context.engineThreads);
                await client.init({ threads: threadCount });
                if (!isCurrent()) return;
                analysisThreads = threadCount;

                const selection = context.nnueSelections.analysis;
                if (selection && (selection.presetKey || selection.nnueId) && client.loadNnue) {
                    const resolved = await dependencies.resolveNnue(selection);
                    if (!isCurrent()) return;
                    if (resolved) {
                        await client.loadNnue(resolved.nnueId, resolved.layerStacks);
                        if (!isCurrent()) return;
                        await client.setOption("FV_SCALE", resolved.fvScale);
                        if (!isCurrent()) return;
                    }
                }
                analysisState.ready = true;
            } catch (error) {
                if (!isCurrent()) return;
                addErrorLog(`エンジン初期化エラー: ${String(error)}`);
                invalidateAnalysis();
                return;
            }
        }

        const multiPv = request.multiPv ?? 1;
        try {
            await client.setOption("MultiPV", String(multiPv));
        } catch {
            // ignore unsupported MultiPV
        }
        if (!isCurrent()) return;

        if (analysisState.subscription) {
            analysisState.subscription();
        }

        const run: AnalysisRun | null = request.sideToMove
            ? {
                  nodeId: request.nodeId ?? null,
                  ply: request.ply,
                  layer: request.layer ?? null,
                  collector: createStudyAnalysisCollector({
                      runId: crypto.randomUUID(),
                      sideToMove: request.sideToMove,
                      execution: { threads: analysisThreads, parallelWorkers: 1 },
                  }),
              }
            : null;

        const unsub = client.subscribe((event) => {
            if (!isCurrent()) return;
            pushEventLog({
                id: ++logId,
                atMs: now(),
                engineId: analysisState.engineId ?? engineId,
                event,
            });

            if (event.type === "info") {
                if (run && analysisRun === run) run.collector.push(event);
                if (
                    callbacks.onEvalUpdate &&
                    (event.scoreCp !== undefined || event.scoreMate !== undefined)
                ) {
                    const ply = analysisState.ply;
                    if (ply !== null) {
                        callbacks.onEvalUpdate(ply, event);
                    }
                }
            }

            if (event.type === "bestmove") {
                // bestmoveイベントにPVと評価値が含まれている場合、最終評価値として記録
                if (
                    callbacks.onEvalUpdate &&
                    (event.scoreCp !== undefined || event.scoreMate !== undefined) &&
                    event.pv
                ) {
                    const ply = analysisState.ply;
                    if (ply !== null) {
                        // EngineInfoEvent互換の形式で評価値を渡す
                        callbacks.onEvalUpdate(ply, {
                            type: "info",
                            depth: event.depth,
                            scoreCp: event.scoreCp,
                            scoreMate: event.scoreMate,
                            pv: event.pv,
                        });
                    }
                }
                if (run && analysisRun === run) {
                    // bestmove にだけ評価値が載るエンジンでも、最善候補を残す。
                    if (event.scoreCp !== undefined || event.scoreMate !== undefined) {
                        run.collector.push({
                            depth: event.depth,
                            scoreCp: event.scoreCp,
                            scoreMate: event.scoreMate,
                            pv: event.pv,
                        });
                    }
                    completeAnalysisRun("completed");
                }
                analysisState.handle = null;
                analysisState.ply = null;
                updateState((prev) => ({ ...prev, isAnalyzing: false }));
            }

            if (event.type === "error") {
                if (run && analysisRun === run) analysisRun = null;
                addErrorLog(event.message, { engineId: analysisState.engineId ?? engineId });
                analysisState.handle = null;
                analysisState.ply = null;
                updateState((prev) => ({ ...prev, isAnalyzing: false }));
            }
        });
        analysisState.subscription = unsub;

        try {
            await client.loadPosition(
                request.sfen,
                request.moves,
                buildPassRightsOption(context.position?.passRightsSettings, request.moves),
            );
        } catch (error) {
            analysisState.ready = false;
            if (!isCurrent()) return;
            addErrorLog(`局面読み込みエラー: ${String(error)}`);
            invalidateAnalysis();
            return;
        }
        if (!isCurrent()) return;

        try {
            const timeMs = request.timeMs ?? DEFAULT_ANALYSIS_TIME_MS;
            const depth = request.depth ?? DEFAULT_ANALYSIS_DEPTH;
            // 探索中の情報はここから届く。局面の読み込みまでに届いた前の探索の情報は拾わない。
            analysisRun = run;
            const handle = await client.search({
                limits: {
                    movetimeMs: timeMs,
                    maxDepth: depth,
                },
                ponder: false,
            });

            if (!isCurrent() || state.isAnalyzing) analysisState.handle = handle;
        } catch (error) {
            analysisState.ready = false;
            if (!isCurrent()) return;
            analysisRun = null;
            addErrorLog(`探索開始エラー: ${String(error)}`);
            invalidateAnalysis();
        }
    };

    const startAnalysis = (request: AnalysisRequest) => {
        const generation = invalidateAnalysis(true);
        return withAnalysisOp(async () => {
            try {
                await startAnalysisInner(request, generation);
            } finally {
                if (
                    analysisGeneration !== generation &&
                    (!reuseSupersededAnalysis || !analysisState.ready)
                ) {
                    await disposeAnalysisEngineInner();
                }
            }
        });
    };

    const applySkillLevels = () => {
        for (const side of ["sente", "gote"] as const) {
            const setting = context.sides[side];
            if (setting.role !== "engine" || !setting.skillLevel) continue;
            const engineState = engineStates[side];
            if (!engineState.client || !engineState.ready) continue;
            const selectedId = setting.engineId;
            if (!selectedId || engineState.selectedId !== selectedId) continue;
            const generation = sideGeneration[side];

            void applySkillLevelSettings(engineState.client, setting.skillLevel).catch((error) => {
                if (sideGeneration[side] !== generation) return;
                addErrorLog(`Skill Level 設定に失敗 (${side}): ${String(error)}`, {
                    side,
                    engineId: selectedId,
                });
            });
        }
    };

    // sideOps キューに載せることで、初期化 in-flight 中の変更も init 完了後に適用される。
    // 失敗は握りつぶさずエラーログへ記録する
    const applyThreadOptionQueued = (side: Player, client: EngineClient, threadCount: number) => {
        const generation = sideGeneration[side];
        return withSideOp(side, async () => {
            if (sideGeneration[side] !== generation || engineStates[side].client !== client) return;
            try {
                await client.setOption("Threads", threadCount);
            } catch (error) {
                if (sideGeneration[side] !== generation) return;
                addErrorLog(`スレッド数の適用に失敗 (${side}): ${String(error)}`, { side });
            }
        });
    };

    const applyThreadChange = (
        nextThreads: Record<Player, number>,
        prevThreads: Record<Player, number>,
    ) => {
        let changed = false;
        for (const side of ["sente", "gote"] as const) {
            const resolvedPrev = getThreadCountForSide(prevThreads, side);
            const resolvedNext = getThreadCountForSide(nextThreads, side);
            if (resolvedPrev !== resolvedNext) changed = true;
            const engineState = engineStates[side];
            const client = engineState.client;
            if (!client) continue;
            // init の threads を適用しないクライアント (reset を持たない外部 USI) では
            // 自動 = 登録時設定であり推奨値と同一視できない。推奨値に畳んで比較すると
            // 「登録時 Threads=1 のエンジンに明示 4 (=推奨値) を選んでも no-op 判定で
            // 届かない」ため、生の設定値 (自動は undefined) で比較する
            const appliesInitThreads = "reset" in client && typeof client.reset === "function";
            const prevValue = appliesInitThreads
                ? resolvedPrev
                : normalizeThreadCount(prevThreads[side]);
            const nextValue = appliesInitThreads
                ? resolvedNext
                : normalizeThreadCount(nextThreads[side]);
            if (prevValue === nextValue) continue;
            if (nextValue === undefined) {
                // 外部 USI の明示 → 自動は「登録時設定に戻す」だが、セッションを
                // 維持したままでは戻せない。次回のエンジン起動時に登録時設定が適用される
                continue;
            }
            if (!engineState.ready) {
                void applyThreadOptionQueued(side, client, nextValue);
                continue;
            }
            // reset を持つクライアント (WASM 等) は init でスレッドプールを再構築する。
            // reset を持たない外部 USI は init するとセッションが張り直され登録時
            // オプションで上書きされるため、セッション維持のまま setoption で反映する
            if (appliesInitThreads) {
                void reinitializeEngineCore(side, {
                    loadPosition: true,
                    errorLogPrefix: "スレッド数変更の再初期化に失敗",
                });
            } else {
                void applyThreadOptionQueued(side, client, nextValue);
            }
        }

        if (changed && analysisState.client) {
            void disposeAnalysisEngine();
        }
    };

    const command: EngineControllerCommand = {
        syncContext: (next) => {
            const prevAnalysis = context.nnueSelections.analysis;
            const prevThreads = context.engineThreads;
            const nextNnueSelections = {
                ...context.nnueSelections,
                ...next.nnueSelections,
            };
            const nextThreads = next.engineThreads ?? context.engineThreads;

            context = {
                sides: next.sides ?? context.sides,
                matchRunning: next.matchRunning ?? context.matchRunning,
                position: next.position ?? context.position,
                nnueSelections: nextNnueSelections,
                engineThreads: nextThreads,
                engineSearchLimits: next.engineSearchLimits ?? context.engineSearchLimits,
            };

            if (
                prevAnalysis?.presetKey !== nextNnueSelections.analysis?.presetKey ||
                prevAnalysis?.nnueId !== nextNnueSelections.analysis?.nnueId
            ) {
                void disposeAnalysisEngine();
            }

            // 推奨値に解決してから比較すると「自動 → 同値の明示」の変化を見落とす。
            // 外部 USI では自動 = 登録時設定のためこの変化にも意味がある (クライアント
            // 種別ごとの判定は applyThreadChange 側で行う)
            if (prevThreads.sente !== nextThreads.sente || prevThreads.gote !== nextThreads.gote) {
                applyThreadChange(nextThreads, prevThreads);
            }

            applySkillLevels();

            if (context.position && context.matchRunning) {
                maybeStartTurn(context.position.turn);
            }
        },
        setSides: (sides) => {
            context = { ...context, sides };
            applySkillLevels();
            if (context.position) {
                maybeStartTurn(context.position.turn);
            }
        },
        setNnueSelection: (side, selection) => {
            const prev = context.nnueSelections[side];
            context = {
                ...context,
                nnueSelections: { ...context.nnueSelections, [side]: selection },
            };
            // NNUE選択が変更された場合、エンジンを破棄して次回の対局開始時に再初期化させる
            if (prev?.presetKey !== selection?.presetKey || prev?.nnueId !== selection?.nnueId) {
                void disposeEngineForSide(side);
            }
        },
        setAnalysisNnueSelection: (selection) => {
            const prev = context.nnueSelections.analysis;
            context = {
                ...context,
                nnueSelections: { ...context.nnueSelections, analysis: selection },
            };
            if (prev?.presetKey !== selection?.presetKey || prev?.nnueId !== selection?.nnueId) {
                void disposeAnalysisEngine();
            }
        },
        setMatchRunning: (isRunning) => {
            context = { ...context, matchRunning: isRunning };
            if (isRunning && context.position) {
                maybeStartTurn(context.position.turn);
            }
        },
        setPosition: (position) => {
            context = { ...context, position };
            if (position) {
                maybeStartTurn(position.turn);
            }
        },
        logError: (message, options) => {
            addErrorLog(message, options);
        },
        prepare: async (side) => {
            const generation = sideGeneration[side];
            const setting = context.sides[side];
            if (setting.role !== "engine" || !setting.engineId) return true;
            try {
                const ready = await ensureEngineReady(side);
                return sideGeneration[side] === generation && ready !== null;
            } catch (error) {
                if (sideGeneration[side] !== generation) return false;
                setEngineStatus(side, "error");
                addErrorLog(`engine error: ${String(error)}`, {
                    side,
                    engineId: setting.engineId,
                });
                return false;
            }
        },
        startTurn: async (side) => {
            await startEngineTurn(side);
        },
        dispose: async (side) => {
            await disposeEngineForSide(side);
        },
        disposeAll: async () => {
            context = { ...context, matchRunning: false };
            await Promise.all([
                disposeEngineForSide("sente"),
                disposeEngineForSide("gote"),
                disposeAnalysisEngine(),
            ]);
        },
        retry: async (side) => {
            const engineState = engineStates[side];
            if (!engineState.client) return;

            const searchState = searchStates[side];
            if (searchState.pending) {
                addErrorLog(`リトライ中です (${side})`, { side });
                return;
            }

            setIsRetrying(side, true);
            searchState.pending = true;

            try {
                await reinitializeEngineCore(side, {
                    loadPosition: false,
                    errorLogPrefix: "リトライ失敗",
                });
            } finally {
                searchState.pending = false;
                setIsRetrying(side, false);
            }
        },
        restartForNnue: async (side, selection) => {
            if (context.matchRunning) return;

            const engineState = engineStates[side];
            if (!engineState.client) return;

            const searchState = searchStates[side];
            if (searchState.pending) {
                addErrorLog(`再起動中です (${side})`, { side });
                return;
            }

            setIsEngineRestarting(true);
            searchState.pending = true;

            try {
                await reinitializeEngineCore(side, {
                    loadPosition: true,
                    errorLogPrefix: "再起動失敗",
                    nnueSelection: selection,
                });
            } finally {
                searchState.pending = false;
                setIsEngineRestarting(false);
            }
        },
        startAnalysis: async (request) => {
            await startAnalysis(request);
        },
        cancelAnalysis: async () => {
            await cancelAnalysis();
        },
    };

    return {
        getState: () => state,
        subscribe: (listener) => {
            listeners.add(listener);
            listener(state);
            return () => {
                listeners.delete(listener);
            };
        },
        command,
        getClientForSide: (side: Player) => engineStates[side].client,
        getAnalysisClient: () => analysisState.client,
    };
}

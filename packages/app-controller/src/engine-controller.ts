import type { GameResult, NnueSelection, Player, ResolvedNnue } from "@shogi/app-core";
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

type EngineClockState = {
    sente: { mainMs: number; byoyomiMs: number };
    gote: { mainMs: number; byoyomiMs: number };
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

export interface AnalysisRequest {
    sfen: string;
    moves: string[];
    ply: number;
    depth?: number;
    timeMs?: number;
    multiPv?: number;
    engineId?: string;
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
    startTurn: (side: Player) => Promise<void>;
    dispose: (side: Player) => Promise<void>;
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
});

const normalizeThreadCount = (value?: number): number | undefined => {
    if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
    if (value <= 0) return undefined;
    return Math.trunc(value);
};

const getThreadCountForSide = (threads: Record<Player, number>, side: Player) =>
    normalizeThreadCount(threads[side]);

const getAnalysisThreadCount = (threads: Record<Player, number>) => {
    const sente = normalizeThreadCount(threads.sente);
    const gote = normalizeThreadCount(threads.gote);
    if (sente === undefined && gote === undefined) return undefined;
    return Math.max(sente ?? 0, gote ?? 0) || undefined;
};

const applyThreadOption = async (client: EngineClient, threadCount?: number) => {
    if (threadCount === undefined) return;
    try {
        await client.setOption("Threads", threadCount);
    } catch {
        // ignore unsupported Threads option
    }
};

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
    subscription: null,
    handle: null,
    ply: null,
    engineId: null,
});

function buildPassRightsOption(
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

export function createEngineController(
    dependencies: EngineControllerDependencies,
): EngineController {
    const listeners = new Set<(state: EngineControllerState) => void>();
    let state = createInitialState();
    let context = createDefaultContext();
    const engineStates = createInitialEngineStates();
    const searchStates = createInitialSearchStates();
    const analysisState = createInitialAnalysisState();
    const initializing = { sente: false, gote: false } as Record<Player, boolean>;
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

        const unsub = client.subscribe((event) => {
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
                    callbacks.onMoveFromEngine(result.move);
                }

                if (result.action === "end_match" && result.gameResult) {
                    callbacks.onMatchEnd(result.gameResult).catch((error) => {
                        addErrorLog(`match end failed: ${String(error)}`, { side, engineId });
                    });
                }
            }

            if (event.type === "info") {
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

    const disposeEngineForSide = async (side: Player) => {
        const engineState = engineStates[side];
        const searchState = searchStates[side];

        try {
            if (searchState.handle) {
                await searchState.handle.cancel();
            }
        } catch (error) {
            addErrorLog(`検索キャンセルに失敗 (${side}): ${String(error)}`, { side });
        } finally {
            searchState.handle = null;
            searchState.pending = false;
            searchState.requestPly = null;
            activeSearch = null;
        }

        try {
            if (engineState.subscription) {
                engineState.subscription();
            }
        } catch (error) {
            addErrorLog(`サブスクリプション解除に失敗 (${side}): ${String(error)}`, { side });
        } finally {
            engineState.subscription = null;
        }

        try {
            if (engineState.client) {
                // stop()は不要: dispose()内でWorkerをterminateするため。
                // stop()を先に呼ぶとterminateAndRecoverが非同期で再初期化を開始し、
                // 直後のdispose()と競合してWASM_THREADS_INIT_FAILEDを引き起こす。
                if (typeof engineState.client.dispose === "function") {
                    await engineState.client.dispose();
                }
            }
        } catch (error) {
            addErrorLog(`エンジン破棄に失敗 (${side}): ${String(error)}`, { side });
        } finally {
            engineState.client = null;
        }

        engineState.selectedId = null;
        engineState.ready = false;
        setEngineReady(side, false);
        setEngineStatus(side, "idle");
    };

    const reinitializeEngineCore = async (
        side: Player,
        options: {
            loadPosition: boolean;
            errorLogPrefix: string;
            nnueSelection?: NnueSelection;
        },
    ): Promise<boolean> => {
        const engineState = engineStates[side];
        const client = engineState.client;
        if (!client) return false;

        try {
            if ("reset" in client && typeof client.reset === "function") {
                await client.reset();
            }

            setEngineErrorDetails(side, null);
            setEngineStatus(side, "idle");
            engineState.ready = false;

            const threadCount = getThreadCountForSide(context.engineThreads, side);
            await client.init(threadCount ? { threads: threadCount } : undefined);

            const selection =
                options.nnueSelection ??
                (side === "sente" ? context.nnueSelections.sente : context.nnueSelections.gote);
            if (selection && (selection.presetKey || selection.nnueId) && client.loadNnue) {
                const resolved = await dependencies.resolveNnue(selection);
                if (resolved) {
                    await client.loadNnue(resolved.nnueId);
                    await client.setOption("FV_SCALE", resolved.fvScale);
                }
            }

            const skillSettings = context.sides[side].skillLevel;
            if (skillSettings) {
                await applySkillLevelSettings(client, skillSettings);
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
            }

            engineState.ready = true;
            setEngineReady(side, true);
            return true;
        } catch (error) {
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

    const ensureEngineReady = async (
        side: Player,
    ): Promise<{ client: EngineClient; engineId: string } | null> => {
        const setting = context.sides[side];
        if (setting.role !== "engine") return null;
        const selectedId = setting.engineId;
        if (!selectedId) return null;

        if (initializing[side]) return null;
        initializing[side] = true;

        const engineState = engineStates[side];

        try {
            if (engineState.selectedId && engineState.selectedId !== selectedId) {
                await disposeEngineForSide(side);
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
                await client.init(threadCount ? { threads: threadCount } : undefined);

                const selection =
                    side === "sente" ? context.nnueSelections.sente : context.nnueSelections.gote;
                if (selection && (selection.presetKey || selection.nnueId) && client.loadNnue) {
                    const resolved = await dependencies.resolveNnue(selection);
                    if (resolved) {
                        await client.loadNnue(resolved.nnueId);
                        await client.setOption("FV_SCALE", resolved.fvScale);
                    }
                }

                const skillSettings = setting.skillLevel;
                if (skillSettings) {
                    await applySkillLevelSettings(client, skillSettings);
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
                }
                engineState.ready = true;
                setEngineReady(side, true);
            }

            return { client, engineId: selectedId };
        } finally {
            initializing[side] = false;
        }
    };

    const startEngineTurn = async (side: Player) => {
        if (!context.position || !context.position.ready) return;
        if (!context.matchRunning) return;

        const searchState = searchStates[side];
        if (searchState.pending) return;

        const ready = await ensureEngineReady(side);
        if (!ready) return;
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
        }

        setEngineStatus(side, "thinking");
        searchState.pending = true;

        try {
            if (!context.position) return;
            await client.loadPosition(
                context.position.startSfen,
                context.position.moves,
                buildPassRightsOption(context.position.passRightsSettings, context.position.moves),
            );

            if (engineState.client !== client || !context.matchRunning) {
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

            const handle = await client.search({
                limits: { byoyomiMs: effectiveByoyomiMs },
                ponder: false,
            });

            if (engineState.client !== client || !context.matchRunning) {
                await handle.cancel().catch(() => undefined);
                return;
            }

            searchState.handle = handle;
            activeSearch = { side, engineId };
        } finally {
            searchState.pending = false;
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

        void startEngineTurn(side).catch((error) => {
            setEngineStatus(side, "error");
            addErrorLog(`engine error: ${String(error)}`, { side, engineId: selectedId });
        });
    };

    const cancelAnalysis = async () => {
        try {
            if (analysisState.handle) {
                await analysisState.handle.cancel();
            }
        } catch {
            // ignore
        } finally {
            analysisState.handle = null;
            analysisState.ply = null;
            updateState((prev) => ({ ...prev, isAnalyzing: false }));
        }
    };

    const disposeAnalysisEngine = async () => {
        await cancelAnalysis();

        if (analysisState.subscription) {
            analysisState.subscription();
            analysisState.subscription = null;
        }

        if (analysisState.client) {
            try {
                if (typeof analysisState.client.dispose === "function") {
                    await analysisState.client.dispose();
                }
            } catch {
                // ignore
            }
            analysisState.client = null;
            analysisState.engineId = null;
        }
    };

    const startAnalysis = async (request: AnalysisRequest) => {
        if (context.matchRunning && !dependencies.allowAnalysisDuringMatch) {
            addErrorLog("対局中は解析できません");
            return;
        }

        if (state.isAnalyzing) {
            await cancelAnalysis();
        }

        const engineId =
            request.engineId ?? context.sides.sente.engineId ?? context.sides.gote.engineId;
        if (!engineId) {
            addErrorLog("利用可能なエンジンがありません");
            return;
        }

        updateState((prev) => ({ ...prev, isAnalyzing: true }));
        analysisState.ply = request.ply;

        let client = analysisState.client;
        if (!client || analysisState.engineId !== engineId) {
            if (client && analysisState.engineId !== engineId) {
                await disposeAnalysisEngine();
            }
            try {
                client = dependencies.createClient(engineId);
                analysisState.client = client;
                analysisState.engineId = engineId;
                const threadCount = getAnalysisThreadCount(context.engineThreads);
                await client.init(threadCount ? { threads: threadCount } : undefined);

                const selection = context.nnueSelections.analysis;
                if (selection && (selection.presetKey || selection.nnueId) && client.loadNnue) {
                    const resolved = await dependencies.resolveNnue(selection);
                    if (resolved) {
                        await client.loadNnue(resolved.nnueId);
                        await client.setOption("FV_SCALE", resolved.fvScale);
                    }
                }
            } catch (error) {
                addErrorLog(`エンジン初期化エラー: ${String(error)}`);
                analysisState.ply = null;
                updateState((prev) => ({ ...prev, isAnalyzing: false }));
                return;
            }
        }

        const multiPv = request.multiPv ?? 1;
        try {
            await client.setOption("MultiPV", String(multiPv));
        } catch {
            // ignore unsupported MultiPV
        }

        if (analysisState.subscription) {
            analysisState.subscription();
        }

        const unsub = client.subscribe((event) => {
            pushEventLog({
                id: ++logId,
                atMs: now(),
                engineId: analysisState.engineId ?? engineId,
                event,
            });

            if (event.type === "info") {
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
                analysisState.handle = null;
                analysisState.ply = null;
                updateState((prev) => ({ ...prev, isAnalyzing: false }));
            }

            if (event.type === "error") {
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
            addErrorLog(`局面読み込みエラー: ${String(error)}`);
            analysisState.ply = null;
            updateState((prev) => ({ ...prev, isAnalyzing: false }));
            return;
        }

        try {
            const timeMs = request.timeMs ?? DEFAULT_ANALYSIS_TIME_MS;
            const depth = request.depth ?? DEFAULT_ANALYSIS_DEPTH;
            const handle = await client.search({
                limits: {
                    movetimeMs: timeMs,
                    maxDepth: depth,
                },
                ponder: false,
            });

            analysisState.handle = handle;
        } catch (error) {
            addErrorLog(`探索開始エラー: ${String(error)}`);
            analysisState.ply = null;
            updateState((prev) => ({ ...prev, isAnalyzing: false }));
        }
    };

    const applySkillLevels = () => {
        for (const side of ["sente", "gote"] as const) {
            const setting = context.sides[side];
            if (setting.role !== "engine" || !setting.skillLevel) continue;
            const engineState = engineStates[side];
            if (!engineState.client || !engineState.ready) continue;
            const selectedId = setting.engineId;
            if (!selectedId || engineState.selectedId !== selectedId) continue;

            void applySkillLevelSettings(engineState.client, setting.skillLevel).catch((error) => {
                addErrorLog(`Skill Level 設定に失敗 (${side}): ${String(error)}`, {
                    side,
                    engineId: selectedId,
                });
            });
        }
    };

    const applyThreadChange = (
        nextThreads: Record<Player, number>,
        prevThreads: Record<Player, number>,
    ) => {
        let changed = false;
        for (const side of ["sente", "gote"] as const) {
            const prevNormalized = getThreadCountForSide(prevThreads, side);
            const nextNormalized = getThreadCountForSide(nextThreads, side);
            if (prevNormalized === nextNormalized) continue;
            changed = true;
            const engineState = engineStates[side];
            if (!engineState.client) continue;
            if (!engineState.ready) {
                void applyThreadOption(engineState.client, nextNormalized);
                continue;
            }
            void reinitializeEngineCore(side, {
                loadPosition: true,
                errorLogPrefix: "スレッド数変更の再初期化に失敗",
            });
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
            };

            if (
                prevAnalysis?.presetKey !== nextNnueSelections.analysis?.presetKey ||
                prevAnalysis?.nnueId !== nextNnueSelections.analysis?.nnueId
            ) {
                void disposeAnalysisEngine();
            }

            if (
                getThreadCountForSide(prevThreads, "sente") !==
                    getThreadCountForSide(nextThreads, "sente") ||
                getThreadCountForSide(prevThreads, "gote") !==
                    getThreadCountForSide(nextThreads, "gote")
            ) {
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
        startTurn: async (side) => {
            await startEngineTurn(side);
        },
        dispose: async (side) => {
            await disposeEngineForSide(side);
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

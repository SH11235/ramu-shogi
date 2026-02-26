import type {
    AnalysisRequest as ControllerAnalysisRequest,
    EngineController,
    EngineControllerErrorLog,
    EngineControllerEvent,
    EngineControllerState,
    EngineErrorDetails,
    EngineOption,
    EngineStatus,
    PassRightsSettings,
    SideSetting,
} from "@shogi/app-controller";
import { createEngineController } from "@shogi/app-controller";
import type { GameResult, NnueSelection, Player, ResolvedNnue } from "@shogi/app-core";
import type { EngineInfoEvent } from "@shogi/engine-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TickState } from "./useClockManager";

interface UseEngineManagerProps {
    /** 先手/後手の設定 */
    sides: { sente: SideSetting; gote: SideSetting };
    /** エンジンオプション */
    engineOptions: EngineOption[];
    /** 現在の時計状態への参照（リアルタイムの残り時間計算用） */
    clocksRef: { readonly current: TickState };
    /** 開始局面のSFEN */
    startSfen: string;
    /** 棋譜配列 */
    moves: string[];
    /** 現在の手番（エンジンターン開始のトリガー用） */
    positionTurn: Player;
    /** 対局実行中かどうか */
    isMatchRunning: boolean;
    /** 局面が準備完了しているか */
    positionReady: boolean;
    /** パス権設定（オプション） */
    passRightsSettings?: PassRightsSettings;
    /** エンジンからの手を適用するコールバック */
    onMoveFromEngine: (move: string) => void;
    /** 対局終了時のコールバック */
    onMatchEnd: (result: GameResult) => Promise<void>;
    /** 評価値更新時のコールバック */
    onEvalUpdate?: (ply: number, event: EngineInfoEvent) => void;
    /** ログの最大件数 */
    maxLogs?: number;
    /** 対局用 NNUE 選択（先手） */
    senteNnueSelection?: NnueSelection;
    /** 対局用 NNUE 選択（後手） */
    goteNnueSelection?: NnueSelection;
    /** 分析用 NNUE 選択 */
    analysisNnueSelection?: NnueSelection;
    /** NNUE を解決する関数（必要ならダウンロード） */
    resolveNnue: (selection: NnueSelection) => Promise<ResolvedNnue | null>;
    /** 対局中でも解析を許可する（オンライン対戦の AI サポート用） */
    allowAnalysisDuringMatch?: boolean;
    /** 対局用スレッド数（0=自動） */
    engineThreads?: number;
}

/** 解析リクエストパラメータ */
type AnalysisRequest = Omit<ControllerAnalysisRequest, "engineId">;

interface UseEngineManagerReturn {
    /** エンジンの準備状態 */
    engineReady: Record<Player, boolean>;
    /** エンジンのステータス */
    engineStatus: Record<Player, EngineStatus>;
    /** イベントログ */
    eventLogs: EngineControllerEvent[];
    /** エラーログ */
    errorLogs: EngineControllerErrorLog[];
    /** 全エンジンを停止する */
    stopAllEngines: () => Promise<void>;
    /** 指定サイドのエンジンオプションを取得 */
    getEngineForSide: (side: Player) => EngineOption | undefined;
    /** 指定手番がエンジンかどうか */
    isEngineTurn: (turn: Player) => boolean;
    /** エンジンエラーログを追加する（親でバリデーションした結果の通知用） */
    logEngineError: (message: string) => void;
    /** 解析中かどうか */
    isAnalyzing: boolean;
    /** 局面を解析する（対局中でないときのみ利用可能） */
    analyzePosition: (request: AnalysisRequest) => Promise<void>;
    /** 解析をキャンセルする */
    cancelAnalysis: () => Promise<void>;
    /** エンジンエラーの詳細情報 */
    engineErrorDetails: Record<Player, EngineErrorDetails | null>;
    /** エンジンをリトライする */
    retryEngine: (side: Player) => Promise<void>;
    /** リトライ中かどうか */
    isRetrying: Record<Player, boolean>;
    /** NNUE切替によるエンジン再起動中かどうか */
    isEngineRestarting: boolean;
    /** 指定サイドのエンジンを破棄する */
    disposeEngine: (side: Player) => Promise<void>;
    /** NNUE変更に伴いエンジンを再起動する */
    restartEngineForNnue: (side: Player, selection?: NnueSelection) => Promise<void>;
}

export function useEngineManager({
    sides,
    engineOptions,
    clocksRef,
    startSfen,
    moves,
    positionTurn,
    isMatchRunning,
    positionReady,
    passRightsSettings,
    onMoveFromEngine,
    onMatchEnd,
    onEvalUpdate,
    maxLogs = 80,
    senteNnueSelection,
    goteNnueSelection,
    analysisNnueSelection,
    resolveNnue,
    allowAnalysisDuringMatch,
    engineThreads,
}: UseEngineManagerProps): UseEngineManagerReturn {
    const engineOptionsRef = useRef(engineOptions);
    useEffect(() => {
        engineOptionsRef.current = engineOptions;
    }, [engineOptions]);

    const callbacksRef = useRef({ onMoveFromEngine, onMatchEnd, onEvalUpdate });
    useEffect(() => {
        callbacksRef.current = { onMoveFromEngine, onMatchEnd, onEvalUpdate };
    }, [onMoveFromEngine, onMatchEnd, onEvalUpdate]);

    const resolveNnueRef = useRef(resolveNnue);
    useEffect(() => {
        resolveNnueRef.current = resolveNnue;
    }, [resolveNnue]);

    const controllerRef = useRef<EngineController | null>(null);
    if (!controllerRef.current) {
        controllerRef.current = createEngineController({
            createClient: (engineId) => {
                const option =
                    engineOptionsRef.current.find((opt) => opt.id === engineId) ??
                    engineOptionsRef.current[0];
                if (!option) {
                    throw new Error(`Engine option not found: ${engineId}`);
                }
                return option.createClient();
            },
            getClockState: () => clocksRef.current,
            now: () => Date.now(),
            resolveNnue: (selection) => resolveNnueRef.current(selection),
            maxLogs,
            allowAnalysisDuringMatch,
            callbacks: {
                onMoveFromEngine: (move) => callbacksRef.current.onMoveFromEngine(move),
                onMatchEnd: (result) => callbacksRef.current.onMatchEnd(result),
                onEvalUpdate: (ply, event) => callbacksRef.current.onEvalUpdate?.(ply, event),
            },
        });
    }

    const controller = controllerRef.current;

    const [controllerState, setControllerState] = useState<EngineControllerState>(() =>
        controller.getState(),
    );

    useEffect(() => {
        const unsubscribe = controller.subscribe(setControllerState);
        return () => {
            unsubscribe();
        };
    }, [controller]);

    const defaultEngineId = engineOptions[0]?.id;
    const resolvedSides = useMemo(
        () => ({
            sente:
                sides.sente.role === "engine"
                    ? { ...sides.sente, engineId: sides.sente.engineId ?? defaultEngineId }
                    : { role: "human" as const },
            gote:
                sides.gote.role === "engine"
                    ? { ...sides.gote, engineId: sides.gote.engineId ?? defaultEngineId }
                    : { role: "human" as const },
        }),
        [defaultEngineId, sides],
    );

    // NOTE: create a snapshot for syncContext
    const movesSnapshot = useMemo(() => moves, [moves]);

    useEffect(() => {
        controller.command.syncContext({
            sides: resolvedSides,
            nnueSelections: {
                sente: senteNnueSelection,
                gote: goteNnueSelection,
                analysis: analysisNnueSelection,
            },
            position: {
                startSfen,
                moves: movesSnapshot,
                turn: positionTurn,
                ready: positionReady,
                passRightsSettings,
            },
            matchRunning: isMatchRunning,
            engineThreads,
        });
    }, [
        analysisNnueSelection,
        controller,
        goteNnueSelection,
        isMatchRunning,
        movesSnapshot,
        passRightsSettings,
        positionReady,
        positionTurn,
        resolvedSides,
        senteNnueSelection,
        startSfen,
        engineThreads,
    ]);

    useEffect(() => {
        return () => {
            void controller.command.dispose("sente");
            void controller.command.dispose("gote");
            void controller.command.cancelAnalysis();
        };
    }, [controller]);

    const engineMap = useMemo(() => {
        const map = new Map<string, EngineOption>();
        for (const opt of engineOptions) {
            map.set(opt.id, opt);
        }
        return map;
    }, [engineOptions]);

    const getEngineForSide = useCallback(
        (side: Player): EngineOption | undefined => {
            const setting = resolvedSides[side];
            if (setting.role !== "engine") return undefined;
            const selectedId = setting.engineId;
            if (!selectedId) return undefined;
            return engineMap.get(selectedId);
        },
        [engineMap, resolvedSides],
    );

    const isEngineTurn = useCallback(
        (turn: Player): boolean => {
            return sides[turn].role === "engine";
        },
        [sides],
    );

    const stopAllEngines = useCallback(async () => {
        await Promise.all([
            controller.command.dispose("sente"),
            controller.command.dispose("gote"),
        ]);
    }, [controller]);

    const resolveAnalysisEngineId = useCallback(() => {
        if (resolvedSides.sente.role === "engine" && resolvedSides.sente.engineId) {
            return resolvedSides.sente.engineId;
        }
        if (resolvedSides.gote.role === "engine" && resolvedSides.gote.engineId) {
            return resolvedSides.gote.engineId;
        }
        return engineOptions[0]?.id;
    }, [engineOptions, resolvedSides]);

    const analyzePosition = useCallback(
        async (request: AnalysisRequest) => {
            const engineId = resolveAnalysisEngineId();
            await controller.command.startAnalysis({
                ...request,
                engineId,
            });
        },
        [controller, resolveAnalysisEngineId],
    );

    return {
        engineReady: controllerState.engineReady,
        engineStatus: controllerState.engineStatus,
        eventLogs: controllerState.eventLogs,
        errorLogs: controllerState.errorLogs,
        stopAllEngines,
        getEngineForSide,
        isEngineTurn,
        logEngineError: (message: string) => controller.command.logError(message),
        isAnalyzing: controllerState.isAnalyzing,
        analyzePosition,
        cancelAnalysis: controller.command.cancelAnalysis,
        engineErrorDetails: controllerState.engineErrorDetails,
        retryEngine: controller.command.retry,
        isRetrying: controllerState.isRetrying,
        isEngineRestarting: controllerState.isEngineRestarting,
        disposeEngine: controller.command.dispose,
        restartEngineForNnue: controller.command.restartForNnue,
    };
}

import type { NnueSelection } from "@shogi/app-core";
import { detectParallelism } from "@shogi/app-core";
import type { EngineInfoEvent } from "@shogi/engine-client";
import type { EngineOption, EngineThreadSettings, PassRightsSettings } from "../types";
import { resolveBatchWorkerCount } from "../utils/threadOptions";
import { useBatchAnalysis } from "./useBatchAnalysis";
import { useEnginePool } from "./useEnginePool";
import type { UseKifuNavigationResult } from "./useKifuNavigation";
import { usePlayHintSearch } from "./usePlayHintSearch";

type BatchAnalysisOptions = Parameters<typeof useBatchAnalysis>[0];

interface UseMatchAnalysisOptions extends Omit<BatchAnalysisOptions, "enginePool" | "kifuTree"> {
    engineOptions: EngineOption[];
    analysisEngineId: string;
    analysisNnueId: string | null;
    analysisNnueSelection: NnueSelection;
    moves: string[];
    navigation: UseKifuNavigationResult;
    cancelAnalysis: () => Promise<void>;
    /** エンジンの制御から評価値を渡すための参照。毎回のレンダーで、いまの処理を入れる。 */
    handleEvalUpdateRef: { current: (ply: number, event: EngineInfoEvent) => void };
    isPlayScreen: boolean;
    engineThreads: EngineThreadSettings;
    hintMultiPv: number;
    passRightsSettings: PassRightsSettings | undefined;
    isMatchRunning: boolean;
    isPaused: boolean;
}

/**
 * 解析のエンジン（一括解析のエンジンプール・1 局面の解析）と、対局画面のヒントの探索をつなぐ。
 */
export function useMatchAnalysis({
    engineOptions,
    analysisEngineId,
    analysisSettings,
    analysisNnueId,
    analysisNnueSelection,
    resolveNnue,
    batchAnalysis,
    setBatchAnalysis,
    kifMoves,
    startSfen,
    moves,
    navigation,
    recordEvalByPly,
    recordEvalByNodeId,
    clearEvalByPly,
    clearEvalByNodeId,
    analyzePosition,
    isAnalyzing,
    cancelAnalysis,
    openNnueManager,
    setMessage,
    handleEvalUpdateRef,
    isPlayScreen,
    engineThreads,
    hintMultiPv,
    passRightsSettings,
    isMatchRunning,
    isPaused,
}: UseMatchAnalysisOptions): ReturnType<typeof useBatchAnalysis> & {
    playHint: ReturnType<typeof usePlayHintSearch>;
} {
    // 並列一括解析用のエンジンプール
    const analysisEngineOption =
        engineOptions.find((option) => option.id === analysisEngineId) ?? engineOptions[0];
    const enginePool = useEnginePool({
        createClient:
            analysisEngineOption?.batch?.createClient ??
            analysisEngineOption?.createClient ??
            (() => {
                throw new Error("No engine available");
            }),
        clientKey: analysisEngineOption?.id,
        // 外部の USI エンジンは、変則ルールのパスを解釈できない。
        supportsPassRights: analysisEngineOption?.kind !== "external",
        materialFallback: analysisEngineOption?.kind !== "external",
        workerCount: resolveBatchWorkerCount(
            analysisSettings.parallelWorkers,
            analysisEngineOption?.batch?.maxParallel,
            analysisEngineOption?.maxParallel,
        ),
        releaseWorkersAfterRun: analysisEngineOption?.batch !== undefined,
        onProgress: (progress) => {
            setBatchAnalysis({
                isRunning: true,
                currentIndex: progress.completed,
                totalCount: progress.total,
                targetPlies: [], // 進捗表示用には不要
                inProgress: progress.inProgress,
            });
        },
        onResult: (ply, event, nodeId) => {
            // nodeIdがある場合は分岐解析の結果
            if (nodeId) {
                recordEvalByNodeId(nodeId, event);
            } else {
                recordEvalByPly(ply, event);
            }
        },
        onComplete: () => {
            setBatchAnalysis(null);
        },
        onError: (ply, error) => {
            if (analysisEngineOption?.batch) {
                setMessage({ text: String(error.cause ?? error.message), type: "error" });
            }
            console.error(`解析エラー (ply=${ply}):`, error);
        },
        nnueId: analysisNnueId,
    });

    const batch = useBatchAnalysis({
        kifMoves,
        startSfen,
        analysisSettings,
        enginePool,
        resolveNnue,
        analysisNnueSelection,
        recordEvalByPly,
        recordEvalByNodeId,
        clearEvalByPly,
        clearEvalByNodeId,
        analyzePosition,
        isAnalyzing,
        kifuTree: navigation.tree,
        openNnueManager,
        setMessage,
        batchAnalysis,
        setBatchAnalysis,
    });

    // handleEvalUpdate を ref に設定（useEngineManager で使用）
    handleEvalUpdateRef.current = batch.handleEvalUpdate;

    // 対局画面のヒント。解析のスレッド数は、対局の先後のうち多いほう（解析エンジンと同じ決め方）。
    const resolveThreads = (count: number) =>
        count > 0 ? count : detectParallelism().recommendedWorkers;
    const playHint = usePlayHintSearch({
        enabled: isPlayScreen,
        engineOption:
            engineOptions.find((option) => option.id === analysisEngineId) ?? engineOptions[0],
        threads: Math.max(resolveThreads(engineThreads.sente), resolveThreads(engineThreads.gote)),
        multiPv: hintMultiPv,
        nnueSelection: analysisNnueSelection,
        resolveNnue,
        startSfen,
        moves: moves.slice(0, navigation.state.currentPly),
        currentPly: navigation.state.currentPly,
        passRightsSettings,
        matchActive: isMatchRunning && !isPaused,
        recordEvalByPly,
        clearEvalByPly,
        fallback: { analyze: batch.handleAnalyzeHintPly, cancel: cancelAnalysis, isAnalyzing },
    });

    return { ...batch, playHint };
}

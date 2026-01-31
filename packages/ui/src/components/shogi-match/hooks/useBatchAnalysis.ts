import type { KifuTree, NnueSelection, ResolvedNnue } from "@shogi/app-core";
import { getPathToNode } from "@shogi/app-core";
import type { EngineInfoEvent } from "@shogi/engine-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnalysisSettings, AnalyzingState } from "../types";
import { ANALYZING_STATE_NONE } from "../types";
import { collectBranchAnalysisJobs, collectTreeAnalysisJobs } from "../utils/branchTreeUtils";
import type { KifMove } from "../utils/kifFormat";
import type { AnalysisJob, EnginePoolHandle } from "./useEnginePool";

/**
 * 一括解析の状態
 */
interface BatchAnalysisState {
    isRunning: boolean;
    currentIndex: number;
    totalCount: number;
    targetPlies: number[];
    inProgress?: number[];
}

/**
 * useBatchAnalysis の props
 */
interface UseBatchAnalysisProps {
    /** 棋譜データ */
    kifMoves: KifMove[];
    /** 開始局面のSFEN */
    startSfen: string;
    /** 解析設定 */
    analysisSettings: AnalysisSettings;
    /** エンジンプールハンドル */
    enginePool: EnginePoolHandle;
    /** NNUE解決関数 */
    resolveNnue: (selection: NnueSelection) => Promise<ResolvedNnue | null>;
    /** 解析用NNUE選択 */
    analysisNnueSelection: NnueSelection;
    /** 評価値をplyで記録する関数 */
    recordEvalByPly: (ply: number, event: EngineInfoEvent) => void;
    /** 評価値をnodeIdで記録する関数 */
    recordEvalByNodeId: (nodeId: string, event: EngineInfoEvent) => void;
    /** plyの評価値をクリアする関数 */
    clearEvalByPly: (ply: number) => void;
    /** nodeIdの評価値をクリアする関数 */
    clearEvalByNodeId: (nodeId: string) => void;
    /** 単発解析関数 */
    analyzePosition: (params: {
        sfen: string;
        moves: string[];
        ply: number;
        timeMs: number;
        depth: number;
    }) => Promise<void>;
    /** 解析中フラグ */
    isAnalyzing: boolean;
    /** 棋譜ツリー */
    kifuTree: KifuTree | null;
    /** NNUEマネージャーを開く */
    openNnueManager: (reason: string) => void;
    /** メッセージを設定する */
    setMessage: (msg: { text: string; type: "warning" | "error" } | null) => void;
    /** 一括解析状態（useEnginePoolから更新される） */
    batchAnalysis: BatchAnalysisState | null;
    /** 一括解析状態を設定する */
    setBatchAnalysis: React.Dispatch<React.SetStateAction<BatchAnalysisState | null>>;
}

/**
 * useBatchAnalysis の返り値
 */
interface UseBatchAnalysisReturn {
    /** 解析状態 */
    analyzingState: AnalyzingState;
    /** 評価値更新コールバック（エンジンマネージャー用） */
    handleEvalUpdate: (ply: number, event: EngineInfoEvent) => void;
    /** 特定の手数の局面を解析する */
    handleAnalyzePly: (ply: number) => Promise<void>;
    /** 分岐内のノードを解析する */
    handleAnalyzeNode: (nodeId: string) => Promise<void>;
    /** 一括解析を開始する（本譜のみ） */
    handleStartBatchAnalysis: () => Promise<void>;
    /** ツリー全体の一括解析を開始する */
    handleStartTreeBatchAnalysis: (options?: { mainLineOnly?: boolean }) => Promise<void>;
    /** 特定の分岐を一括解析する */
    handleAnalyzeBranch: (branchNodeId: string) => Promise<void>;
    /** 一括解析をキャンセルする */
    handleCancelBatchAnalysis: () => void;
}

/**
 * 一括解析を管理するカスタムフック
 *
 * 解析状態の管理と解析操作を提供します。
 * - 単発解析（handleAnalyzePly, handleAnalyzeNode）
 * - 一括解析（handleStartBatchAnalysis, handleStartTreeBatchAnalysis, handleAnalyzeBranch）
 * - 解析キャンセル（handleCancelBatchAnalysis）
 *
 * @param props - フックの設定
 * @returns 解析状態と操作関数
 */
export function useBatchAnalysis({
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
    kifuTree,
    openNnueManager,
    setMessage,
    batchAnalysis: _batchAnalysis, // 現在は未使用（将来の拡張用に保持）
    setBatchAnalysis,
}: UseBatchAnalysisProps): UseBatchAnalysisReturn {
    // 解析状態（union型で相互排他的な状態を型レベルで保証）
    const [analyzingState, setAnalyzingState] = useState<AnalyzingState>(ANALYZING_STATE_NONE);

    // 分岐解析用の状態をrefで追跡（コールバック内で最新値を参照するため）
    const analyzingStateRef = useRef<AnalyzingState>(ANALYZING_STATE_NONE);
    useEffect(() => {
        analyzingStateRef.current = analyzingState;
    }, [analyzingState]);

    // 評価値更新コールバック（分岐解析にも対応）
    const handleEvalUpdate = useCallback(
        (ply: number, event: EngineInfoEvent) => {
            const state = analyzingStateRef.current;
            // 分岐解析中の場合はノードIDで保存
            if (state.type === "by-node-id") {
                recordEvalByNodeId(state.nodeId, event);
            } else {
                // 通常解析の場合はplyで保存
                recordEvalByPly(ply, event);
            }
        },
        [recordEvalByPly, recordEvalByNodeId],
    );

    // 特定の手数の局面を解析するコールバック（オンデマンド解析用）
    const handleAnalyzePly = useCallback(
        async (ply: number) => {
            // NNUE の存在確認（未ダウンロードの場合はエラー）
            try {
                await resolveNnue(analysisNnueSelection);
            } catch (e) {
                const errorMessage =
                    e instanceof Error ? e.message : "評価関数の準備に失敗しました";
                openNnueManager(`解析を開始できません: ${errorMessage}`);
                return;
            }

            // ply手目の局面を解析するには、ply-1手までの指し手が必要
            // （ply 1 = 1手目を指した後の局面 = moves[0]まで適用した局面）
            const movesForPly = kifMoves.slice(0, ply).map((m) => m.usiMove);

            // 再解析のために既存の評価値をクリア
            clearEvalByPly(ply);

            setAnalyzingState({ type: "by-ply", ply });
            try {
                await analyzePosition({
                    sfen: startSfen,
                    moves: movesForPly,
                    ply,
                    timeMs: 3000, // 3秒間解析
                    depth: 20, // 最大深さ20
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                setAnalyzingState({ type: "error", ply, message: errorMessage });
            }
        },
        [
            kifMoves,
            analyzePosition,
            startSfen,
            clearEvalByPly,
            resolveNnue,
            analysisNnueSelection,
            openNnueManager,
        ],
    );

    // 分岐内のノードを解析するコールバック
    const handleAnalyzeNode = useCallback(
        async (nodeId: string) => {
            const tree = kifuTree;
            if (!tree) {
                setMessage({ text: "棋譜ツリーが初期化されていません", type: "error" });
                return;
            }

            const node = tree.nodes.get(nodeId);
            if (!node) {
                setMessage({ text: "指定されたノードが見つかりません", type: "error" });
                return;
            }

            // 再解析のために既存の評価値をクリア
            clearEvalByNodeId(nodeId);

            try {
                // ルートからこのノードまでのパスを取得
                const path = getPathToNode(tree, nodeId);
                // 各ノードのusiMoveを収集（ルートは除く）
                const movesForNode: string[] = [];
                for (const id of path) {
                    const n = tree.nodes.get(id);
                    if (n?.usiMove) {
                        movesForNode.push(n.usiMove);
                    }
                }

                // 分岐解析用に状態を設定
                setAnalyzingState({ type: "by-node-id", nodeId, ply: node.ply });
                await analyzePosition({
                    sfen: startSfen,
                    moves: movesForNode,
                    ply: node.ply,
                    timeMs: 3000,
                    depth: 20,
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                setAnalyzingState({ type: "error", ply: node.ply, message: errorMessage });
            }
        },
        [kifuTree, analyzePosition, startSfen, clearEvalByNodeId, setMessage],
    );

    // 単発解析完了時の処理（エラー状態は自動クリアしない）
    useEffect(() => {
        if (!isAnalyzing && analyzingState.type !== "none" && analyzingState.type !== "error") {
            setAnalyzingState(ANALYZING_STATE_NONE);
        }
    }, [isAnalyzing, analyzingState.type]);

    // 一括解析を開始（並列処理）- 本譜のみ
    const handleStartBatchAnalysis = useCallback(async () => {
        // PVがない手を抽出
        const targetPlies = kifMoves.filter((m) => !m.pv || m.pv.length === 0).map((m) => m.ply);

        if (targetPlies.length === 0) {
            return; // 解析対象がない
        }

        // NNUE の存在確認（未ダウンロードの場合はエラー）
        let resolved: ResolvedNnue | null;
        try {
            resolved = await resolveNnue(analysisNnueSelection);
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : "評価関数の準備に失敗しました";
            openNnueManager(`解析を開始できません: ${errorMessage}`);
            return;
        }

        // ジョブを生成
        const jobs: AnalysisJob[] = targetPlies.map((ply) => ({
            ply,
            sfen: startSfen,
            moves: kifMoves.slice(0, ply).map((m) => m.usiMove),
            timeMs: analysisSettings.batchAnalysisTimeMs,
            depth: analysisSettings.batchAnalysisDepth,
        }));

        // 並列一括解析を開始（resolvedを直接渡す）
        enginePool.start(jobs, { nnueId: resolved?.nnueId ?? null, fvScale: resolved?.fvScale });
    }, [
        kifMoves,
        startSfen,
        analysisSettings,
        enginePool,
        resolveNnue,
        analysisNnueSelection,
        openNnueManager,
    ]);

    // ツリー全体（分岐含む）の一括解析を開始
    const handleStartTreeBatchAnalysis = useCallback(
        async (options?: { mainLineOnly?: boolean }) => {
            const tree = kifuTree;
            if (!tree) return;

            // ツリーから解析ジョブを収集
            const treeJobs = collectTreeAnalysisJobs(tree, {
                onlyWithoutEval: true,
                mainLineOnly: options?.mainLineOnly ?? false,
            });

            if (treeJobs.length === 0) {
                setMessage({ text: "解析対象の手がありません", type: "warning" });
                setTimeout(() => setMessage(null), 3000);
                return;
            }

            // NNUE の存在確認（未ダウンロードの場合はエラー）
            let resolved: ResolvedNnue | null;
            try {
                resolved = await resolveNnue(analysisNnueSelection);
            } catch (e) {
                const errorMessage =
                    e instanceof Error ? e.message : "評価関数の準備に失敗しました";
                openNnueManager(`解析を開始できません: ${errorMessage}`);
                return;
            }

            // AnalysisJob形式に変換
            const jobs: AnalysisJob[] = treeJobs.map((job) => ({
                ply: job.ply,
                sfen: startSfen,
                moves: job.moves,
                timeMs: analysisSettings.batchAnalysisTimeMs,
                depth: analysisSettings.batchAnalysisDepth,
                nodeId: job.nodeId, // 分岐解析用にnodeIdを保持
            }));

            // 並列一括解析を開始（resolvedを直接渡す）
            enginePool.start(jobs, {
                nnueId: resolved?.nnueId ?? null,
                fvScale: resolved?.fvScale,
            });
        },
        [
            kifuTree,
            startSfen,
            analysisSettings,
            enginePool,
            resolveNnue,
            analysisNnueSelection,
            openNnueManager,
            setMessage,
        ],
    );

    // 特定の分岐を一括解析
    const handleAnalyzeBranch = useCallback(
        async (branchNodeId: string) => {
            const tree = kifuTree;
            if (!tree) return;

            // 分岐から解析ジョブを収集
            const branchJobs = collectBranchAnalysisJobs(tree, branchNodeId, {
                onlyWithoutEval: true,
            });

            if (branchJobs.length === 0) {
                return;
            }

            // NNUE の存在確認（未ダウンロードの場合はエラー）
            let resolved: ResolvedNnue | null;
            try {
                resolved = await resolveNnue(analysisNnueSelection);
            } catch (e) {
                const errorMessage =
                    e instanceof Error ? e.message : "評価関数の準備に失敗しました";
                openNnueManager(`解析を開始できません: ${errorMessage}`);
                return;
            }

            // AnalysisJob形式に変換
            const jobs: AnalysisJob[] = branchJobs.map((job) => ({
                ply: job.ply,
                sfen: startSfen,
                moves: job.moves,
                timeMs: analysisSettings.batchAnalysisTimeMs,
                depth: analysisSettings.batchAnalysisDepth,
                nodeId: job.nodeId,
            }));

            // 並列一括解析を開始（resolvedを直接渡す）
            enginePool.start(jobs, {
                nnueId: resolved?.nnueId ?? null,
                fvScale: resolved?.fvScale,
            });
        },
        [
            kifuTree,
            startSfen,
            analysisSettings,
            enginePool,
            resolveNnue,
            analysisNnueSelection,
            openNnueManager,
        ],
    );

    // 一括解析をキャンセル
    const handleCancelBatchAnalysis = useCallback(() => {
        void enginePool.cancel();
        setBatchAnalysis(null);
    }, [enginePool, setBatchAnalysis]);

    return {
        analyzingState,
        handleEvalUpdate,
        handleAnalyzePly,
        handleAnalyzeNode,
        handleStartBatchAnalysis,
        handleStartTreeBatchAnalysis,
        handleAnalyzeBranch,
        handleCancelBatchAnalysis,
    };
}

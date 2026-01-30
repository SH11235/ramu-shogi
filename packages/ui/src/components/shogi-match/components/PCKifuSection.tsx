/**
 * PC版棋譜セクション
 *
 * 評価値グラフパネルと棋譜パネルを含む右側のセクション
 */

import type {
    KifuTree,
    NnueMeta,
    NnueSelection,
    PositionState,
    PresetConfig,
} from "@shogi/app-core";
import type { ReactElement } from "react";
import type { AnalysisSettings, AnalyzingState, DisplaySettings } from "../types";
import type { EvalHistory, KifMove } from "../utils/kifFormat";
import { EvalPanel } from "./EvalPanel";
import { KifuPanel, type KifuViewMode } from "./KifuPanel";

/** ナビゲーション状態 */
interface NavigationState {
    currentPly: number;
    totalPly: number;
    isRewound: boolean;
    canGoForward: boolean;
    hasBranches: boolean;
    currentBranchIndex: number;
    branchCount: number;
    isOnMainLine: boolean;
}

/** ナビゲーションハンドラ */
interface NavigationHandlers {
    goBack: () => void;
    goForward: (branchNodeId?: string) => void;
    goToStart: () => void;
    goToEnd: () => void;
    switchBranch: (index: number) => void;
    promoteCurrentLine: () => void;
    goToNodeById: (nodeId: string) => void;
    switchBranchAtNode: (parentNodeId: string, branchIndex: number) => void;
}

/** バッチ解析状態 */
export interface BatchAnalysisState {
    isRunning: boolean;
    currentIndex: number;
    totalCount: number;
    inProgress?: number[];
}

export interface PCKifuSectionProps {
    // 評価値グラフ
    displayEvalHistory: EvalHistory[];

    // ナビゲーション状態とハンドラ
    navigationState: NavigationState;
    navigationHandlers: NavigationHandlers;
    selectedBranchNodeId: string | null;
    onSelectedBranchChange: (branchNodeId: string | null) => void;

    // 棋譜パネル基本
    kifMoves: KifMove[];
    displaySettings: DisplaySettings;
    onDisplaySettingsChange: (updater: (prev: DisplaySettings) => DisplaySettings) => void;
    handlePlySelect: (ply: number) => void;
    handleCopyKif: () => string;
    isMatchRunning: boolean;

    // 分岐関連
    branchMarkers: Map<number, number>;
    positionHistory: PositionState[];
    handleAddPvAsBranch: (ply: number, pv: string[]) => void;
    handlePreviewPv: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;
    lastAddedBranchInfo: { ply: number; firstMove: string } | null;
    onLastAddedBranchHandled: () => void;
    onViewModeChange: (mode: KifuViewMode) => void;
    kifuTree?: KifuTree;

    // 解析関連
    handleAnalyzePly: (ply: number) => void;
    isAnalyzing: boolean;
    analyzingState: AnalyzingState;
    batchAnalysis: BatchAnalysisState | null;
    handleStartBatchAnalysis: () => void;
    handleCancelBatchAnalysis: () => void;
    analysisSettings: AnalysisSettings;
    onAnalysisSettingsChange: (settings: AnalysisSettings) => void;
    handleAnalyzeNode: (nodeId: string) => void;
    handleAnalyzeBranch: (branchNodeId: string) => void;
    handleStartTreeBatchAnalysis: (options?: { mainLineOnly?: boolean }) => void;

    // NNUE関連
    analysisNnueSelection: NnueSelection;
    onAnalysisNnueSelectionChange: (selection: NnueSelection) => void;
    nnueList: NnueMeta[];
    isNnueListLoading: boolean;
    presetConfigs: PresetConfig[];

    // 手の詳細
    handleMoveDetailSelect: (move: KifMove | null, position: PositionState | null) => void;
}

export function PCKifuSection({
    // 評価値グラフ
    displayEvalHistory,

    // ナビゲーション
    navigationState,
    navigationHandlers,
    selectedBranchNodeId,
    onSelectedBranchChange,

    // 棋譜パネル基本
    kifMoves,
    displaySettings,
    onDisplaySettingsChange,
    handlePlySelect,
    handleCopyKif,
    isMatchRunning,

    // 分岐関連
    branchMarkers,
    positionHistory,
    handleAddPvAsBranch,
    handlePreviewPv,
    lastAddedBranchInfo,
    onLastAddedBranchHandled,
    onViewModeChange,
    kifuTree,

    // 解析関連
    handleAnalyzePly,
    isAnalyzing,
    analyzingState,
    batchAnalysis,
    handleStartBatchAnalysis,
    handleCancelBatchAnalysis,
    analysisSettings,
    onAnalysisSettingsChange,
    handleAnalyzeNode,
    handleAnalyzeBranch,
    handleStartTreeBatchAnalysis,

    // NNUE関連
    analysisNnueSelection,
    onAnalysisNnueSelectionChange,
    nnueList,
    isNnueListLoading,
    presetConfigs,

    // 手の詳細
    handleMoveDetailSelect,
}: PCKifuSectionProps): ReactElement {
    return (
        <div className="flex flex-col gap-2 shrink-0 pt-16">
            {/* 評価値グラフパネル（折りたたみ） */}
            <EvalPanel
                evalHistory={displayEvalHistory}
                currentPly={navigationState.currentPly}
                onPlySelect={handlePlySelect}
                defaultOpen={false}
            />

            {/* 棋譜パネル + ドロワー（横並び） */}
            <div className="relative flex items-start">
                {/* 棋譜パネル（常時表示） */}
                <KifuPanel
                    kifMoves={kifMoves}
                    currentPly={navigationState.currentPly}
                    showEval={displaySettings.showKifuEval}
                    onShowEvalChange={(show) =>
                        onDisplaySettingsChange((prev) => ({
                            ...prev,
                            showKifuEval: show,
                        }))
                    }
                    onPlySelect={handlePlySelect}
                    onCopyKif={handleCopyKif}
                    navigation={{
                        currentPly: navigationState.currentPly,
                        totalPly: navigationState.totalPly,
                        onBack: navigationHandlers.goBack,
                        onForward: () =>
                            navigationHandlers.goForward(selectedBranchNodeId ?? undefined),
                        onToStart: navigationHandlers.goToStart,
                        onToEnd: navigationHandlers.goToEnd,
                        isRewound: navigationState.isRewound,
                        canGoForward: navigationState.canGoForward,
                        branchInfo: navigationState.hasBranches
                            ? {
                                  hasBranches: true,
                                  currentIndex: navigationState.currentBranchIndex,
                                  count: navigationState.branchCount,
                                  onSwitch: navigationHandlers.switchBranch,
                                  onPromoteToMain: navigationHandlers.promoteCurrentLine,
                              }
                            : undefined,
                    }}
                    navigationDisabled={isMatchRunning}
                    branchMarkers={branchMarkers}
                    positionHistory={positionHistory}
                    onAddPvAsBranch={handleAddPvAsBranch}
                    onPreviewPv={handlePreviewPv}
                    lastAddedBranchInfo={lastAddedBranchInfo}
                    onLastAddedBranchHandled={onLastAddedBranchHandled}
                    onSelectedBranchChange={onSelectedBranchChange}
                    onViewModeChange={onViewModeChange}
                    onAnalyzePly={handleAnalyzePly}
                    isAnalyzing={isAnalyzing}
                    analyzingPly={
                        analyzingState.type !== "none" && analyzingState.type !== "error"
                            ? analyzingState.ply
                            : undefined
                    }
                    analysisError={
                        analyzingState.type === "error"
                            ? {
                                  ply: analyzingState.ply ?? 0,
                                  message: analyzingState.message ?? "",
                              }
                            : undefined
                    }
                    batchAnalysis={
                        batchAnalysis
                            ? {
                                  isRunning: batchAnalysis.isRunning,
                                  currentIndex: batchAnalysis.currentIndex,
                                  totalCount: batchAnalysis.totalCount,
                                  inProgress: batchAnalysis.inProgress,
                              }
                            : undefined
                    }
                    onStartBatchAnalysis={handleStartBatchAnalysis}
                    onCancelBatchAnalysis={handleCancelBatchAnalysis}
                    analysisSettings={analysisSettings}
                    onAnalysisSettingsChange={onAnalysisSettingsChange}
                    analysisNnueSelection={analysisNnueSelection}
                    onAnalysisNnueSelectionChange={onAnalysisNnueSelectionChange}
                    nnueList={nnueList}
                    isNnueListLoading={isNnueListLoading}
                    presets={presetConfigs}
                    kifuTree={kifuTree}
                    onNodeClick={navigationHandlers.goToNodeById}
                    onBranchSwitch={navigationHandlers.switchBranchAtNode}
                    onAnalyzeNode={handleAnalyzeNode}
                    onAnalyzeBranch={handleAnalyzeBranch}
                    onStartTreeBatchAnalysis={handleStartTreeBatchAnalysis}
                    isOnMainLine={navigationState.isOnMainLine}
                    onMoveDetailSelect={handleMoveDetailSelect}
                />
            </div>
        </div>
    );
}

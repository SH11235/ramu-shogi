/**
 * PC版棋譜セクション
 *
 * 評価値グラフパネルと棋譜パネルを含む右側のセクション
 * ナビゲーション関連は NavigationContext から取得
 * 分析関連は AnalysisContext から取得
 */

import type { ReactElement } from "react";
import { useAnalysis, useNavigation } from "../contexts";
import { EvalPanel } from "./EvalPanel";
import { KifuPanel } from "./KifuPanel";

export function PCKifuSection(): ReactElement {
    // 分析関連は Context から取得
    const {
        analysisSettings,
        onAnalysisSettingsChange,
        analysisNnueSelection,
        onAnalysisNnueSelectionChange,
        nnueList,
        isNnueListLoading,
        presetConfigs,
        isAnalyzing,
        analyzingState,
        batchAnalysis,
        handleAnalyzePly,
        handleStartBatchAnalysis,
        handleCancelBatchAnalysis,
        handleAnalyzeNode,
        handleAnalyzeBranch,
        handleStartTreeBatchAnalysis,
    } = useAnalysis();
    // ナビゲーション関連は Context から取得
    const {
        navigationState,
        navigationHandlers,
        kifMoves,
        displayEvalHistory,
        positionHistory,
        kifuTree,
        selectedBranchNodeId,
        onSelectedBranchChange,
        branchMarkers,
        lastAddedBranchInfo,
        onLastAddedBranchHandled,
        handleAddPvAsBranch,
        handlePreviewPv,
        onViewModeChange,
        displaySettings,
        onDisplaySettingsChange,
        handlePlySelect,
        handleCopyKif,
        handleMoveDetailSelect,
        isMatchRunning,
    } = useNavigation();

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

/**
 * PC版棋譜セクション
 *
 * タブ式レイアウト:
 * - 棋譜タブ: 評価値グラフ + 棋譜パネル
 * - AI解析タブ: 現在局面のAIヒント + 一括解析設定
 *
 * ナビゲーション関連は NavigationContext から取得
 * 分析関連は AnalysisContext から取得
 */

import { resolveWorkerCount } from "@shogi/app-core";
import type { ReactElement } from "react";
import { useState } from "react";
import { useAnalysis } from "../contexts/AnalysisContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { ANALYSIS_TIME_OPTIONS, PARALLEL_WORKER_OPTIONS } from "../utils/threadOptions";
import { CurrentPositionAiHintPanel } from "./CurrentPositionAiHintPanel";
import { EvalPanel } from "./EvalPanel";
import { KifuPanel } from "./KifuPanel";
import { TabHeader } from "./TabHeader";

export function PCKifuSection(): ReactElement {
    const [activeTab, setActiveTab] = useState<"kifu" | "ai">("kifu");
    const { gameMode } = useMatchState();
    const { evalGraphPinned, viewerMode } = useShogiMatchConfig();
    // 棋譜を見るだけの画面（ビューア）は、解析も変化の追加もさせない（研究ノートで行う）。
    const readOnly = viewerMode;
    // いま対局している間（一時停止を含む）。この間だけ、評価値グラフを既定で閉じておく。
    const isInMatch = gameMode === "playing" || gameMode === "paused";

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
        analysisMarkers,
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
        <div
            // 左の設定パネルと上端を揃える（盤の上の時計の分だけ下げる、ということはしない）。
            className="flex flex-col shrink-0 w-[var(--panel-width)]"
        >
            {!readOnly && (
                <TabHeader
                    className="mb-2"
                    tabs={[
                        { id: "kifu", label: "棋譜" },
                        { id: "ai", label: "AI解析" },
                    ]}
                    activeTab={activeTab}
                    onChange={setActiveTab}
                />
            )}

            {/* 棋譜タブ */}
            <div className={`flex flex-col gap-2 ${activeTab !== "kifu" ? "hidden" : ""}`}>
                {/* 評価値グラフパネル。
                    対局中はチート防止のため既定で閉じ、それ以外（対局前・検討・観戦）は
                    既定で開く。開閉は利用者が自由に切り替えられる (EvalPanel 内 state)。
                    対局の始まり・終わりで key を変えて、その状態の既定に戻す
                    （検討中に開いていたグラフを、対局へ持ち込まない）。
                    棋譜ビューアなど evalGraphPinned の画面は、常に開いたままにする。 */}
                <EvalPanel
                    key={isInMatch ? "match" : "analysis"}
                    evalHistory={displayEvalHistory}
                    currentPly={navigationState.currentPly}
                    onPlySelect={handlePlySelect}
                    initialOpen={!isInMatch}
                    collapsible={!evalGraphPinned}
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
                        analysisMarkers={analysisMarkers}
                        positionHistory={positionHistory}
                        onAddPvAsBranch={readOnly ? undefined : handleAddPvAsBranch}
                        onPreviewPv={handlePreviewPv}
                        lastAddedBranchInfo={lastAddedBranchInfo}
                        onLastAddedBranchHandled={onLastAddedBranchHandled}
                        onSelectedBranchChange={onSelectedBranchChange}
                        onViewModeChange={onViewModeChange}
                        onAnalyzePly={readOnly ? undefined : handleAnalyzePly}
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
                        onStartBatchAnalysis={readOnly ? undefined : handleStartBatchAnalysis}
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
                        onAnalyzeNode={readOnly ? undefined : handleAnalyzeNode}
                        onAnalyzeBranch={readOnly ? undefined : handleAnalyzeBranch}
                        onStartTreeBatchAnalysis={
                            readOnly ? undefined : handleStartTreeBatchAnalysis
                        }
                        isOnMainLine={navigationState.isOnMainLine}
                        onMoveDetailSelect={handleMoveDetailSelect}
                    />
                </div>
            </div>

            {/* AI解析タブ（棋譜を見るだけの画面では描かない） */}
            {!readOnly && (
                <div className={`flex flex-col gap-3 ${activeTab !== "ai" ? "hidden" : ""}`}>
                    {/* 現在局面のAIヒント（playing/reviewing 両モードで利用可能） */}
                    <CurrentPositionAiHintPanel title="AI解析" />

                    {/* 一括解析設定 */}
                    <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                        <span className="text-xs font-semibold text-muted-foreground">
                            一括解析設定
                        </span>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">並列数</span>
                            <div className="flex gap-1 flex-wrap">
                                {PARALLEL_WORKER_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() =>
                                            onAnalysisSettingsChange({
                                                ...analysisSettings,
                                                parallelWorkers: opt.value,
                                            })
                                        }
                                        className={`px-2 py-1 rounded text-xs transition-colors ${
                                            analysisSettings.parallelWorkers === opt.value
                                                ? "bg-wafuu-kincha text-white"
                                                : "bg-wafuu-washi text-wafuu-sumi hover:bg-wafuu-border"
                                        }`}
                                    >
                                        {opt.value === 0
                                            ? `自動(${resolveWorkerCount(0)})`
                                            : opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">解析時間</span>
                            <div className="flex gap-1 flex-wrap">
                                {ANALYSIS_TIME_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() =>
                                            onAnalysisSettingsChange({
                                                ...analysisSettings,
                                                batchAnalysisTimeMs: opt.value,
                                            })
                                        }
                                        className={`px-2 py-1 rounded text-xs transition-colors ${
                                            analysisSettings.batchAnalysisTimeMs === opt.value
                                                ? "bg-wafuu-kincha text-white"
                                                : "bg-wafuu-washi text-wafuu-sumi hover:bg-wafuu-border"
                                        }`}
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

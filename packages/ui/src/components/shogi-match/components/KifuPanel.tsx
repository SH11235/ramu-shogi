/**
 * KIF形式棋譜表示パネル
 *
 * 棋譜をKIF形式（日本語表記）で表示し、評価値も合わせて表示する
 */

import type {
    KifuTree,
    NnueMeta,
    NnueSelection,
    PositionState,
    PresetConfig,
} from "@shogi/app-core";
import type { ReactElement } from "react";
import { useState } from "react";
import { Card } from "../../card";
import { TooltipProvider } from "../../tooltip";
import { useKifuListScroll } from "../hooks/useKifuListScroll";
import type { KifuViewMode } from "../hooks/useKifuViewState";
import { useKifuViewState } from "../hooks/useKifuViewState";
import type { AnalysisSettings } from "../types";
import type { BranchSummary } from "../utils/branchTreeUtils";
import { getAllBranches, getBranchesByPly, getBranchMoves } from "../utils/branchTreeUtils";
import type { KifMove } from "../utils/kifFormat";
import { BatchAnalysisDropdown } from "./BatchAnalysisDropdown";
import { BatchAnalysisProgressBanner } from "./BatchAnalysisProgressBanner";
import { EvalHintBanner } from "./EvalHintBanner";
import { ExpandedMoveDetails } from "./ExpandedMoveDetails";
import { InlineBranchList } from "./InlineBranchList";
import { KifCopyButton } from "./KifCopyButton";
import { KifuBranchListView, KifuSelectedBranchView } from "./KifuBranchViews";
import { KifuEvalToggle } from "./KifuEvalToggle";
import { KifuMoveRow } from "./KifuMoveRow";
import { KifuNavigationToolbar } from "./KifuNavigationToolbar";
import { KifuViewModeTabs } from "./KifuViewModeTabs";

export type { KifuViewMode };

/**
 * 評価値データが存在するかチェック
 */
function hasEvalData(kifMoves: KifMove[]): boolean {
    return kifMoves.some((m) => m.evalCp !== undefined || m.evalMate !== undefined);
}

interface BranchInfo {
    hasBranches: boolean;
    currentIndex: number;
    count: number;
    onSwitch: (index: number) => void;
    onPromoteToMain?: () => void;
}

interface NavigationProps {
    /** 現在の手数 */
    currentPly: number;
    /** 最大手数（メインライン） */
    totalPly: number;
    /** 1手戻る */
    onBack: () => void;
    /** 1手進む */
    onForward: () => void;
    /** 最初へ */
    onToStart: () => void;
    /** 最後へ */
    onToEnd: () => void;
    /** 巻き戻し中か */
    isRewound?: boolean;
    /** 分岐情報 */
    branchInfo?: BranchInfo;
    /** 進む操作が可能か（現在ノードに子がある） */
    canGoForward?: boolean;
}

interface KifuPanelProps {
    /** KIF形式の指し手リスト */
    kifMoves: KifMove[];
    /** 現在の手数（ハイライト用） */
    currentPly: number;
    /** 手数クリック時のコールバック（局面ジャンプ用） */
    onPlySelect?: (ply: number) => void;
    /** 評価値を表示するか */
    showEval?: boolean;
    /** 評価値表示の切り替えコールバック */
    onShowEvalChange?: (show: boolean) => void;
    /** KIF形式でコピーするときのコールバック（KIF文字列を返す） */
    onCopyKif?: () => string;
    /** ナビゲーション機能（提供された場合はツールバーを表示） */
    navigation?: NavigationProps;
    /** ナビゲーション無効化（対局中など） */
    navigationDisabled?: boolean;
    /** 分岐マーカー（ply -> 分岐数） */
    branchMarkers?: Map<number, number>;
    /** AI 解析使用マーカー（対局後の検討室で表示） */
    analysisMarkers?: Array<{ seat: "b" | "w"; ply: number }>;
    /** 局面履歴（各手が指された後の局面、PV表示用） */
    positionHistory?: PositionState[];
    /** PVを分岐として追加するコールバック */
    onAddPvAsBranch?: (ply: number, pv: string[]) => void;
    /** PVを盤面で確認するコールバック */
    onPreviewPv?: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;
    /** 指定手数の局面を解析するコールバック（オンデマンド解析用） */
    onAnalyzePly?: (ply: number) => void;
    /** 解析中かどうか */
    isAnalyzing?: boolean;
    /** 現在解析中の手数 */
    analyzingPly?: number;
    /** 解析エラー（発生した手数とメッセージ） */
    analysisError?: { ply: number; message: string };
    /** 一括解析の状態 */
    batchAnalysis?: {
        isRunning: boolean;
        currentIndex: number;
        totalCount: number;
        inProgress?: number[]; // 並列解析中の手番号
    };
    /** 一括解析を開始するコールバック（本譜のみ） */
    onStartBatchAnalysis?: () => void;
    /** ツリー全体の一括解析を開始するコールバック */
    onStartTreeBatchAnalysis?: (options?: { mainLineOnly?: boolean }) => void;
    /** 一括解析をキャンセルするコールバック */
    onCancelBatchAnalysis?: () => void;
    /** 解析設定 */
    analysisSettings?: AnalysisSettings;
    /** 解析設定変更コールバック */
    onAnalysisSettingsChange?: (settings: AnalysisSettings) => void;
    /** 分析用 NNUE 選択 */
    analysisNnueSelection?: NnueSelection;
    onAnalysisNnueSelectionChange?: (selection: NnueSelection) => void;
    /** ダウンロード済み NNUE 一覧 */
    nnueList?: NnueMeta[];
    /** NNUE 一覧読み込み中フラグ */
    isNnueListLoading?: boolean;
    /** プリセット一覧（未ダウンロードも含む） */
    presets?: PresetConfig[];
    /** 棋譜ツリー（ツリービュー用） */
    kifuTree?: KifuTree;
    /** ノードクリック時のコールバック（ツリービュー用） */
    onNodeClick?: (nodeId: string) => void;
    /** 分岐切り替え時のコールバック（ツリービュー用） */
    onBranchSwitch?: (parentNodeId: string, branchIndex: number) => void;
    /** 分岐内のノードを解析するコールバック */
    onAnalyzeNode?: (nodeId: string) => void;
    /** 分岐全体を一括解析するコールバック */
    onAnalyzeBranch?: (branchNodeId: string) => void;
    /** 追加のクラス名（高さ調整用） */
    className?: string;
    /** 最後に追加された分岐の情報（この分岐に直接遷移する） */
    lastAddedBranchInfo?: { ply: number; firstMove: string } | null;
    /** lastAddedBranchInfoを処理したことを通知するコールバック */
    onLastAddedBranchHandled?: () => void;
    /** 選択中の分岐が変更されたときのコールバック（キーボードナビゲーション用） */
    onSelectedBranchChange?: (branchNodeId: string | null) => void;
    /** ビューモード変更時のコールバック（評価値グラフ切り替え用） */
    onViewModeChange?: (mode: KifuViewMode) => void;
    /** 現在位置がメインライン上にあるか（PV分岐追加の制御用） */
    isOnMainLine?: boolean;
    /** 手の詳細を選択したときのコールバック（右パネル表示用） */
    onMoveDetailSelect?: (move: KifMove | null, position: PositionState | null) => void;
}

export function KifuPanel({
    kifMoves,
    currentPly,
    onPlySelect,
    showEval = true,
    onShowEvalChange,
    onCopyKif,
    navigation,
    navigationDisabled = false,
    branchMarkers,
    positionHistory,
    onAddPvAsBranch,
    onPreviewPv,
    onAnalyzePly,
    isAnalyzing,
    analyzingPly,
    analysisError,
    batchAnalysis,
    onStartBatchAnalysis,
    onStartTreeBatchAnalysis,
    onCancelBatchAnalysis,
    analysisSettings,
    onAnalysisSettingsChange,
    analysisNnueSelection,
    onAnalysisNnueSelectionChange,
    nnueList,
    isNnueListLoading,
    presets,
    kifuTree,
    onNodeClick,
    onBranchSwitch: _onBranchSwitch,
    onAnalyzeNode,
    onAnalyzeBranch,
    lastAddedBranchInfo,
    onLastAddedBranchHandled,
    onSelectedBranchChange,
    onViewModeChange,
    isOnMainLine = true,
    onMoveDetailSelect,
    analysisMarkers,
}: KifuPanelProps): ReactElement {
    // _onBranchSwitch: 将来的に分岐切り替え機能で使用予定
    const [hintDismissed, setHintDismissed] = useState(false);

    // analysisMarkers を ply → Set<seat> に変換（棋譜行でのルックアップ用）
    const analysisMarkersByPly = (() => {
        const map = new Map<number, Set<"b" | "w">>();
        for (const marker of analysisMarkers ?? []) {
            const seats = map.get(marker.ply) ?? new Set<"b" | "w">();
            seats.add(marker.seat);
            map.set(marker.ply, seats);
        }
        return map;
    })();

    const branches: BranchSummary[] = kifuTree ? getAllBranches(kifuTree) : [];
    const hasBranches = branches.length > 0;

    // 手数ごとの分岐をグルーピング（インライン表示用）
    const branchesByPlyMap = kifuTree
        ? getBranchesByPly(kifuTree)
        : new Map<number, BranchSummary[]>();

    const { viewMode, selectedBranch, changeViewMode, selectBranch } = useKifuViewState({
        kifuTree,
        branches,
        lastAddedBranchInfo,
        onLastAddedBranchHandled,
        onSelectedBranchChange,
        onViewModeChange,
    });
    const { listRef, currentRowRef } = useKifuListScroll({
        viewMode,
        currentPly,
        moveCount: kifMoves.length,
    });

    const [expandState, setExpandState] = useState({
        expandedPlies: new Set<number>(),
        expandedMoveDetail: null as number | null,
    });
    const { expandedPlies, expandedMoveDetail } = expandState;

    const togglePlyExpansion = (ply: number) => {
        setExpandState((prev) => {
            const next = new Set(prev.expandedPlies);
            if (next.has(ply)) {
                next.delete(ply);
            } else {
                next.add(ply);
            }
            return { ...prev, expandedPlies: next };
        });
    };

    const toggleMoveDetailExpansion = (ply: number) => {
        setExpandState((prev) => ({
            ...prev,
            expandedMoveDetail: prev.expandedMoveDetail === ply ? null : ply,
        }));
    };

    // インライン分岐はその手へ移ってから、選択した分岐のビューに切り替える
    const handleInlineBranchClick = (branch: BranchSummary) => {
        onNodeClick?.(branch.nodeId);
        selectBranch(branch);
    };

    const evalDataExists = hasEvalData(kifMoves);
    const movesWithoutPv = kifMoves.filter((m) => !m.pv || m.pv.length === 0).length;
    const showHintBanner = !showEval && evalDataExists && !hintDismissed && onShowEvalChange;

    return (
        <TooltipProvider delayDuration={300}>
            <Card elevation="floating" className="w-[var(--panel-width)] p-3">
                <div className="font-bold mb-1.5 flex justify-between items-center gap-2">
                    <div className="flex items-center gap-2">
                        <span>棋譜</span>
                        <span className="text-[13px] text-muted-foreground">
                            {kifMoves.length === 0 ? "開始局面" : `${kifMoves.length}手`}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        {onShowEvalChange && (
                            <KifuEvalToggle
                                showEval={showEval}
                                evalDataExists={evalDataExists}
                                onShowEvalChange={onShowEvalChange}
                            />
                        )}
                        {/* 一括解析ボタン（ドロップダウン） - 常に表示してレイアウトシフトを防止 */}
                        {onStartBatchAnalysis && analysisSettings && onAnalysisSettingsChange && (
                            <BatchAnalysisDropdown
                                movesWithoutPv={movesWithoutPv}
                                analysisSettings={analysisSettings}
                                onAnalysisSettingsChange={onAnalysisSettingsChange}
                                onStartBatchAnalysis={onStartBatchAnalysis}
                                onStartTreeBatchAnalysis={onStartTreeBatchAnalysis}
                                hasBranches={
                                    kifuTree
                                        ? Array.from(kifuTree.nodes.values()).some(
                                              (n) => n.children.length > 1,
                                          )
                                        : false
                                }
                                isRunning={batchAnalysis?.isRunning ?? false}
                                analysisNnueSelection={analysisNnueSelection}
                                onAnalysisNnueSelectionChange={onAnalysisNnueSelectionChange}
                                nnueList={nnueList}
                                isNnueListLoading={isNnueListLoading}
                                presets={presets}
                            />
                        )}
                        {onCopyKif && kifMoves.length > 0 && <KifCopyButton getKif={onCopyKif} />}
                    </div>
                </div>

                {navigation && (
                    <KifuNavigationToolbar
                        currentPly={navigation.currentPly}
                        totalPly={navigation.totalPly}
                        onBack={navigation.onBack}
                        onForward={navigation.onForward}
                        onToStart={navigation.onToStart}
                        onToEnd={navigation.onToEnd}
                        disabled={navigationDisabled}
                        branchInfo={navigation.branchInfo}
                        isRewound={navigation.isRewound}
                        canGoForward={navigation.canGoForward}
                        className="mb-2"
                    />
                )}

                {hasBranches && (
                    <KifuViewModeTabs
                        viewMode={viewMode}
                        branchCount={branches.length}
                        selectedBranch={selectedBranch}
                        onChange={changeViewMode}
                        className="mb-1"
                    />
                )}

                {batchAnalysis?.isRunning && (
                    <BatchAnalysisProgressBanner
                        currentIndex={batchAnalysis.currentIndex}
                        totalCount={batchAnalysis.totalCount}
                        inProgress={batchAnalysis.inProgress}
                        onCancel={onCancelBatchAnalysis}
                        className="mb-2"
                    />
                )}

                {showHintBanner && (
                    <EvalHintBanner
                        onEnable={() => onShowEvalChange(true)}
                        onDismiss={() => setHintDismissed(true)}
                        className="mb-2"
                    />
                )}

                {analysisError && (
                    <div className="mx-1 my-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm">
                        <span className="font-medium">{analysisError.ply}手目の解析エラー:</span>{" "}
                        {analysisError.message}
                    </div>
                )}

                {viewMode === "branches" && (
                    <KifuBranchListView
                        branches={branches}
                        selectedNodeId={selectedBranch?.nodeId}
                        onSelectBranch={selectBranch}
                        className="my-2"
                    />
                )}

                {viewMode === "selectedBranch" && selectedBranch && (
                    <KifuSelectedBranchView
                        branchNodeId={selectedBranch.nodeId}
                        moves={kifuTree ? getBranchMoves(kifuTree, selectedBranch.nodeId) : []}
                        showEval={showEval}
                        analyzingPly={analyzingPly}
                        onNodeClick={onNodeClick}
                        onAnalyzeNode={onAnalyzeNode}
                        onAnalyzeBranch={onAnalyzeBranch}
                        className="my-2"
                    />
                )}

                {/* 本譜ビュー（メインライン） */}
                {viewMode === "main" && (
                    <div
                        ref={listRef}
                        className="max-h-[var(--kifu-panel-max-h,70vh)] overflow-auto [scrollbar-gutter:stable] my-2"
                    >
                        {kifMoves.length === 0 ? (
                            <div className="text-[13px] text-muted-foreground text-center py-4">
                                まだ指し手がありません
                            </div>
                        ) : (
                            kifMoves.map((move, index) => {
                                const isCurrent = move.ply === currentPly;
                                const hasBranch = branchMarkers?.has(move.ply);
                                const branchesAtPly = branchesByPlyMap.get(move.ply) ?? [];
                                const isBranchesExpanded = expandedPlies.has(move.ply);
                                // この手が指された後の局面
                                const position = positionHistory?.[index];
                                const hasMultiPv =
                                    move.multiPvEvals?.some((pv) => pv?.pv && pv.pv.length > 0) ??
                                    false;
                                const hasPv = (move.pv && move.pv.length > 0) || hasMultiPv;
                                const canExpand = Boolean(position && (hasPv || onAnalyzePly));
                                // 外部のウィンドウに出すときは、開閉の状態を行で持たない
                                const isDetailExpanded =
                                    !onMoveDetailSelect && expandedMoveDetail === move.ply;

                                // 読み筋・解析の詳細を開く（行の右端の ▾）。その局面へも移る。
                                const handleDetailToggle = () => {
                                    if (!canExpand || !position) return;
                                    onPlySelect?.(move.ply);
                                    if (onMoveDetailSelect) {
                                        // 外部のウィンドウに出す。閉じるのはウィンドウ側で行う。
                                        onMoveDetailSelect(move, position);
                                        return;
                                    }
                                    toggleMoveDetailExpansion(move.ply);
                                };

                                return (
                                    <div key={move.ply}>
                                        <KifuMoveRow
                                            move={move}
                                            isCurrent={isCurrent}
                                            isPastCurrent={
                                                navigation?.isRewound && move.ply > currentPly
                                            }
                                            showEval={showEval}
                                            hasBranch={hasBranch}
                                            branchCount={branchMarkers?.get(move.ply)}
                                            isBranchesExpanded={isBranchesExpanded}
                                            analysisSeats={analysisMarkersByPly.get(move.ply)}
                                            canExpand={canExpand}
                                            isDetailExpanded={isDetailExpanded}
                                            detailInWindow={!!onMoveDetailSelect}
                                            rowRef={isCurrent ? currentRowRef : undefined}
                                            // 行を押したら、その局面へ移るだけ（読み筋は開かない）
                                            onSelect={() => onPlySelect?.(move.ply)}
                                            onToggleBranches={() => togglePlyExpansion(move.ply)}
                                            onToggleDetail={handleDetailToggle}
                                        />
                                        {isDetailExpanded && position && (
                                            <div>
                                                <ExpandedMoveDetails
                                                    move={move}
                                                    position={position}
                                                    onAddBranch={onAddPvAsBranch}
                                                    onPreview={onPreviewPv}
                                                    onAnalyze={onAnalyzePly}
                                                    isAnalyzing={isAnalyzing}
                                                    analyzingPly={analyzingPly}
                                                    kifuTree={kifuTree}
                                                    analysisNnueSelection={analysisNnueSelection}
                                                    onAnalysisNnueSelectionChange={
                                                        onAnalysisNnueSelectionChange
                                                    }
                                                    nnueList={nnueList}
                                                    isNnueListLoading={isNnueListLoading}
                                                    presets={presets}
                                                    onCollapse={() =>
                                                        setExpandState((prev) => ({
                                                            ...prev,
                                                            expandedMoveDetail: null,
                                                        }))
                                                    }
                                                    isOnMainLine={isOnMainLine}
                                                    className="mt-1 mx-1"
                                                />
                                            </div>
                                        )}
                                        {hasBranch &&
                                            isBranchesExpanded &&
                                            branchesAtPly.length > 0 && (
                                                <InlineBranchList
                                                    branches={branchesAtPly}
                                                    onBranchClick={handleInlineBranchClick}
                                                    onAnalyzeBranch={onAnalyzeBranch}
                                                    className="ml-6 my-0.5"
                                                />
                                            )}
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}
            </Card>
        </TooltipProvider>
    );
}

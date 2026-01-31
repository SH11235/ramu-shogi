/**
 * ShogiMatchLayout
 *
 * レイアウト・ダイアログの統括コンポーネント
 * - 共通ダイアログ（DragGhost, EngineRestartingOverlay等）
 * - Mobile/PC のProvider階層と条件分岐
 * - Aboutボタン
 */

import type {
    EngineControllerErrorLog,
    EngineControllerEvent,
    KifuTree,
    NnueSelection,
    Player,
    PositionState,
} from "@shogi/app-core";
import type { Dispatch, ReactElement, RefObject, SetStateAction } from "react";
import { AboutDialog } from "../../AboutDialog";
import { EngineRestartingOverlay } from "../../nnue/EngineRestartingOverlay";
import { NnueManagerDialog } from "../../nnue/NnueManagerDialog";
import type { EngineErrorDetails } from "../components/EngineLogsPanel";
import { GameResultDialog } from "../components/GameResultDialog";
import type { KifuViewMode } from "../components/KifuPanel";
import { MoveDetailWindow } from "../components/MoveDetailWindow";
import type { PassDisabledReason } from "../components/PassButton";
import { PvPreviewDialog } from "../components/PvPreviewDialog";
import {
    AnalysisProvider,
    MatchSettingsProvider,
    MatchStateProvider,
    NavigationProvider,
} from "../contexts";
import type {
    BatchAnalysisState,
    HandInfo,
    NavigationHandlers,
    NavigationState,
} from "../contexts/types";
import { type DndController, DragGhost } from "../dnd";
import type { AnalysisSettings, AnalyzingState, DisplaySettings } from "../types";
import type { BoardStateProps, MatchSettingsProps } from "../types/layoutProps";
import type { EvalHistory, KifMove } from "../utils/kifFormat";
import type { KifMoveData } from "../utils/kifParser";
import { MobileLayout } from "./MobileLayout";
import { PCLayout } from "./PCLayout";

interface ShogiMatchLayoutProps {
    // Props グループ
    matchSettings: MatchSettingsProps;
    boardState: BoardStateProps;
    // デバイス
    isMobile: boolean;

    // DnD
    dndController: DndController;
    isEditMode: boolean;

    // エンジン再起動
    isEngineRestarting: boolean;

    // ダイアログ状態
    gameResult: import("@shogi/app-core").GameResult | null;
    showResultDialog: boolean;
    setShowResultDialog: (show: boolean) => void;
    pvPreview: {
        open: boolean;
        ply: number;
        pv: string[];
        startPosition: PositionState;
        evalCp?: number;
        evalMate?: number;
    } | null;
    setPvPreview: (
        state: {
            open: boolean;
            ply: number;
            pv: string[];
            startPosition: PositionState;
            evalCp?: number;
            evalMate?: number;
        } | null,
    ) => void;
    isNnueManagerOpen: boolean;
    openNnueManager: () => void;
    closeNnueManager: () => void;
    nnueManagerOpenReason: "missing-sente" | "missing-gote" | "missing-analysis" | null;
    clearNnueManagerOpenReason: () => void;
    manifestUrl?: string;
    onRequestNnueFilePath?: () => Promise<string | null>;
    isMatchRunning: boolean;
    isPaused: boolean;
    selectedMoveDetail: { move: KifMove; position: PositionState } | null;
    setSelectedMoveDetailPly: (state: { ply: number; position: PositionState } | null) => void;
    isAboutOpen: boolean;
    setIsAboutOpen: (open: boolean) => void;

    // 分析
    analysisSettings: AnalysisSettings;
    setAnalysisSettings: (settings: AnalysisSettings) => void;
    analysisNnueSelection: NnueSelection;
    setAnalysisNnueSelection: (selection: NnueSelection) => void;
    isNnueListLoading: boolean;
    presetConfigs: import("@shogi/app-core").PresetConfig[];
    isAnalyzing: boolean;
    analyzingState: AnalyzingState;
    batchAnalysis: BatchAnalysisState | null;
    handleAnalyzePly: (ply: number) => void;
    handleStartBatchAnalysis: () => void;
    handleCancelBatchAnalysis: () => void;
    handleAnalyzeNode: (nodeId: string) => void;
    handleAnalyzeBranch: (branchNodeId: string) => void;
    handleStartTreeBatchAnalysis: (options?: { mainLineOnly?: boolean }) => void;

    // 局面状態（一部）
    hideEmptyHandPieces: boolean;
    getHandInfo: (pos: "top" | "bottom") => HandInfo;
    handleSquareSelect: (sq: string, shiftKey?: boolean) => Promise<void>;
    handlePromotionChoice: (promote: boolean) => void;
    handleHandSelect: (piece: import("@shogi/app-core").PieceType) => void;
    handleHandPiecePointerDown: (
        owner: Player,
        pieceType: import("@shogi/app-core").PieceType,
        e: React.PointerEvent,
    ) => void;
    handlePiecePointerDown: (
        square: string,
        piece: import("../../shogi-board").ShogiBoardPiece,
        e: React.PointerEvent,
    ) => void;
    handlePieceTogglePromote: (
        square: string,
        piece: import("../../shogi-board").ShogiBoardPiece,
        event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
    handleIncrementHand: (owner: Player, piece: import("@shogi/app-core").PieceType) => void;
    handleDecrementHand: (owner: Player, piece: import("@shogi/app-core").PieceType) => void;
    handleResetToStartpos: () => void;
    pauseAutoPlay: () => void;
    resumeAutoPlay: () => void;
    handleStartReview: () => void;
    handleEnterEditMode: () => void;
    enterEditModeFromPaused: () => void;
    handleResign: () => void;
    handleUndo: () => void;
    setIsSettingsModalOpen: (open: boolean) => void;
    shouldRenderPassButton: boolean;
    canMakePassMove: boolean;
    passButtonDisabledReason?: PassDisabledReason;
    handlePassMove: () => void;
    shouldShowPassConfirm: boolean;
    isDraggingPiece: boolean;
    boardSectionRef: RefObject<HTMLDivElement | null>;

    // ナビゲーション
    navigationState: NavigationState;
    navigationHandlers: NavigationHandlers;
    kifMoves: KifMove[];
    evalHistory: EvalHistory[];
    displayEvalHistory: EvalHistory[];
    positionHistory: PositionState[];
    kifuTree?: KifuTree;
    selectedBranchNodeId: string | null;
    setSelectedBranchNodeId: (id: string | null) => void;
    branchMarkers: Map<number, number>;
    lastAddedBranchInfo: { ply: number; firstMove: string } | null;
    setLastAddedBranchInfo: (info: { ply: number; firstMove: string } | null) => void;
    handleAddPvAsBranch: (ply: number, pv: string[]) => void;
    handlePreviewPv: (ply: number, pv: string[], evalCp?: number, evalMate?: number) => void;
    kifuViewMode: KifuViewMode;
    setKifuViewMode: (mode: KifuViewMode) => void;
    setDisplaySettings: Dispatch<SetStateAction<DisplaySettings>>;
    handlePlySelect: (ply: number) => void;
    handleCopyKif: () => string;
    handleMoveDetailSelect: (move: KifMove | null, position: PositionState | null) => void;

    // PC専用
    matchLayoutClasses: string;
    candidateNote: string | null;
    isSettingsModalOpen: boolean;
    importSfen: (sfen: string, moves: string[]) => Promise<void>;
    importKif: (moves: string[], moveData: KifMoveData[], startSfen?: string) => Promise<void>;
    positionReady: boolean;
    isDevMode: boolean;
    eventLogs: EngineControllerEvent[];
    errorLogs: EngineControllerErrorLog[];
    engineErrorDetails?: Record<Player, EngineErrorDetails | null>;
    retryEngine: (side: Player) => Promise<void>;
    isRetrying?: Record<Player, boolean>;
    isDisplaySettingsOpen: boolean;
    onDisplaySettingsOpenChange: (open: boolean) => void;
    isPassRightsSettingsOpen: boolean;
    onPassRightsSettingsOpenChange: (open: boolean) => void;

    // Mobile専用
    isReviewMode: boolean;
    onOpenAbout: () => void;
    onImportSfen: (sfen: string, moves: string[]) => Promise<void>;
    onImportKif: (moves: string[], moveData: KifMoveData[], startSfen?: string) => Promise<void>;
    onDisplaySettingsChange: (settings: DisplaySettings) => void;
}

/**
 * レイアウト・ダイアログの統括コンポーネント
 */
export function ShogiMatchLayout({
    // グループ化されたprops
    matchSettings,
    boardState,
    // 個別props
    isMobile,
    dndController,
    isEditMode,
    isEngineRestarting,
    gameResult,
    showResultDialog,
    setShowResultDialog,
    pvPreview,
    setPvPreview,
    isNnueManagerOpen,
    openNnueManager,
    closeNnueManager,
    nnueManagerOpenReason,
    clearNnueManagerOpenReason,
    manifestUrl,
    onRequestNnueFilePath,
    isMatchRunning,
    isPaused,
    selectedMoveDetail,
    setSelectedMoveDetailPly,
    isAboutOpen,
    setIsAboutOpen,
    analysisSettings,
    setAnalysisSettings,
    analysisNnueSelection,
    setAnalysisNnueSelection,
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
    hideEmptyHandPieces,
    getHandInfo,
    handleSquareSelect,
    handlePromotionChoice,
    handleHandSelect,
    handleHandPiecePointerDown,
    handlePiecePointerDown,
    handlePieceTogglePromote,
    handleIncrementHand,
    handleDecrementHand,
    handleResetToStartpos,
    pauseAutoPlay,
    resumeAutoPlay,
    handleStartReview,
    handleEnterEditMode,
    enterEditModeFromPaused,
    handleResign,
    handleUndo,
    setIsSettingsModalOpen,
    shouldRenderPassButton,
    canMakePassMove,
    passButtonDisabledReason,
    handlePassMove,
    shouldShowPassConfirm,
    isDraggingPiece,
    boardSectionRef,
    navigationState,
    navigationHandlers,
    kifMoves,
    evalHistory,
    displayEvalHistory,
    positionHistory,
    kifuTree,
    selectedBranchNodeId,
    setSelectedBranchNodeId,
    branchMarkers,
    lastAddedBranchInfo,
    setLastAddedBranchInfo,
    handleAddPvAsBranch,
    handlePreviewPv,
    kifuViewMode,
    setKifuViewMode,
    setDisplaySettings,
    handlePlySelect,
    handleCopyKif,
    handleMoveDetailSelect,
    matchLayoutClasses,
    candidateNote,
    isSettingsModalOpen,
    importSfen,
    importKif,
    positionReady,
    isDevMode,
    eventLogs,
    errorLogs,
    engineErrorDetails,
    retryEngine,
    isRetrying,
    isDisplaySettingsOpen,
    onDisplaySettingsOpenChange,
    isPassRightsSettingsOpen,
    onPassRightsSettingsOpenChange,
    isReviewMode,
    onOpenAbout,
    onImportSfen,
    onImportKif,
    onDisplaySettingsChange,
}: ShogiMatchLayoutProps): ReactElement {
    // グループ化されたpropsを展開
    const {
        sides,
        handleSidesChange,
        timeSettings,
        setTimeSettings,
        passRightsSettings,
        handlePassRightsSettingsChange,
        settingsLocked,
        senteNnueSelection,
        handleSenteNnueSelectionChange,
        goteNnueSelection,
        handleGoteNnueSelectionChange,
        nnueList,
        presets,
        internalEngineId,
        setIsDisplaySettingsOpen,
        setIsPassRightsSettingsOpen,
    } = matchSettings;

    const {
        position,
        clocks,
        grid,
        gameMode,
        message,
        selection,
        promotionSelection,
        lastMove,
        moves,
        editFromSquare,
        flipBoard,
        displaySettings,
        onFlipBoardChange,
    } = boardState;

    return (
        <>
            {/* DnD ゴースト */}
            <DragGhost
                ref={dndController.ghostRef as React.RefObject<HTMLDivElement>}
                dndState={dndController.state}
                ownerOrientation={flipBoard ? "gote" : "sente"}
            />

            <EngineRestartingOverlay visible={isEngineRestarting} />

            {/* 勝敗表示ダイアログ */}
            <GameResultDialog
                result={gameResult}
                open={showResultDialog}
                onClose={() => setShowResultDialog(false)}
            />

            {/* PVプレビューダイアログ */}
            {pvPreview && (
                <PvPreviewDialog
                    open={pvPreview.open}
                    onClose={() => setPvPreview(null)}
                    pv={pvPreview.pv}
                    startPosition={pvPreview.startPosition}
                    ply={pvPreview.ply}
                    evalCp={pvPreview.evalCp}
                    evalMate={pvPreview.evalMate}
                    squareNotation={displaySettings.squareNotation}
                    showBoardLabels={displaySettings.showBoardLabels}
                />
            )}

            {/* NNUE ファイル管理ダイアログ */}
            <NnueManagerDialog
                open={isNnueManagerOpen}
                onOpenChange={(open) => {
                    if (open) {
                        openNnueManager();
                    } else {
                        closeNnueManager();
                    }
                }}
                manifestUrl={manifestUrl}
                onRequestFilePath={onRequestNnueFilePath}
                openReason={nnueManagerOpenReason ?? undefined}
                onClearOpenReason={clearNnueManagerOpenReason}
                isMatchActive={isMatchRunning || isPaused}
            />

            {/* 手の詳細ウィンドウ（ドラッグ移動可能） */}
            {selectedMoveDetail && (
                <MoveDetailWindow
                    move={selectedMoveDetail.move}
                    position={selectedMoveDetail.position}
                    onAddBranch={handleAddPvAsBranch}
                    onPreview={handlePreviewPv}
                    onAnalyze={handleAnalyzePly}
                    isAnalyzing={isAnalyzing}
                    analyzingPly={
                        analyzingState.type !== "none" && analyzingState.type !== "error"
                            ? analyzingState.ply
                            : undefined
                    }
                    analysisError={
                        analyzingState.type === "error"
                            ? {
                                  ply: analyzingState.ply,
                                  message: analyzingState.message,
                              }
                            : undefined
                    }
                    analysisNnueSelection={analysisNnueSelection}
                    onAnalysisNnueSelectionChange={setAnalysisNnueSelection}
                    nnueList={nnueList}
                    isNnueListLoading={isNnueListLoading}
                    presets={presetConfigs}
                    kifuTree={kifuTree}
                    onClose={() => setSelectedMoveDetailPly(null)}
                    isOnMainLine={navigationState.isOnMainLine}
                />
            )}

            {/* モバイル時はMobileLayout、PC時は3列レイアウト */}
            {isMobile ? (
                <MatchSettingsProvider
                    sides={sides}
                    onSidesChange={handleSidesChange}
                    timeSettings={timeSettings}
                    onTimeSettingsChange={setTimeSettings}
                    passRightsSettings={passRightsSettings}
                    onPassRightsSettingsChange={handlePassRightsSettingsChange}
                    settingsLocked={settingsLocked}
                    senteNnueSelection={senteNnueSelection}
                    onSenteNnueSelectionChange={handleSenteNnueSelectionChange}
                    goteNnueSelection={goteNnueSelection}
                    onGoteNnueSelectionChange={handleGoteNnueSelectionChange}
                    nnueList={nnueList}
                    presets={presets}
                    internalEngineId={internalEngineId}
                    onOpenNnueManager={openNnueManager}
                    onOpenDisplaySettings={() => setIsDisplaySettingsOpen(true)}
                    onOpenPassRightsSettings={() => setIsPassRightsSettingsOpen(true)}
                >
                    <MatchStateProvider
                        position={position}
                        clocks={clocks}
                        grid={grid}
                        isMatchRunning={isMatchRunning}
                        isPaused={isPaused}
                        isEditMode={isEditMode}
                        gameMode={gameMode}
                        message={message}
                        selection={selection}
                        promotionSelection={promotionSelection}
                        lastMove={lastMove}
                        flipBoard={flipBoard}
                        onFlipBoardChange={onFlipBoardChange}
                        displaySettings={displaySettings}
                        passRightsSettings={passRightsSettings}
                        sides={sides}
                        moves={moves}
                        editFromSquare={editFromSquare}
                        hideEmptyHandPieces={hideEmptyHandPieces}
                        getHandInfo={getHandInfo}
                        handleSquareSelect={handleSquareSelect}
                        handlePromotionChoice={handlePromotionChoice}
                        handleHandSelect={handleHandSelect}
                        handleHandPiecePointerDown={handleHandPiecePointerDown}
                        handlePiecePointerDown={handlePiecePointerDown}
                        handlePieceTogglePromote={handlePieceTogglePromote}
                        handleIncrementHand={handleIncrementHand}
                        handleDecrementHand={handleDecrementHand}
                        handleResetToStartpos={handleResetToStartpos}
                        pauseAutoPlay={pauseAutoPlay}
                        resumeAutoPlay={resumeAutoPlay}
                        handleStartReview={handleStartReview}
                        handleEnterEditMode={handleEnterEditMode}
                        enterEditModeFromPaused={enterEditModeFromPaused}
                        handleResign={handleResign}
                        handleUndo={handleUndo}
                        onOpenSettings={() => setIsSettingsModalOpen(true)}
                        shouldRenderPassButton={shouldRenderPassButton}
                        canMakePassMove={canMakePassMove}
                        passButtonDisabledReason={passButtonDisabledReason}
                        handlePassMove={handlePassMove}
                        shouldShowPassConfirm={shouldShowPassConfirm}
                        isDraggingPiece={isDraggingPiece}
                        boardSectionRef={boardSectionRef}
                    >
                        <NavigationProvider
                            navigationState={navigationState}
                            navigationHandlers={navigationHandlers}
                            kifMoves={kifMoves}
                            evalHistory={evalHistory}
                            displayEvalHistory={displayEvalHistory}
                            positionHistory={positionHistory}
                            kifuTree={kifuTree}
                            selectedBranchNodeId={selectedBranchNodeId}
                            onSelectedBranchChange={setSelectedBranchNodeId}
                            branchMarkers={branchMarkers}
                            lastAddedBranchInfo={lastAddedBranchInfo}
                            onLastAddedBranchHandled={() => setLastAddedBranchInfo(null)}
                            handleAddPvAsBranch={handleAddPvAsBranch}
                            handlePreviewPv={handlePreviewPv}
                            kifuViewMode={kifuViewMode}
                            onViewModeChange={setKifuViewMode}
                            displaySettings={displaySettings}
                            onDisplaySettingsChange={setDisplaySettings}
                            handlePlySelect={handlePlySelect}
                            handleCopyKif={handleCopyKif}
                            handleMoveDetailSelect={handleMoveDetailSelect}
                            isMatchRunning={isMatchRunning}
                        >
                            <MobileLayout
                                candidateNote={candidateNote}
                                isReviewMode={isReviewMode}
                                onOpenAbout={onOpenAbout}
                                onImportSfen={onImportSfen}
                                onImportKif={onImportKif}
                                positionReady={positionReady}
                                onDisplaySettingsChange={onDisplaySettingsChange}
                            />
                        </NavigationProvider>
                    </MatchStateProvider>
                </MatchSettingsProvider>
            ) : (
                <MatchSettingsProvider
                    sides={sides}
                    onSidesChange={handleSidesChange}
                    timeSettings={timeSettings}
                    onTimeSettingsChange={setTimeSettings}
                    passRightsSettings={passRightsSettings}
                    onPassRightsSettingsChange={handlePassRightsSettingsChange}
                    settingsLocked={settingsLocked}
                    senteNnueSelection={senteNnueSelection}
                    onSenteNnueSelectionChange={handleSenteNnueSelectionChange}
                    goteNnueSelection={goteNnueSelection}
                    onGoteNnueSelectionChange={handleGoteNnueSelectionChange}
                    nnueList={nnueList}
                    presets={presets}
                    internalEngineId={internalEngineId}
                    onOpenNnueManager={openNnueManager}
                    onOpenDisplaySettings={() => setIsDisplaySettingsOpen(true)}
                    onOpenPassRightsSettings={() => setIsPassRightsSettingsOpen(true)}
                >
                    <AnalysisProvider
                        analysisSettings={analysisSettings}
                        onAnalysisSettingsChange={setAnalysisSettings}
                        analysisNnueSelection={analysisNnueSelection}
                        onAnalysisNnueSelectionChange={setAnalysisNnueSelection}
                        nnueList={nnueList}
                        isNnueListLoading={isNnueListLoading}
                        presetConfigs={presetConfigs}
                        isAnalyzing={isAnalyzing}
                        analyzingState={analyzingState}
                        batchAnalysis={batchAnalysis}
                        handleAnalyzePly={handleAnalyzePly}
                        handleStartBatchAnalysis={handleStartBatchAnalysis}
                        handleCancelBatchAnalysis={handleCancelBatchAnalysis}
                        handleAnalyzeNode={handleAnalyzeNode}
                        handleAnalyzeBranch={handleAnalyzeBranch}
                        handleStartTreeBatchAnalysis={handleStartTreeBatchAnalysis}
                    >
                        <MatchStateProvider
                            position={position}
                            clocks={clocks}
                            grid={grid}
                            isMatchRunning={isMatchRunning}
                            isPaused={isPaused}
                            isEditMode={isEditMode}
                            gameMode={gameMode}
                            message={message}
                            selection={selection}
                            promotionSelection={promotionSelection}
                            lastMove={lastMove}
                            flipBoard={flipBoard}
                            onFlipBoardChange={onFlipBoardChange}
                            displaySettings={displaySettings}
                            passRightsSettings={passRightsSettings}
                            sides={sides}
                            moves={moves}
                            editFromSquare={editFromSquare}
                            hideEmptyHandPieces={hideEmptyHandPieces}
                            getHandInfo={getHandInfo}
                            handleSquareSelect={handleSquareSelect}
                            handlePromotionChoice={handlePromotionChoice}
                            handleHandSelect={handleHandSelect}
                            handleHandPiecePointerDown={handleHandPiecePointerDown}
                            handlePiecePointerDown={handlePiecePointerDown}
                            handlePieceTogglePromote={handlePieceTogglePromote}
                            handleIncrementHand={handleIncrementHand}
                            handleDecrementHand={handleDecrementHand}
                            handleResetToStartpos={handleResetToStartpos}
                            pauseAutoPlay={pauseAutoPlay}
                            resumeAutoPlay={resumeAutoPlay}
                            handleStartReview={handleStartReview}
                            handleEnterEditMode={handleEnterEditMode}
                            enterEditModeFromPaused={enterEditModeFromPaused}
                            handleResign={handleResign}
                            handleUndo={handleUndo}
                            onOpenSettings={() => setIsSettingsModalOpen(true)}
                            shouldRenderPassButton={shouldRenderPassButton}
                            canMakePassMove={canMakePassMove}
                            passButtonDisabledReason={passButtonDisabledReason}
                            handlePassMove={handlePassMove}
                            shouldShowPassConfirm={shouldShowPassConfirm}
                            isDraggingPiece={isDraggingPiece}
                            boardSectionRef={boardSectionRef}
                        >
                            <NavigationProvider
                                navigationState={navigationState}
                                navigationHandlers={navigationHandlers}
                                kifMoves={kifMoves}
                                evalHistory={evalHistory}
                                displayEvalHistory={displayEvalHistory}
                                positionHistory={positionHistory}
                                kifuTree={kifuTree}
                                selectedBranchNodeId={selectedBranchNodeId}
                                onSelectedBranchChange={setSelectedBranchNodeId}
                                branchMarkers={branchMarkers}
                                lastAddedBranchInfo={lastAddedBranchInfo}
                                onLastAddedBranchHandled={() => setLastAddedBranchInfo(null)}
                                handleAddPvAsBranch={handleAddPvAsBranch}
                                handlePreviewPv={handlePreviewPv}
                                kifuViewMode={kifuViewMode}
                                onViewModeChange={setKifuViewMode}
                                displaySettings={displaySettings}
                                onDisplaySettingsChange={setDisplaySettings}
                                handlePlySelect={handlePlySelect}
                                handleCopyKif={handleCopyKif}
                                handleMoveDetailSelect={handleMoveDetailSelect}
                                isMatchRunning={isMatchRunning}
                            >
                                <PCLayout
                                    matchLayoutClasses={matchLayoutClasses}
                                    candidateNote={candidateNote}
                                    isSettingsModalOpen={isSettingsModalOpen}
                                    onSettingsModalOpenChange={setIsSettingsModalOpen}
                                    importSfen={importSfen}
                                    importKif={importKif}
                                    positionReady={positionReady}
                                    isDevMode={isDevMode}
                                    eventLogs={eventLogs}
                                    errorLogs={errorLogs}
                                    engineErrorDetails={engineErrorDetails}
                                    retryEngine={retryEngine}
                                    isRetrying={isRetrying}
                                    isDisplaySettingsOpen={isDisplaySettingsOpen}
                                    onDisplaySettingsOpenChange={onDisplaySettingsOpenChange}
                                    setDisplaySettings={setDisplaySettings}
                                    isPassRightsSettingsOpen={isPassRightsSettingsOpen}
                                    onPassRightsSettingsOpenChange={onPassRightsSettingsOpenChange}
                                    handlePassRightsSettingsChange={handlePassRightsSettingsChange}
                                />
                            </NavigationProvider>
                        </MatchStateProvider>
                    </AnalysisProvider>
                </MatchSettingsProvider>
            )}

            {/* 画面右下固定のAboutリンク（PC版のみ） */}
            {!isMobile && (
                <button
                    type="button"
                    onClick={() => setIsAboutOpen(true)}
                    className="fixed bottom-2 right-2 z-40 px-2 py-1 text-xs text-muted-foreground/60 hover:text-muted-foreground hover:underline transition-colors"
                    aria-label="このアプリについて"
                    title="このアプリについて"
                >
                    About
                </button>
            )}

            <AboutDialog open={isAboutOpen} onOpenChange={setIsAboutOpen} />
        </>
    );
}

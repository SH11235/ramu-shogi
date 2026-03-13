/**
 * ShogiMatchLayout
 *
 * レイアウト・ダイアログの統括コンポーネント
 * - 共通ダイアログ（DragGhost, EngineRestartingOverlay等）
 * - Mobile/PC のProvider階層と条件分岐
 * - Aboutボタン
 */

import type { ReactElement } from "react";
import { AboutDialog } from "../../AboutDialog";
import { EngineRestartingOverlay } from "../../nnue/EngineRestartingOverlay";
import { NnueManagerDialog } from "../../nnue/NnueManagerDialog";
import { GameResultDialog } from "../components/GameResultDialog";
import { MoveDetailWindow } from "../components/MoveDetailWindow";
import { PvPreviewDialog } from "../components/PvPreviewDialog";
import { AnalysisProvider } from "../contexts/AnalysisContext";
import { MatchSettingsProvider } from "../contexts/MatchSettingsContext";
import { MatchStateProvider } from "../contexts/MatchStateContext";
import { NavigationProvider } from "../contexts/NavigationContext";
import { DragGhost } from "../dnd/DragGhost";
import type { PieceDndController as DndController } from "../dnd/usePieceDnd";
import type {
    AnalysisProps,
    BoardHandlersProps,
    BoardStateProps,
    DialogStateProps,
    MatchSettingsProps,
    MobileSpecificProps,
    NavigationProps,
    PCSpecificProps,
} from "../types/layoutProps";
import { MobileLayout } from "./MobileLayout";
import { PCLayout } from "./PCLayout";

interface ShogiMatchLayoutProps {
    // Props グループ
    matchSettings: MatchSettingsProps;
    boardState: BoardStateProps;
    dialogState: DialogStateProps;
    analysisProps: AnalysisProps;
    navigationProps: NavigationProps;
    boardHandlers: BoardHandlersProps;
    pcSpecificProps: PCSpecificProps;
    mobileSpecificProps: MobileSpecificProps;

    // デバイス
    isMobile: boolean;

    // DnD
    dndController: DndController;
    isEditMode: boolean;

    // エンジン再起動
    isEngineRestarting: boolean;

    // 対局状態
    isMatchRunning: boolean;
    isPaused: boolean;
}

/**
 * レイアウト・ダイアログの統括コンポーネント
 */
export function ShogiMatchLayout({
    // グループ化されたprops
    matchSettings,
    boardState,
    dialogState,
    analysisProps,
    navigationProps,
    boardHandlers,
    pcSpecificProps,
    mobileSpecificProps,
    // 個別props
    isMobile,
    dndController,
    isEditMode,
    isEngineRestarting,
    isMatchRunning,
    isPaused,
}: ShogiMatchLayoutProps): ReactElement {
    // グループ化されたpropsを展開: 対局設定
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

    // グループ化されたpropsを展開: 盤面状態
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

    // グループ化されたpropsを展開: ダイアログ状態
    const {
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
        remoteNnueManager,
        selectedMoveDetail,
        setSelectedMoveDetailPly,
        isAboutOpen,
        setIsAboutOpen,
    } = dialogState;

    // グループ化されたpropsを展開: 解析機能
    const {
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
        handleAnalyzeHintPly,
        handleStartBatchAnalysis,
        handleCancelBatchAnalysis,
        handleAnalyzeNode,
        handleAnalyzeBranch,
        handleStartTreeBatchAnalysis,
    } = analysisProps;

    // グループ化されたpropsを展開: ナビゲーション・棋譜
    const {
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
        analysisMarkers,
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
    } = navigationProps;

    // グループ化されたpropsを展開: 盤面操作ハンドラー
    const {
        hideEmptyHandPieces,
        getHandInfo,
        handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect,
        applyUsiMove,
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
    } = boardHandlers;

    // グループ化されたpropsを展開: PC専用
    const {
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
    } = pcSpecificProps;

    // グループ化されたpropsを展開: Mobile専用
    const { isReviewMode, onOpenAbout, onImportSfen, onImportKif, onDisplaySettingsChange } =
        mobileSpecificProps;

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
                remoteNnueManager={remoteNnueManager}
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
                    isDevMode={matchSettings.isDevMode}
                    engineThreads={matchSettings.engineThreads}
                    onEngineThreadsChange={matchSettings.setEngineThreads}
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
                        handleAnalyzeHintPly={handleAnalyzeHintPly}
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
                            applyUsiMove={applyUsiMove}
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
                                analysisMarkers={analysisMarkers}
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
                    </AnalysisProvider>
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
                    isDevMode={matchSettings.isDevMode}
                    engineThreads={matchSettings.engineThreads}
                    onEngineThreadsChange={matchSettings.setEngineThreads}
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
                        handleAnalyzeHintPly={handleAnalyzeHintPly}
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
                            applyUsiMove={applyUsiMove}
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
                                analysisMarkers={analysisMarkers}
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

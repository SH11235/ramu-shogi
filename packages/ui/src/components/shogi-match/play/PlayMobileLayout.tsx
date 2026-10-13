/**
 * 対局画面（`screen="play"`）のスマホレイアウト。
 *
 * 進み具合ごとに縦に並べる:
 * - 設定: 設定の欄 → 盤（触れない）
 * - 局面編集: 盤 → 編集の欄
 * - 対局中: 時計 → 盤 → 棋譜 1 行 → 操作 → ヒント
 * - 終局後: 盤 → 棋譜の送り → 結果の欄
 *
 * Context の前提: MatchSettings / Analysis / MatchState / Navigation を親で Provider 済み。
 */

import type { ReactElement, ReactNode } from "react";
import { useState } from "react";
import { BottomSheet } from "../components/BottomSheet";
import { ClockDisplay } from "../components/ClockDisplay";
import { KifuNavigationToolbar } from "../components/KifuNavigationToolbar";
import { MobileBoardSection } from "../components/MobileBoardSection";
import { MobileKifuBar } from "../components/MobileKifuBar";
import { MobileSettingsSheet } from "../components/MobileSettingsSheet";
import { SoundToggle } from "../components/SoundToggle";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { DisplaySettings } from "../types";
import {
    PlayMatchActions,
    PlayMessage,
    PlayPositionEditorPanel,
    PlayTurnStatus,
} from "./PlayControls";
import { PlayHintCard } from "./PlayHintCard";
import { PlayResultCard, PlayResultDialog } from "./PlayResult";
import { PlaySetupPanel } from "./PlaySetupPanel";

interface PlayMobileLayoutProps {
    searchInfo?: ReactNode;
    candidateNote: string | null;
    onOpenAbout?: () => void;
    positionReady?: boolean;
    onDisplaySettingsChange: (settings: DisplaySettings) => void;
}

export function PlayMobileLayout({
    searchInfo,
    candidateNote,
    onOpenAbout,
    positionReady = true,
    onDisplaySettingsChange,
}: PlayMobileLayoutProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const {
        grid,
        position,
        flipBoard,
        onFlipBoardChange,
        lastMove,
        selection,
        moveShadow,
        promotionSelection,
        isMatchRunning,
        editFromSquare,
        displaySettings,
        passRightsSettings,
        clocks,
        getHandInfo,
        boardSectionRef,
        isDraggingPiece,
        handleSquareSelect,
        handlePromotionChoice,
        handleHandSelect,
        handlePiecePointerDown,
        handlePieceTogglePromote,
        handleHandPiecePointerDown,
        handleIncrementHand,
        handleDecrementHand,
        pauseAutoPlay,
        sides,
    } = useMatchState();
    const {
        onSidesChange,
        analysisEngineId,
        onAnalysisEngineIdChange,
        timeSettings,
        onTimeSettingsChange,
        senteNnueSelection,
        onSenteNnueSelectionChange,
        goteNnueSelection,
        onGoteNnueSelectionChange,
        nnueList,
        presets,
        internalEngineId,
        engineOptions,
        isDevMode,
        engineThreads,
        onEngineThreadsChange,
        settingsLocked,
        onOpenEngineManager,
        onPassRightsSettingsChange,
    } = useMatchSettings();
    const { navigationState, navigationHandlers, kifMoves, handlePlySelect } = useNavigation();
    const [isAdvancedOpen, setIsAdvancedOpen] = useState(false);

    const phase = play?.phase ?? "setup";
    const isEditing = phase === "editing";
    const inGame = phase === "playing" || phase === "paused" || phase === "finished";
    const barMoves = kifMoves.map((move) => ({ ply: move.ply, displayText: move.displayText }));

    const flipAndSound = (
        <div className="flex shrink-0 items-center gap-1">
            <button
                type="button"
                onClick={() => onFlipBoardChange(!flipBoard)}
                aria-pressed={flipBoard}
                className="flex h-9 w-9 items-center justify-center rounded-md text-base hover:bg-muted"
                title="盤面を反転"
                aria-label="盤面を反転"
            >
                🔄
            </button>
            <SoundToggle />
        </div>
    );

    const board = (
        <div className="relative flex justify-center">
            <MobileBoardSection
                grid={grid}
                position={position}
                flipBoard={flipBoard}
                lastMove={lastMove}
                selection={selection}
                moveShadow={moveShadow}
                promotionSelection={promotionSelection}
                displaySettings={displaySettings}
                isEditModeActive={isEditing}
                isMatchRunning={isMatchRunning}
                hideEmptyHandPieces={!isEditing}
                editFromSquare={editFromSquare}
                candidateNote={candidateNote}
                onSquareSelect={handleSquareSelect}
                onPromotionChoice={handlePromotionChoice}
                onHandSelect={handleHandSelect}
                onPiecePointerDown={isEditing ? handlePiecePointerDown : undefined}
                onPieceTogglePromote={isEditing ? handlePieceTogglePromote : undefined}
                onHandPiecePointerDown={isEditing ? handleHandPiecePointerDown : undefined}
                onIncrementHand={handleIncrementHand}
                onDecrementHand={handleDecrementHand}
                topHand={getHandInfo("top")}
                bottomHand={getHandInfo("bottom")}
                boardSectionRef={boardSectionRef}
                isDraggingPiece={isDraggingPiece}
                passRightsSettings={passRightsSettings}
                passRights={position.passRights}
                turn={position.turn}
            />
        </div>
    );

    return (
        <div className="relative flex w-full min-w-0 flex-col gap-2 bg-background px-2 pb-[max(env(safe-area-inset-bottom),12px)] text-foreground">
            {phase === "setup" && (
                <>
                    <PlaySetupPanel
                        onOpenAdvanced={() => setIsAdvancedOpen(true)}
                        className="p-4"
                    />
                    <div className="flex items-center justify-between gap-2 px-1">
                        <span className="text-sm text-wafuu-sumi-light">
                            {play?.isCustomStart ? "指定の局面から始めます" : "開始局面（平手）"}
                        </span>
                        {play?.isCustomStart && (
                            <button
                                type="button"
                                onClick={play.resetToStartpos}
                                className="min-h-9 rounded-sm px-1 text-sm text-wafuu-sumi-light underline underline-offset-2"
                            >
                                平手に戻す
                            </button>
                        )}
                    </div>
                    {board}
                    <PlayMessage />
                </>
            )}

            {isEditing && (
                <>
                    <div className="flex items-center justify-between gap-2 px-1 pt-1">
                        <span className="text-sm text-wafuu-sumi-light">
                            開始局面を編集しています
                        </span>
                        {flipAndSound}
                    </div>
                    {board}
                    <PlayMessage />
                    <PlayPositionEditorPanel className="p-4" />
                </>
            )}

            {inGame && (
                <>
                    <header className="flex flex-col gap-1 pt-1">
                        <ClockDisplay
                            clocks={clocks}
                            timeSettings={timeSettings}
                            isRunning={isMatchRunning}
                            className="[&>div]:gap-0.5 [&>div]:px-0 [&_.font-mono]:text-xs"
                            centerContent={flipAndSound}
                        />
                        <PlayTurnStatus className="justify-center" />
                    </header>
                    {board}
                    {phase === "finished" ? (
                        <>
                            <MobileKifuBar
                                moves={barMoves}
                                currentPly={navigationState.currentPly}
                                onPlySelect={handlePlySelect}
                            />
                            <div className="flex justify-center">
                                <KifuNavigationToolbar
                                    currentPly={navigationState.currentPly}
                                    totalPly={navigationState.totalPly}
                                    onBack={navigationHandlers.goBack}
                                    onForward={() => navigationHandlers.goForward()}
                                    onToStart={navigationHandlers.goToStart}
                                    onToEnd={navigationHandlers.goToEnd}
                                    canGoForward={navigationState.canGoForward}
                                />
                            </div>
                            <PlayMessage />
                            <PlayResultCard className="p-4" />
                        </>
                    ) : (
                        <>
                            <MobileKifuBar
                                moves={barMoves}
                                currentPly={navigationState.currentPly}
                            />
                            <PlayMatchActions compact />
                            <PlayMessage />
                            <PlayHintCard compact className="px-1" />
                        </>
                    )}
                </>
            )}

            {displaySettings.showSearchInfo && <div className="min-h-10 w-full">{searchInfo}</div>}

            <PlayResultDialog />

            {/* 詳細設定（先後それぞれの担当・秒数・変則ルール・評価関数の管理・表示） */}
            <BottomSheet
                open={isAdvancedOpen}
                onOpenChange={setIsAdvancedOpen}
                title="詳細設定"
                height="full"
            >
                <MobileSettingsSheet
                    sides={sides}
                    onSidesChange={onSidesChange}
                    analysisEngineId={analysisEngineId}
                    onAnalysisEngineIdChange={onAnalysisEngineIdChange}
                    timeSettings={timeSettings}
                    onTimeSettingsChange={onTimeSettingsChange}
                    internalEngineId={internalEngineId}
                    engineOptions={engineOptions}
                    nnueList={nnueList}
                    presets={presets}
                    senteNnueSelection={senteNnueSelection}
                    onSenteNnueSelectionChange={onSenteNnueSelectionChange}
                    goteNnueSelection={goteNnueSelection}
                    onGoteNnueSelectionChange={onGoteNnueSelectionChange}
                    settingsLocked={settingsLocked}
                    isDevMode={isDevMode}
                    engineThreads={engineThreads}
                    onEngineThreadsChange={onEngineThreadsChange}
                    onOpenEngineManager={onOpenEngineManager}
                    passRightsSettings={passRightsSettings}
                    onPassRightsSettingsChange={onPassRightsSettingsChange}
                    isMatchRunning={isMatchRunning}
                    onStopMatch={pauseAutoPlay}
                    displaySettings={displaySettings}
                    onDisplaySettingsChange={onDisplaySettingsChange}
                    onOpenAbout={onOpenAbout}
                    positionReady={positionReady}
                />
            </BottomSheet>
        </div>
    );
}

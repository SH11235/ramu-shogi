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
import { PlayHintButton, PlayHintLine, usePlayHintMove } from "./PlayHintCard";
import { PlayPlayerBar } from "./PlayPlayerBar";
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
    const hintMove = usePlayHintMove();

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
        // 設定中と終局後は盤を操作できない。フォーカスや読み上げの対象からも外す。
        <div
            inert={phase === "setup" || phase === "finished"}
            className="relative flex justify-center"
        >
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
                // 対局者は帯に出すので、駒台には AI のアイコンを出さない。
                topHand={{ ...getHandInfo("top"), isAI: false }}
                bottomHand={{ ...getHandInfo("bottom"), isAI: false }}
                hintMove={hintMove}
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
                    {/* 終局後は、次にすること（研究ノートで振り返る・もう一局）を先に出す。 */}
                    {phase === "finished" && <PlayResultCard className="gap-3 p-4" />}
                    <PlayPlayerBar position="top" className="mt-1" />
                    {board}
                    <PlayPlayerBar position="bottom" />
                    {phase === "finished" ? (
                        <>
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
                            <MobileKifuBar
                                moves={barMoves}
                                currentPly={navigationState.currentPly}
                                onPlySelect={handlePlySelect}
                            />
                            <PlayMessage />
                        </>
                    ) : (
                        <>
                            {/* 盤のすぐ下: 手番（ヒントを求めたら、その結果）。高さを確保して盤を動かさない。 */}
                            <PlayHintLine
                                className="flex min-h-8 items-center justify-center px-1"
                                fallback={<PlayTurnStatus />}
                            />
                            <PlayMatchActions
                                compact
                                extra={
                                    phase === "playing" &&
                                    (sides.sente.role === "human" ||
                                        sides.gote.role === "human") ? (
                                        <PlayHintButton />
                                    ) : null
                                }
                            />
                            <PlayMessage />
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <MobileKifuBar
                                        moves={barMoves.filter(
                                            (move) => move.ply <= navigationState.currentPly,
                                        )}
                                        currentPly={navigationState.currentPly}
                                    />
                                </div>
                                {flipAndSound}
                            </div>
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

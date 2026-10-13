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
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { DisplaySettings } from "../types";
import {
    PlayBoardTools,
    PlayMatchActions,
    PlayMessage,
    PlayPositionEditorPanel,
    PlayTurnStatus,
} from "./PlayControls";
import { PlayHintButton, PlayHintLine, usePlayHintMove } from "./PlayHintCard";
import { PlayPlayerBar } from "./PlayPlayerBar";
import { PlayResultCard } from "./PlayResult";
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
        message,
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

    const board = (
        // 設定中と終局後は盤を操作できない。フォーカスや読み上げの対象からも外す。
        <div
            inert={phase === "setup" || phase === "finished"}
            // 持ち駒の欄は、空のときも高さを確保する（駒を取ったときに盤や操作が動かないように）。
            className="relative flex justify-center [&_[data-zone^=hand-]]:min-h-[34px] [&_[data-zone^=hand-]:empty]:rounded-md [&_[data-zone^=hand-]:empty]:border [&_[data-zone^=hand-]:empty]:border-wafuu-border/50"
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
        <div className="relative flex w-full min-w-0 flex-col gap-1 bg-background px-2 pb-[max(env(safe-area-inset-bottom),12px)] text-foreground">
            {phase === "setup" && (
                <>
                    <PlaySetupPanel
                        onOpenAdvanced={() => setIsAdvancedOpen(true)}
                        className="px-2 pb-2 pt-3"
                    />
                    <PlayMessage />
                    <div className="flex items-center justify-between gap-2 px-1">
                        <span className="text-sm text-wafuu-sumi-light">
                            {play?.isCustomStart ? "指定の局面から始めます" : "開始局面（平手）"}
                        </span>
                        <PlayBoardTools />
                    </div>
                    {board}
                </>
            )}

            {isEditing && (
                <>
                    {/* 編集を終える操作を先に出す（盤の下だと画面の外になる）。 */}
                    <PlayPositionEditorPanel className="gap-3 px-2 pb-1 pt-3" />
                    <PlayMessage />
                    {board}
                    <div className="flex justify-end">
                        <PlayBoardTools />
                    </div>
                </>
            )}

            {inGame && (
                <>
                    {/* 終局後は、結果と次にすること（研究ノートで振り返る・もう一局）を先に出す。 */}
                    {phase === "finished" && <PlayResultCard compact className="px-2 pt-2" />}
                    <PlayPlayerBar position="top" />
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
                            {/* 手番（知らせ・ヒントがあればそれ）と操作。画面の下端に留めて、盤が上へ
                                送られても押せるようにする。高さは固定して、盤を動かさない。 */}
                            <div className="sticky bottom-0 z-10 flex flex-col gap-1 bg-background pb-1">
                                <div className="flex min-h-8 items-center justify-center px-1">
                                    {message ? (
                                        <PlayMessage />
                                    ) : (
                                        <PlayHintLine
                                            className="flex min-w-0 items-center justify-center"
                                            fallback={<PlayTurnStatus />}
                                        />
                                    )}
                                </div>
                                <PlayMatchActions
                                    compact
                                    extra={
                                        phase === "playing" &&
                                        (sides.sente.role === "human" ||
                                            sides.gote.role === "human") ? (
                                            <PlayHintButton className="flex-1 px-2" />
                                        ) : null
                                    }
                                />
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <MobileKifuBar
                                        moves={barMoves.filter(
                                            (move) => move.ply <= navigationState.currentPly,
                                        )}
                                        currentPly={navigationState.currentPly}
                                    />
                                </div>
                                <PlayBoardTools />
                            </div>
                        </>
                    )}
                </>
            )}

            {displaySettings.showSearchInfo && <div className="min-h-10 w-full">{searchInfo}</div>}

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

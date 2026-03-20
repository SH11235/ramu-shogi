/**
 * PC版盤面セクション
 *
 * 将棋盤と持ち駒、対局コントロールを含む中央のセクション
 * 対局進行状態は MatchStateContext から取得
 */

import type { ReactElement } from "react";
import { useMatchSettings } from "../contexts/MatchSettingsContext";
import { useMatchState } from "../contexts/MatchStateContext";
import { ClockDisplay } from "./ClockDisplay";
import { MatchControls } from "./MatchControls";
import { PCBoardContent } from "./PCBoardContent";
import { PlayerIcon } from "./PlayerIcon";

// テキストスタイル用Tailwindクラス定数
const TEXT_CLASSES = {
    mutedSecondary: "text-xs text-muted-foreground",
    moveCount: "text-center text-sm font-semibold text-foreground my-2",
} as const;

/**
 * candidateNote のみ Props として受け取る（その他は Context から取得）
 */
interface PCBoardSectionProps {
    candidateNote: string | null;
}

export function PCBoardSection({ candidateNote }: PCBoardSectionProps): ReactElement {
    // 対局設定を取得
    const { timeSettings } = useMatchSettings();

    // 対局進行状態は Context から取得
    const {
        boardSectionRef,
        isDraggingPiece,
        clocks,
        isMatchRunning,
        moves,
        position,
        sides,
        flipBoard,
        onFlipBoardChange,
        selection,
        displaySettings,
        passRightsSettings,
        grid,
        editFromSquare,
        lastMove,
        promotionSelection,
        isEditMode,
        gameMode,
        message,
        isPaused,
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
        onOpenSettings,
        shouldRenderPassButton,
        canMakePassMove,
        passButtonDisabledReason,
        handlePassMove,
        shouldShowPassConfirm,
    } = useMatchState();

    const topHandInfo = getHandInfo("top");
    const bottomHandInfo = getHandInfo("bottom");

    return (
        <div className="flex flex-col gap-2 items-center shrink-0">
            <div ref={boardSectionRef} className="w-fit relative flex flex-col gap-2">
                <div
                    className={`flex flex-col gap-2 items-center ${isDraggingPiece ? "touch-none" : ""}`}
                >
                    {/* 時間管理（将棋盤の上） */}
                    <ClockDisplay
                        clocks={clocks}
                        timeSettings={timeSettings}
                        isRunning={isMatchRunning}
                    />

                    {/* ステータス行: [手数] [手番] [反転ボタン] */}
                    <div className="flex items-center justify-end w-full gap-4">
                        {/* 手数表示 */}
                        <output className={`${TEXT_CLASSES.moveCount} !m-0 whitespace-nowrap`}>
                            {moves.length === 0 ? "開始局面" : `${moves.length}手目`}
                        </output>

                        {/* 手番表示 */}
                        <output
                            className={`${TEXT_CLASSES.mutedSecondary} whitespace-nowrap flex items-center gap-1`}
                        >
                            手番:{" "}
                            <PlayerIcon
                                side={position.turn}
                                isAI={
                                    gameMode !== "reviewing" &&
                                    sides[position.turn].role === "engine"
                                }
                                size="lg"
                            />
                        </output>

                        {/* 反転ボタン */}
                        <button
                            type="button"
                            onClick={() => onFlipBoardChange(!flipBoard)}
                            className={`flex items-center gap-1 px-2 py-1 rounded-md border border-[hsl(var(--wafuu-border))] cursor-pointer text-[13px] whitespace-nowrap ${
                                flipBoard ? "bg-[hsl(var(--wafuu-kin)/0.2)]" : "bg-card"
                            }`}
                            title="盤面を反転"
                        >
                            <span>🔄</span>
                            <span>反転</span>
                        </button>
                    </div>

                    {/* 盤面 + 持ち駒（共通コンポーネント） */}
                    <PCBoardContent
                        grid={grid}
                        flipBoard={flipBoard}
                        lastMove={lastMove}
                        selection={selection}
                        promotionSelection={promotionSelection}
                        displaySettings={displaySettings}
                        isEditModeActive={isEditMode && !isMatchRunning}
                        isMatchRunning={isMatchRunning}
                        hideEmptyHandPieces={hideEmptyHandPieces}
                        editFromSquare={editFromSquare}
                        candidateNote={candidateNote}
                        onSquareSelect={(sq, shiftKey) => {
                            void handleSquareSelect(sq, shiftKey);
                        }}
                        onPromotionChoice={handlePromotionChoice}
                        onHandSelect={handleHandSelect}
                        onPiecePointerDown={handlePiecePointerDown}
                        onPieceTogglePromote={handlePieceTogglePromote}
                        onHandPiecePointerDown={handleHandPiecePointerDown}
                        onIncrementHand={handleIncrementHand}
                        onDecrementHand={handleDecrementHand}
                        topHand={topHandInfo}
                        bottomHand={bottomHandInfo}
                        passRightsSettings={passRightsSettings}
                        passRights={position.passRights}
                        turn={position.turn}
                    />

                    {/* 対局コントロール（盤面の下） */}
                    <MatchControls
                        onResetToStartpos={handleResetToStartpos}
                        onStop={pauseAutoPlay}
                        onStart={resumeAutoPlay}
                        onStartReview={handleStartReview}
                        onEnterEditMode={isPaused ? enterEditModeFromPaused : handleEnterEditMode}
                        onResign={handleResign}
                        onUndo={handleUndo}
                        canUndo={
                            moves.length > 0 &&
                            !(sides.sente.role === "engine" && sides.gote.role === "engine") &&
                            sides[position.turn].role === "human"
                        }
                        isMatchRunning={isMatchRunning}
                        gameMode={gameMode}
                        message={message}
                        onOpenSettings={onOpenSettings}
                        passProps={
                            shouldRenderPassButton
                                ? {
                                      canPass: canMakePassMove,
                                      disabledReason: passButtonDisabledReason,
                                      onPass: handlePassMove,
                                      remainingPassRights:
                                          position.passRights?.[position.turn] ?? 0,
                                      showConfirmDialog: shouldShowPassConfirm,
                                  }
                                : undefined
                        }
                    />
                </div>
            </div>
        </div>
    );
}

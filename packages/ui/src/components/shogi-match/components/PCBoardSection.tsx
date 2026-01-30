import type { LastMove, PieceType, Player, PositionState, Square } from "@shogi/app-core";
import type { ReactElement, RefObject } from "react";
import type { ShogiBoardCell, ShogiBoardPiece } from "../../shogi-board";
import { ShogiBoard } from "../../shogi-board";
import type { TickState } from "../hooks/useClockManager";
import type {
    DisplaySettings,
    GameMode,
    Message,
    PassRightsSettings,
    PromotionSelection,
    SideSetting,
} from "../types";
import { ClockDisplay } from "./ClockDisplay";
import { HandPiecesDisplay } from "./HandPiecesDisplay";
import { MatchControls } from "./MatchControls";
import type { PassDisabledReason } from "./PassButton";
import { PassRightsDisplay } from "./PassRightsDisplay";
import { PlayerIcon } from "./PlayerIcon";

// テキストスタイル用Tailwindクラス定数
const TEXT_CLASSES = {
    mutedSecondary: "text-xs text-muted-foreground",
    moveCount: "text-center text-sm font-semibold text-foreground my-2",
} as const;

// 持ち駒情報の型
export interface HandInfo {
    owner: Player;
    hand: PositionState["hands"]["sente"] | PositionState["hands"]["gote"];
    isActive: boolean;
    isAI: boolean;
}

// 持ち駒表示セクションコンポーネント
interface PlayerHandSectionProps {
    owner: Player;
    hand: PositionState["hands"]["sente"] | PositionState["hands"]["gote"];
    selectedPiece: PieceType | null;
    isActive: boolean;
    onHandSelect: (piece: PieceType) => void;
    onPiecePointerDown?: (owner: Player, pieceType: PieceType, e: React.PointerEvent) => void;
    isEditMode?: boolean;
    isMatchRunning?: boolean;
    hideEmptyPieces?: boolean;
    onIncrement?: (piece: PieceType) => void;
    onDecrement?: (piece: PieceType) => void;
    flipBoard?: boolean;
    isAI?: boolean;
}

function PlayerHandSection({
    owner,
    hand,
    selectedPiece,
    isActive,
    onHandSelect,
    onPiecePointerDown,
    isEditMode,
    isMatchRunning,
    hideEmptyPieces,
    onIncrement,
    onDecrement,
    flipBoard,
    isAI,
}: PlayerHandSectionProps): ReactElement {
    return (
        <div data-zone={`hand-${owner}`} className="w-full">
            <HandPiecesDisplay
                owner={owner}
                hand={hand}
                selectedPiece={selectedPiece}
                isActive={isActive}
                onHandSelect={onHandSelect}
                onPiecePointerDown={onPiecePointerDown}
                isEditMode={isEditMode}
                isMatchRunning={isMatchRunning}
                hideEmptyPieces={hideEmptyPieces}
                onIncrement={onIncrement}
                onDecrement={onDecrement}
                flipBoard={flipBoard}
                isAI={isAI}
            />
        </div>
    );
}

type Selection = { kind: "square"; square: string } | { kind: "hand"; piece: PieceType };

export interface PCBoardSectionProps {
    // refs
    boardSectionRef: RefObject<HTMLDivElement | null>;

    // 状態
    isDraggingPiece: boolean;
    clocks: TickState;
    isMatchRunning: boolean;
    moves: string[];
    position: PositionState;
    sides: { sente: SideSetting; gote: SideSetting };
    flipBoard: boolean;
    onFlipBoardChange: (flip: boolean) => void;
    selection: Selection | null;
    displaySettings: DisplaySettings;
    passRightsSettings?: PassRightsSettings;
    grid: ShogiBoardCell[][];
    editFromSquare: Square | null;
    lastMove?: LastMove;
    promotionSelection: PromotionSelection | null;
    isEditMode: boolean;
    candidateNote: string | null;
    gameMode: GameMode;
    message: Message | null;
    isPaused: boolean;
    hideEmptyHandPieces: boolean;

    // ハンドラ
    getHandInfo: (pos: "top" | "bottom") => HandInfo;
    handleSquareSelect: (sq: string, shiftKey?: boolean) => Promise<void>;
    handlePromotionChoice: (promote: boolean) => void;
    handleHandSelect: (piece: PieceType) => void;
    handleHandPiecePointerDown: (
        owner: Player,
        pieceType: PieceType,
        e: React.PointerEvent,
    ) => void;
    handlePiecePointerDown: (square: string, piece: ShogiBoardPiece, e: React.PointerEvent) => void;
    handlePieceTogglePromote: (
        square: string,
        piece: ShogiBoardPiece,
        event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
    handleIncrementHand: (owner: Player, piece: PieceType) => void;
    handleDecrementHand: (owner: Player, piece: PieceType) => void;
    handleResetToStartpos: () => void;
    pauseAutoPlay: () => void;
    resumeAutoPlay: () => void;
    handleStartReview: () => void;
    handleEnterEditMode: () => void;
    enterEditModeFromPaused: () => void;
    handleResign: () => void;
    handleUndo: () => void;
    onOpenSettings: () => void;

    // パス関連
    shouldRenderPassButton: boolean;
    canMakePassMove: boolean;
    passButtonDisabledReason?: PassDisabledReason;
    handlePassMove: () => void;
    shouldShowPassConfirm: boolean;
}

export function PCBoardSection({
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
    candidateNote,
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
}: PCBoardSectionProps): ReactElement {
    const topHandInfo = getHandInfo("top");
    const bottomHandInfo = getHandInfo("bottom");

    return (
        <div className="flex flex-col gap-2 items-center shrink-0 self-center">
            <div ref={boardSectionRef} className="w-fit relative flex flex-col gap-2">
                <div
                    className={`flex flex-col gap-2 items-center ${isDraggingPiece ? "touch-none" : ""}`}
                >
                    {/* 時間管理（将棋盤の上） */}
                    <ClockDisplay clocks={clocks} isRunning={isMatchRunning} />

                    {/* 盤の上側の持ち駒（通常:後手、反転時:先手） */}
                    <div data-zone={`hand-${topHandInfo.owner}`} className="w-full">
                        {/* ステータス行: [手数] [手番] [反転ボタン] */}
                        <div className="flex items-center justify-end mb-1 gap-4">
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
                                    isAI={sides[position.turn].role === "engine"}
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

                        {/* 持ち駒表示 */}
                        <HandPiecesDisplay
                            owner={topHandInfo.owner}
                            hand={topHandInfo.hand}
                            selectedPiece={selection?.kind === "hand" ? selection.piece : null}
                            isActive={topHandInfo.isActive}
                            onHandSelect={handleHandSelect}
                            onPiecePointerDown={isEditMode ? handleHandPiecePointerDown : undefined}
                            isEditMode={isEditMode && !isMatchRunning}
                            isMatchRunning={isMatchRunning}
                            hideEmptyPieces={hideEmptyHandPieces}
                            onIncrement={(piece) => handleIncrementHand(topHandInfo.owner, piece)}
                            onDecrement={(piece) => handleDecrementHand(topHandInfo.owner, piece)}
                            flipBoard={flipBoard}
                            isAI={topHandInfo.isAI}
                        />
                        {/* パス権表示（上側プレイヤー） */}
                        {passRightsSettings && (
                            <div className="flex justify-end mt-1">
                                <PassRightsDisplay
                                    remaining={position.passRights?.[topHandInfo.owner] ?? 0}
                                    max={
                                        passRightsSettings.enabled
                                            ? topHandInfo.owner === "sente"
                                                ? passRightsSettings.senteInitialCount
                                                : passRightsSettings.goteInitialCount
                                            : 0
                                    }
                                    isActive={position.turn === topHandInfo.owner}
                                    compact
                                />
                            </div>
                        )}
                    </div>

                    {/* 盤面 */}
                    <ShogiBoard
                        grid={grid}
                        selectedSquare={
                            isEditMode && editFromSquare
                                ? editFromSquare
                                : selection?.kind === "square"
                                  ? selection.square
                                  : null
                        }
                        lastMove={
                            displaySettings.highlightLastMove && lastMove
                                ? {
                                      from: lastMove.from ?? undefined,
                                      to: lastMove.to,
                                  }
                                : undefined
                        }
                        promotionSquare={promotionSelection?.to ?? null}
                        onSelect={(sq, shiftKey) => {
                            void handleSquareSelect(sq, shiftKey);
                        }}
                        onPromotionChoice={handlePromotionChoice}
                        flipBoard={flipBoard}
                        onPiecePointerDown={isEditMode ? handlePiecePointerDown : undefined}
                        onPieceTogglePromote={isEditMode ? handlePieceTogglePromote : undefined}
                        isDraggable={isEditMode}
                        squareNotation={displaySettings.squareNotation}
                        showBoardLabels={displaySettings.showBoardLabels}
                    />
                    {candidateNote ? (
                        <div className={TEXT_CLASSES.mutedSecondary}>{candidateNote}</div>
                    ) : null}

                    {/* 盤の下側の持ち駒（通常:先手、反転時:後手） */}
                    <PlayerHandSection
                        owner={bottomHandInfo.owner}
                        hand={bottomHandInfo.hand}
                        selectedPiece={selection?.kind === "hand" ? selection.piece : null}
                        isActive={bottomHandInfo.isActive}
                        onHandSelect={handleHandSelect}
                        onPiecePointerDown={isEditMode ? handleHandPiecePointerDown : undefined}
                        isEditMode={isEditMode && !isMatchRunning}
                        isMatchRunning={isMatchRunning}
                        hideEmptyPieces={hideEmptyHandPieces}
                        onIncrement={(piece) => handleIncrementHand(bottomHandInfo.owner, piece)}
                        onDecrement={(piece) => handleDecrementHand(bottomHandInfo.owner, piece)}
                        flipBoard={flipBoard}
                        isAI={bottomHandInfo.isAI}
                    />
                    {/* パス権表示（下側プレイヤー） */}
                    {passRightsSettings && (
                        <div className="flex justify-start mt-1 w-full">
                            <PassRightsDisplay
                                remaining={position.passRights?.[bottomHandInfo.owner] ?? 0}
                                max={
                                    passRightsSettings.enabled
                                        ? bottomHandInfo.owner === "sente"
                                            ? passRightsSettings.senteInitialCount
                                            : passRightsSettings.goteInitialCount
                                        : 0
                                }
                                isActive={position.turn === bottomHandInfo.owner}
                                compact
                            />
                        </div>
                    )}

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
                            !(sides.sente.role === "engine" && sides.gote.role === "engine")
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

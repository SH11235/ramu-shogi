import type { LastMove, PieceType, Player, Square } from "@shogi/app-core";
import type { ReactElement } from "react";
import type { ShogiBoardCell, ShogiBoardPiece } from "../../shogi-board";
import { ShogiBoard } from "../../shogi-board";
import type { DisplaySettings, PassRightsSettings, PromotionSelection } from "../types";
import { HandPiecesDisplay } from "./HandPiecesDisplay";
import type { HandInfo } from "./MobileBoardSection";
import { PassRightsDisplay } from "./PassRightsDisplay";

type Selection = { kind: "square"; square: string } | { kind: "hand"; piece: PieceType };

interface PCBoardContentProps {
    // === 盤面データ ===
    grid: ShogiBoardCell[][];
    flipBoard: boolean;

    // === ハイライト ===
    lastMove?: LastMove;
    selection: Selection | null;
    promotionSelection: PromotionSelection | null;

    // === 表示設定 ===
    displaySettings: Pick<
        DisplaySettings,
        "highlightLastMove" | "squareNotation" | "showBoardLabels"
    >;

    // === 編集状態 ===
    /** 親で事前計算: isEditMode && !isMatchRunning */
    isEditModeActive: boolean;
    /** 対局中かどうか（持ち駒表示の制御に使用） */
    isMatchRunning: boolean;
    /** 0枚の駒を隠すか */
    hideEmptyHandPieces: boolean;
    editFromSquare: Square | null;
    candidateNote: string | null;

    // === イベントハンドラ ===
    onSquareSelect: (square: string, shiftKey?: boolean) => void;
    onPromotionChoice: (promote: boolean) => void;
    onHandSelect: (piece: PieceType) => void;

    // === 編集モード用ハンドラ ===
    onPiecePointerDown?: (square: string, piece: ShogiBoardPiece, e: React.PointerEvent) => void;
    onPieceTogglePromote?: (
        square: string,
        piece: ShogiBoardPiece,
        event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
    onHandPiecePointerDown?: (owner: Player, pieceType: PieceType, e: React.PointerEvent) => void;
    onIncrementHand?: (owner: Player, piece: PieceType) => void;
    onDecrementHand?: (owner: Player, piece: PieceType) => void;

    // === 持ち駒情報（親で事前計算） ===
    topHand: HandInfo;
    bottomHand: HandInfo;

    // === パス権表示（オプション） ===
    passRightsSettings?: PassRightsSettings;
    passRights?: { sente: number; gote: number };
    turn?: Player;
}

/**
 * PC版盤面コンテンツ（Propsベース）
 *
 * 盤面 + 上下の持ち駒 + パス権表示を描画する。
 * ClockDisplay・手数/手番/反転ボタン・MatchControls は含まない。
 * オフライン（PCBoardSection）・オンライン（online-game-view）で共用する。
 */
export function PCBoardContent({
    grid,
    flipBoard,
    lastMove,
    selection,
    promotionSelection,
    displaySettings,
    isEditModeActive,
    isMatchRunning,
    hideEmptyHandPieces,
    editFromSquare,
    candidateNote,
    onSquareSelect,
    onPromotionChoice,
    onHandSelect,
    onPiecePointerDown,
    onPieceTogglePromote,
    onHandPiecePointerDown,
    onIncrementHand,
    onDecrementHand,
    topHand,
    bottomHand,
    passRightsSettings,
    passRights,
    turn,
}: PCBoardContentProps): ReactElement {
    return (
        <>
            {/* 上側の持ち駒 */}
            <div data-zone={`hand-${topHand.owner}`} className="w-full">
                <HandPiecesDisplay
                    owner={topHand.owner}
                    hand={topHand.hand}
                    selectedPiece={selection?.kind === "hand" ? selection.piece : null}
                    isActive={topHand.isActive}
                    onHandSelect={onHandSelect}
                    onPiecePointerDown={isEditModeActive ? onHandPiecePointerDown : undefined}
                    isEditMode={isEditModeActive}
                    isMatchRunning={isMatchRunning}
                    hideEmptyPieces={hideEmptyHandPieces}
                    onIncrement={
                        onIncrementHand
                            ? (piece) => onIncrementHand(topHand.owner, piece)
                            : undefined
                    }
                    onDecrement={
                        onDecrementHand
                            ? (piece) => onDecrementHand(topHand.owner, piece)
                            : undefined
                    }
                    flipBoard={flipBoard}
                    size={isEditModeActive ? "edit" : "normal"}
                    isAI={topHand.isAI}
                />
                {/* パス権表示（上側プレイヤー） */}
                {passRightsSettings?.enabled &&
                    (passRightsSettings.senteInitialCount > 0 ||
                        passRightsSettings.goteInitialCount > 0) &&
                    passRights && (
                        <div className="flex justify-end mt-1">
                            <PassRightsDisplay
                                remaining={passRights[topHand.owner]}
                                max={
                                    topHand.owner === "sente"
                                        ? passRightsSettings.senteInitialCount
                                        : passRightsSettings.goteInitialCount
                                }
                                isActive={turn === topHand.owner}
                                compact
                            />
                        </div>
                    )}
            </div>

            {/* 盤面 */}
            <ShogiBoard
                grid={grid}
                selectedSquare={
                    isEditModeActive && editFromSquare
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
                onSelect={onSquareSelect}
                onPromotionChoice={onPromotionChoice}
                flipBoard={flipBoard}
                onPiecePointerDown={isEditModeActive ? onPiecePointerDown : undefined}
                onPieceTogglePromote={isEditModeActive ? onPieceTogglePromote : undefined}
                isDraggable={isEditModeActive}
                squareNotation={displaySettings.squareNotation}
                showBoardLabels={displaySettings.showBoardLabels}
            />

            {candidateNote ? (
                <div className="text-xs text-muted-foreground text-center">{candidateNote}</div>
            ) : null}

            {/* 下側の持ち駒 */}
            <div data-zone={`hand-${bottomHand.owner}`} className="w-full">
                <HandPiecesDisplay
                    owner={bottomHand.owner}
                    hand={bottomHand.hand}
                    selectedPiece={selection?.kind === "hand" ? selection.piece : null}
                    isActive={bottomHand.isActive}
                    onHandSelect={onHandSelect}
                    onPiecePointerDown={isEditModeActive ? onHandPiecePointerDown : undefined}
                    isEditMode={isEditModeActive}
                    isMatchRunning={isMatchRunning}
                    hideEmptyPieces={hideEmptyHandPieces}
                    onIncrement={
                        onIncrementHand
                            ? (piece) => onIncrementHand(bottomHand.owner, piece)
                            : undefined
                    }
                    onDecrement={
                        onDecrementHand
                            ? (piece) => onDecrementHand(bottomHand.owner, piece)
                            : undefined
                    }
                    flipBoard={flipBoard}
                    size={isEditModeActive ? "edit" : "normal"}
                    isAI={bottomHand.isAI}
                />
                {/* パス権表示（下側プレイヤー） */}
                {passRightsSettings?.enabled &&
                    (passRightsSettings.senteInitialCount > 0 ||
                        passRightsSettings.goteInitialCount > 0) &&
                    passRights && (
                        <div className="flex justify-start mt-1">
                            <PassRightsDisplay
                                remaining={passRights[bottomHand.owner]}
                                max={
                                    bottomHand.owner === "sente"
                                        ? passRightsSettings.senteInitialCount
                                        : passRightsSettings.goteInitialCount
                                }
                                isActive={turn === bottomHand.owner}
                                compact
                            />
                        </div>
                    )}
            </div>
        </>
    );
}

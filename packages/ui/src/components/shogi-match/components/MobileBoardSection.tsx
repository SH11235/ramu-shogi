import type { LastMove, PieceType, Player, PositionState, Square } from "@shogi/app-core";
import type { ReactElement, RefObject } from "react";
import type { ShogiBoardCell, ShogiBoardMoveShadow, ShogiBoardPiece } from "../../shogi-board";
import { ShogiBoard } from "../../shogi-board";
import { useMobileCellSize } from "../hooks/useMobileCellSize";
import type { DisplaySettings, PassRightsSettings, PromotionSelection } from "../types";
import { HandPiecesDisplay } from "./HandPiecesDisplay";
import { PassRightsDisplay } from "./PassRightsDisplay";

type Selection = { kind: "square"; square: string } | { kind: "hand"; piece: PieceType };

export type HandInfo = {
    owner: Player;
    hand: PositionState["hands"]["sente"] | PositionState["hands"]["gote"];
    isActive: boolean;
    isAI: boolean;
};

interface MobileBoardSectionProps {
    // === 盤面データ（変更頻度: 低） ===
    grid: ShogiBoardCell[][];
    position: PositionState;
    flipBoard: boolean;

    // === ハイライト（変更頻度: 中） ===
    lastMove?: LastMove;
    selection: Selection | null;
    /** 選んでいる駒の影（マウスを乗せた行き先に出す）。出さないときは省く */
    moveShadow?: ShogiBoardMoveShadow | null;
    promotionSelection: PromotionSelection | null;

    // === 表示設定（変更頻度: 低） ===
    displaySettings: Pick<
        DisplaySettings,
        "highlightLastMove" | "squareNotation" | "showBoardLabels"
    >;

    // === 編集状態 ===
    // 親で事前計算: isEditMode && !isMatchRunning
    isEditModeActive: boolean;
    /** 対局中かどうか（持ち駒表示の制御に使用） */
    isMatchRunning: boolean;
    /** 0枚の駒を隠すか（対局中・一時停止時に使用） */
    hideEmptyHandPieces: boolean;
    editFromSquare: Square | null;
    candidateNote: string | null;

    // === イベントハンドラ（メモ化必須） ===
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

    // === Ref / その他 ===
    boardSectionRef: RefObject<HTMLDivElement | null>;
    isDraggingPiece: boolean;

    // === パス権表示（オプション） ===
    /** パス権設定 */
    passRightsSettings?: PassRightsSettings;
    /** 現在のパス権状態 */
    passRights?: { sente: number; gote: number };
    /** 現在の手番 */
    turn?: Player;
    /** ヒントとして盤に示す手（対局画面） */
    hintMove?: { from?: string | null; to: string; side?: Player } | null;
    /** マスの大きさ（px）。指定すると、親の幅から決めずにこの大きさで描く。 */
    cellSize?: number;
    /** 親の幅から決めるときのマスの下限（px）。親の幅がこれより狭いと盤ははみ出す。 */
    minCellSize?: number;
}

/**
 * モバイル用盤面セクション
 * useMobileCellSize()を内部で呼び、CSS変数を設定
 */
export function MobileBoardSection({
    grid,
    flipBoard,
    lastMove,
    selection,
    moveShadow,
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
    boardSectionRef,
    isDraggingPiece,
    passRightsSettings,
    passRights,
    turn,
    hintMove,
    cellSize: fixedCellSize,
    minCellSize,
}: MobileBoardSectionProps): ReactElement {
    const fittedCellSize = useMobileCellSize(boardSectionRef, minCellSize);
    const cellSize = fixedCellSize ?? fittedCellSize;
    // 持っていない駒を出さないとき、持ち駒が 1 枚も無い段は中身が無くなる。駒を取った・打ったときに
    // 盤が上下に動かないよう、駒がある段と同じ高さ（駒台の枠の高さ。下限 34px）を確保する。
    const handZoneClass = hideEmptyHandPieces
        ? "min-h-[max(34px,calc(var(--shogi-cell-size)*0.8+15px))]"
        : undefined;

    return (
        <div
            ref={boardSectionRef}
            className={`relative flex w-fit max-w-full flex-col gap-1 ${isDraggingPiece ? "touch-none" : ""}`}
            style={
                {
                    "--shogi-cell-size": `${cellSize}px`,
                } as React.CSSProperties
            }
        >
            {/* 上側の持ち駒 */}
            <div data-zone={`hand-${topHand.owner}`} className={handZoneClass}>
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
                    size={isEditModeActive ? "edit" : "medium"}
                    isAI={topHand.isAI}
                />
                {/* パス権表示（上側プレイヤー） */}
                {passRightsSettings?.enabled &&
                    (passRightsSettings.senteInitialCount > 0 ||
                        passRightsSettings.goteInitialCount > 0) &&
                    passRights && (
                        <div className="flex justify-end mt-0.5">
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
                moveShadow={isEditModeActive ? null : moveShadow}
                hintMove={hintMove}
            />

            {candidateNote ? (
                <div className="text-xs text-muted-foreground text-center">{candidateNote}</div>
            ) : null}

            {/* 下側の持ち駒 */}
            <div data-zone={`hand-${bottomHand.owner}`} className={handZoneClass}>
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
                    size={isEditModeActive ? "edit" : "medium"}
                    isAI={bottomHand.isAI}
                />
                {/* パス権表示（下側プレイヤー） */}
                {passRightsSettings?.enabled &&
                    (passRightsSettings.senteInitialCount > 0 ||
                        passRightsSettings.goteInitialCount > 0) &&
                    passRights && (
                        <div className="flex justify-start mt-0.5">
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
        </div>
    );
}

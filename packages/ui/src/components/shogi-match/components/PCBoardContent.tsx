import type { LastMove, PieceType, Player, Square } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import type { ShogiBoardCell, ShogiBoardMoveShadow, ShogiBoardPiece } from "../../shogi-board";
import { ShogiBoard } from "../../shogi-board";
import type { DisplaySettings, PassRightsSettings, PromotionSelection } from "../types";
import { type HandFrame, HandPiecesDisplay } from "./HandPiecesDisplay";
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
    /** 選んでいる駒の影（マウスを乗せた行き先に出す）。出さないときは省く */
    moveShadow?: ShogiBoardMoveShadow | null;
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
    /** 持ち駒の欄の大きさ（省略時は、編集中は "edit"、それ以外は "normal"） */
    handSize?: "medium" | "normal";
    /**
     * 持ち駒の置き場所。"rows" は盤の上下に横長で、"sides" は盤の左右に縦長で置く
     * （上側の持ち駒は盤の左上、下側の持ち駒は盤の右下。実物の駒台と同じ向き）。
     */
    handPlacement?: "rows" | "sides";
    /** 持ち駒の駒台の枠の見た目（対局画面・研究ノートは "outline"） */
    handFrame?: HandFrame;
    /** ヒントとして盤に示す手（対局画面） */
    hintMove?: { from?: string | null; to: string; side?: Player } | null;
    /** 盤の上に重ねて出すもの（終局の判子など） */
    boardOverlay?: ReactNode;
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
    passRightsSettings,
    passRights,
    turn,
    hintMove,
    boardOverlay,
    handSize = "normal",
    handPlacement = "rows",
    handFrame = "muted",
}: PCBoardContentProps): ReactElement {
    const sides = handPlacement === "sides";
    // 縦の駒台は盤と同じ高さの枠に固定する（駒の数で枠が伸び縮みしないように）。上側の駒は上に、
    // 下側の駒は下に（それぞれ持ち主の近くに）寄せる。幅も空のときから同じだけ取る（盤が横に動かないように）。
    // 駒（マスの 0.8 倍）に、駒の枠と欄の余白・枠線でおよそ 20px。編集中は ± の 2 つ（16px × 2）を足して 52px。
    const sideZoneClass = isEditModeActive
        ? "w-[calc(var(--shogi-cell-size,48px)*0.8+52px)]"
        : "w-[calc(var(--shogi-cell-size,48px)*0.8+20px)]";
    const topHandBlock = (
        <div
            data-zone={`hand-${topHand.owner}`}
            className={sides ? cn("shrink-0 self-stretch", sideZoneClass) : "w-full"}
        >
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
                    onIncrementHand ? (piece) => onIncrementHand(topHand.owner, piece) : undefined
                }
                onDecrement={
                    onDecrementHand ? (piece) => onDecrementHand(topHand.owner, piece) : undefined
                }
                flipBoard={flipBoard}
                size={isEditModeActive ? "edit" : handSize}
                isAI={topHand.isAI}
                vertical={sides}
                verticalAlign="start"
                frame={handFrame}
                // outline の画面（対局・研究ノート）では、駒を取ったときに盤や操作が動かないよう、空の段も高さを取る。
                reserveHeight={handFrame === "outline"}
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
    );

    const board = (
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
            overlay={boardOverlay}
        />
    );
    const note = candidateNote ? (
        <div className="text-xs text-muted-foreground text-center">{candidateNote}</div>
    ) : null;

    const bottomHandBlock = (
        <div
            data-zone={`hand-${bottomHand.owner}`}
            className={sides ? cn("shrink-0 self-stretch", sideZoneClass) : "w-full"}
        >
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
                size={isEditModeActive ? "edit" : handSize}
                isAI={bottomHand.isAI}
                vertical={sides}
                verticalAlign="end"
                frame={handFrame}
                reserveHeight={handFrame === "outline"}
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
    );

    if (sides) {
        return (
            // 駒台の高さは盤だけに合わせる（盤の下の注記が出ても、駒台が伸び縮みしないように注記は行の外に置く）。
            <div className="flex flex-col items-center gap-1">
                <div className="flex items-stretch gap-2">
                    {topHandBlock}
                    {board}
                    {bottomHandBlock}
                </div>
                {note}
            </div>
        );
    }
    return (
        <>
            {topHandBlock}
            {board}
            {note}
            {bottomHandBlock}
        </>
    );
}

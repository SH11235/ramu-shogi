import type { PieceType } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useRef } from "react";
import type { SquareNotation } from "./shogi-match/types";
import { getPieceImagePath, PIECE_LABELS } from "./shogi-match/utils/constants";
import { formatSquare, getBoardLabels } from "./shogi-match/utils/coordinateFormat";

type ShogiBoardOwner = "sente" | "gote";

export interface ShogiBoardPiece {
    owner: ShogiBoardOwner;
    type: PieceType;
    promoted?: boolean;
}

export interface ShogiBoardCell {
    id: string;
    piece: ShogiBoardPiece | null;
}

interface ShogiBoardProps {
    grid: ShogiBoardCell[][];
    selectedSquare?: string | null;
    lastMove?: { from?: string | null; to?: string | null };
    promotionSquare?: string | null;
    onSelect?: (square: string, shiftKey?: boolean) => void;
    onPromotionChoice?: (promote: boolean) => void;
    /** 盤面を反転表示するか（後手視点） */
    flipBoard?: boolean;
    /** 駒の PointerDown イベント（DnD 用） */
    onPiecePointerDown?: (
        square: string,
        piece: ShogiBoardPiece,
        event: React.PointerEvent,
    ) => void;
    /** 盤上の成/不成トグル（編集モード用） */
    onPieceTogglePromote?: (
        square: string,
        piece: ShogiBoardPiece,
        event: React.MouseEvent<HTMLButtonElement>,
    ) => void;
    /** ドラッグ操作を有効にするか（trueの場合、タッチスクロールを防止） */
    isDraggable?: boolean;
    /** マス内座標表示形式 */
    squareNotation?: SquareNotation;
    /** 盤外ラベル（筋・段）を表示するか */
    showBoardLabels?: boolean;
}

/**
 * 将棋盤コンポーネント
 */
export function ShogiBoard({
    grid,
    selectedSquare,
    lastMove,
    promotionSquare,
    onSelect,
    onPromotionChoice,
    flipBoard = false,
    onPiecePointerDown,
    onPieceTogglePromote,
    isDraggable = false,
    squareNotation = "none",
    showBoardLabels = false,
}: ShogiBoardProps): ReactElement {
    const lastPointerTypeRef = useRef<"mouse" | "touch" | "pen" | null>(null);
    const { files, ranks } = getBoardLabels(flipBoard);

    return (
        <div className="relative inline-block rounded-lg border border-[hsl(var(--shogi-outer-border))] bg-[hsl(var(--shogi-cell-light))] shadow-[0_4px_12px_rgba(0,0,0,0.12)]">
            {/* 盤外ラベル: 筋（上） */}
            <div
                className={cn(
                    "grid grid-cols-9 py-0.5 text-center text-[11px] font-semibold text-[hsl(var(--wafuu-sumi)/0.7)] [text-shadow:0_1px_0_rgba(255,255,255,0.5)] ml-[1.25em] mr-[1.25em]",
                    showBoardLabels ? "visible" : "invisible",
                )}
            >
                {files.map((label) => (
                    <span key={label}>{label}</span>
                ))}
            </div>
            <div className="flex">
                {/* 左パディング - 右ラベルと対称のスペース確保 */}
                <div className="px-0.5 flex flex-col justify-around text-[11px]" aria-hidden="true">
                    {ranks.map((label) => (
                        <span key={`left-${label}`} className="invisible">
                            {label}
                        </span>
                    ))}
                </div>
                <div className="grid flex-1 grid-cols-9 overflow-hidden rounded-xl border-l border-t border-[hsl(var(--shogi-border))]">
                    {grid.map((row, rowIndex) =>
                        row.map((cell, columnIndex) => {
                            const isSelected = selectedSquare === cell.id;
                            const isLastMoveTo = cell.id === lastMove?.to;
                            const isLastMoveFrom =
                                cell.id === lastMove?.from && lastMove?.from !== null;
                            const isPromotionSquare = promotionSquare === cell.id;

                            // 背景色: ハイライト時は上書き、通常時はチェッカーパターン
                            const isHighlighted = isLastMoveTo || isLastMoveFrom || isSelected;
                            const baseTone =
                                (rowIndex + columnIndex) % 2 === 0
                                    ? "bg-[hsl(var(--shogi-cell-light))]"
                                    : "bg-[hsl(var(--shogi-cell-dark))]";

                            return (
                                <div
                                    key={cell.id}
                                    className="relative aspect-square w-[var(--shogi-cell-size,48px)] border-b border-r border-[hsl(var(--shogi-border))]"
                                >
                                    <button
                                        type="button"
                                        data-square={cell.id}
                                        onPointerDown={(e) => {
                                            lastPointerTypeRef.current = e.pointerType;
                                            if (cell.piece && onPiecePointerDown) {
                                                // タッチ操作時のみpreventDefault（マウスクリックのフォーカス処理は維持）
                                                if (e.pointerType === "touch") {
                                                    e.preventDefault();
                                                }
                                                onPiecePointerDown(cell.id, cell.piece, e);
                                            }
                                        }}
                                        onDoubleClick={(e) => {
                                            if (cell.piece && onPieceTogglePromote) {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onPieceTogglePromote(cell.id, cell.piece, e);
                                            }
                                        }}
                                        onContextMenu={(e) => {
                                            if (!cell.piece || !onPieceTogglePromote) return;
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (lastPointerTypeRef.current === "touch") return;
                                            onPieceTogglePromote(cell.id, cell.piece, e);
                                        }}
                                        onClick={(e) => onSelect?.(cell.id, e.shiftKey)}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter" && e.shiftKey) {
                                                // Shift+Enter で即座に成る
                                                e.preventDefault();
                                                onSelect?.(cell.id, true);
                                            } else if (e.key === "Escape") {
                                                // Escape でキャンセル
                                                e.preventDefault();
                                                onSelect?.(cell.id, false);
                                            }
                                        }}
                                        aria-label={
                                            cell.piece
                                                ? `${cell.id} ${cell.piece.owner === "sente" ? "先手" : "後手"}の${PIECE_LABELS[cell.piece.type] ?? cell.piece.type}${cell.piece.promoted ? "成" : ""}。Shift+クリックで成って移動`
                                                : `${cell.id} 空マス`
                                        }
                                        className={cn(
                                            "absolute inset-0 overflow-hidden text-base font-semibold transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[hsl(var(--wafuu-shu))]/70 focus-visible:ring-offset-transparent",
                                            "hover:ring-2 hover:ring-inset hover:ring-[hsl(var(--shogi-border))]",
                                            // タッチ選択・長押しメニュー防止
                                            "select-none [-webkit-touch-callout:none]",
                                            // ドラッグ可能時はスクロールも防止
                                            isDraggable ? "touch-none" : "touch-manipulation",
                                            // 背景色: ハイライト時は専用色、通常時はチェッカーパターン
                                            !isHighlighted && baseTone,
                                            // 移動先ハイライト - 濃い金色
                                            isLastMoveTo &&
                                                !isSelected &&
                                                "bg-[hsl(45_85%_62%)] ring-2 ring-inset ring-[hsl(45_90%_40%)]",
                                            // 移動元ハイライト - 薄い金色（痕跡）
                                            isLastMoveFrom &&
                                                !isSelected &&
                                                "bg-[hsl(45_60%_78%)] ring-1 ring-inset ring-[hsl(45_50%_55%)]",
                                            // 選択中 - リング + 薄い金色背景
                                            isSelected &&
                                                "bg-[hsl(var(--wafuu-kin))] ring-[3px] ring-inset ring-[hsl(var(--wafuu-shu))]",
                                        )}
                                    >
                                        {cell.piece ? (
                                            <span
                                                className={cn(
                                                    "relative flex h-full w-full items-center justify-center",
                                                    flipBoard
                                                        ? cell.piece.owner === "sente" &&
                                                              "-rotate-180"
                                                        : cell.piece.owner === "gote" &&
                                                              "-rotate-180",
                                                )}
                                            >
                                                <img
                                                    src={
                                                        getPieceImagePath(
                                                            cell.piece.owner,
                                                            cell.piece.type,
                                                            cell.piece.promoted,
                                                        ) ?? ""
                                                    }
                                                    alt={`${cell.piece.owner === "sente" ? "先手" : "後手"}の${PIECE_LABELS[cell.piece.type] ?? cell.piece.type}${cell.piece.promoted ? "成" : ""}`}
                                                    className="h-[90%] w-[90%] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.15)]"
                                                    draggable={false}
                                                />
                                            </span>
                                        ) : null}
                                        {squareNotation !== "none" && (
                                            <span className="pointer-events-none absolute left-1 top-1 text-[9px] font-medium text-shogi-coord-text">
                                                {formatSquare(cell.id, squareNotation)}
                                            </span>
                                        )}
                                    </button>
                                    {isPromotionSquare && onPromotionChoice && (
                                        <div
                                            className="absolute inset-0 z-10 flex flex-col gap-[2px] p-[2px]"
                                            role="dialog"
                                            aria-label="成り選択"
                                            aria-live="assertive"
                                        >
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onPromotionChoice(true);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" || e.key === " ") {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        onPromotionChoice(true);
                                                    } else if (e.key === "Escape") {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        onPromotionChoice(false);
                                                    }
                                                }}
                                                aria-label="成る"
                                                className="flex-1 rounded-t-md bg-gradient-to-b from-[hsl(var(--wafuu-shu))] to-[hsl(var(--wafuu-shu)/0.8)] text-[14px] font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl active:scale-95 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2"
                                            >
                                                成
                                            </button>
                                            <button
                                                type="button"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onPromotionChoice(false);
                                                }}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter" || e.key === " ") {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        onPromotionChoice(false);
                                                    } else if (e.key === "Escape") {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        onPromotionChoice(false);
                                                    }
                                                }}
                                                aria-label="成らない"
                                                className="flex-1 rounded-b-md bg-gradient-to-b from-wafuu-ai to-wafuu-ai/80 text-[12px] font-bold text-white shadow-lg transition-all hover:scale-105 hover:shadow-xl active:scale-95 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2"
                                            >
                                                不成
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        }),
                    )}
                </div>
                {/* 盤外ラベル: 段（右） */}
                <div
                    className={cn(
                        "flex flex-col justify-around px-0.5 text-[11px] font-semibold text-[hsl(var(--wafuu-sumi)/0.7)] [text-shadow:0_1px_0_rgba(255,255,255,0.5)]",
                        showBoardLabels ? "visible" : "invisible",
                    )}
                >
                    {ranks.map((label) => (
                        <span key={label}>{label}</span>
                    ))}
                </div>
            </div>
            {/* 下パディング - 上ラベルと対称のスペース確保 */}
            <div
                className="grid grid-cols-9 py-0.5 text-center text-[11px] ml-[1.25em] mr-[1.25em]"
                aria-hidden="true"
            >
                {files.map((label) => (
                    <span key={`bottom-${label}`} className="invisible">
                        {label}
                    </span>
                ))}
            </div>
        </div>
    );
}

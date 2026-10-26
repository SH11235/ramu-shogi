import type { PieceType } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { useRef } from "react";
import { useBoardPattern } from "./shogi-match/hooks/useBoardPattern";
import type { SquareNotation } from "./shogi-match/types";
import { getPieceImagePath, PIECE_LABELS } from "./shogi-match/utils/constants";
import { formatSquare, getBoardLabels } from "./shogi-match/utils/coordinateFormat";

type ShogiBoardOwner = "sente" | "gote";

/**
 * 影を出すマスに付けるクラス。疑似要素に、盤のルートで渡した駒の画像（CSS 変数）を敷き、
 * `:hover` のときだけ半透明で見せる。
 */
const MOVE_SHADOW_CLASS =
    "after:pointer-events-none after:absolute after:inset-[5%] after:bg-contain after:bg-center after:bg-no-repeat after:opacity-0 after:content-[''] after:[background-image:var(--shogi-move-shadow-image)] [@media(hover:hover)]:hover:after:opacity-45";

export interface ShogiBoardPiece {
    owner: ShogiBoardOwner;
    type: PieceType;
    promoted?: boolean;
}

export interface ShogiBoardCell {
    id: string;
    piece: ShogiBoardPiece | null;
}

/** 選んでいる駒の「影」。マウスを乗せた行き先のマスに、この駒を半透明で出す。 */
export interface ShogiBoardMoveShadow {
    /** 影として出す駒（いま選んでいる駒） */
    piece: ShogiBoardPiece;
    /** 影を出すマス（合法な行き先） */
    targets: ReadonlySet<string>;
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
    /**
     * 選んでいる駒の影。行き先のマスにマウスを乗せたときだけ、CSS の `:hover` で出す
     * （マウスの動きを JavaScript で追わないので、動かしても再描画は起きない）。
     * ホバーできない端末（タッチ）では出ない。
     */
    moveShadow?: ShogiBoardMoveShadow | null;
    /** ヒントとして示す手（動かす駒のマスと行き先。打つ手は行き先だけ）。枠で示す。 */
    hintMove?: { from?: string | null; to: string; side?: ShogiBoardOwner } | null;
    /** 盤の上に重ねて出すもの（終局の判子など）。盤の枠いっぱいの位置の基準で置く */
    overlay?: ReactNode;
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
    moveShadow = null,
    hintMove = null,
    overlay,
}: ShogiBoardProps): ReactElement {
    const [boardPattern] = useBoardPattern();
    const lastPointerTypeRef = useRef<"mouse" | "touch" | "pen" | null>(null);
    const { files, ranks } = getBoardLabels(flipBoard);

    // 成り選択が出ている間は、次に押すのは成・不成なので影は出さない
    const shadow = moveShadow && !promotionSquare ? moveShadow : null;
    const shadowStyle = shadow
        ? ({
              "--shogi-move-shadow-image": `url("${getPieceImagePath(
                  shadow.piece.owner,
                  shadow.piece.type,
                  shadow.piece.promoted,
              )}")`,
          } as CSSProperties)
        : undefined;
    // 盤上の駒と同じ規則で、相手側の駒は逆さにする
    const isShadowUpsideDown = shadow
        ? flipBoard
            ? shadow.piece.owner === "sente"
            : shadow.piece.owner === "gote"
        : false;

    return (
        <div className="relative inline-block" style={shadowStyle}>
            {/* 盤外ラベル: 筋（上） */}
            <div
                className={cn(
                    "grid grid-cols-9 py-0.5 text-center text-[11px] font-semibold text-muted-foreground ml-[1.25em] mr-[1.25em]",
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
                {/* 角は直角にする。丸めると、隅のマスの駒が角で欠ける。外周は outline を足して内側の線より太く見せる。 */}
                <div className="grid flex-1 grid-cols-9 overflow-hidden border-l border-t border-shogi-border outline outline-1 outline-shogi-border">
                    {grid.map((row, rowIndex) =>
                        row.map((cell, columnIndex) => {
                            const isSelected = selectedSquare === cell.id;
                            const isLastMoveTo = cell.id === lastMove?.to;
                            const isLastMoveFrom =
                                cell.id === lastMove?.from && lastMove?.from !== null;
                            const isPromotionSquare = promotionSquare === cell.id;
                            const isShadowTarget = shadow?.targets.has(cell.id) ?? false;
                            const isHintTo = hintMove?.to === cell.id;
                            const isHintFrom = hintMove?.from === cell.id;

                            // 背景色: ハイライト時は上書き、通常時は設定の模様（市松 / 無地）
                            const isHighlighted = isLastMoveTo || isLastMoveFrom || isSelected;
                            const baseTone =
                                boardPattern === "plain" || (rowIndex + columnIndex) % 2 === 0
                                    ? "bg-shogi-cell-light"
                                    : "bg-shogi-cell-dark";

                            return (
                                <div
                                    key={cell.id}
                                    className="relative aspect-square w-[var(--shogi-cell-size,48px)] border-b border-r border-shogi-border"
                                >
                                    {(isHintTo || isHintFrom) && (
                                        <span
                                            aria-hidden
                                            data-hint={isHintTo ? "to" : "from"}
                                            className={cn(
                                                "pointer-events-none absolute inset-0 z-10 rounded-sm",
                                                // 色は指す側の色（先手 = 朱、後手 = 藍）。
                                                hintMove?.side === "sente"
                                                    ? isHintTo
                                                        ? "bg-wafuu-shu/20 ring-[3px] ring-inset ring-wafuu-shu"
                                                        : "border-2 border-dashed border-wafuu-shu"
                                                    : isHintTo
                                                      ? "bg-wafuu-ai/25 ring-[3px] ring-inset ring-wafuu-ai"
                                                      : "border-2 border-dashed border-wafuu-ai",
                                            )}
                                        />
                                    )}
                                    <button
                                        type="button"
                                        data-square={cell.id}
                                        data-move-shadow={isShadowTarget ? "" : undefined}
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
                                            "absolute inset-0 overflow-hidden text-base font-semibold transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-wafuu-shu/70 focus-visible:ring-offset-transparent",
                                            "hover:ring-2 hover:ring-inset hover:ring-shogi-border",
                                            // タッチ選択・長押しメニュー防止
                                            "select-none [-webkit-touch-callout:none]",
                                            // ドラッグ可能時はスクロールも防止
                                            isDraggable ? "touch-none" : "touch-manipulation",
                                            // 背景色: ハイライト時は専用色、通常時はチェッカーパターン
                                            !isHighlighted && baseTone,
                                            // 移動先ハイライト - 濃い金色
                                            isLastMoveTo &&
                                                !isSelected &&
                                                "bg-shogi-last-move-to ring-2 ring-inset ring-shogi-last-move-to-ring",
                                            // 移動元ハイライト - 薄い金色（痕跡）
                                            isLastMoveFrom &&
                                                !isSelected &&
                                                "bg-shogi-last-move-from ring-1 ring-inset ring-shogi-last-move-from-ring",
                                            // 選択中 - リング + 薄い金色背景
                                            isSelected &&
                                                "bg-wafuu-kin ring-[3px] ring-inset ring-wafuu-shu",
                                            // 選んでいる駒の影（行き先のマスだけ。ホバーできる端末のみ）
                                            isShadowTarget && MOVE_SHADOW_CLASS,
                                            isShadowTarget &&
                                                isShadowUpsideDown &&
                                                "after:rotate-180",
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
                                            // 行き先のマスの外（盤の内側へ寄せた上か下）に、マス 3 つ分の幅で左右に
                                            // 並べる。行き先の駒を隠さず、指で押し分けられる大きさにする。
                                            className={cn(
                                                "absolute z-20 flex h-[150%] w-[300%] gap-1.5 p-1",
                                                columnIndex === 0
                                                    ? "left-0"
                                                    : columnIndex === 8
                                                      ? "right-0"
                                                      : "-left-full",
                                                rowIndex <= 4 ? "top-full" : "bottom-full",
                                            )}
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
                                                className="flex-1 rounded-md border-2 border-wafuu-sumi bg-wafuu-kin text-[15px] font-bold text-wafuu-sumi shadow-lg transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                                                className="flex-1 rounded-md border-2 border-wafuu-sumi bg-background text-[15px] font-bold text-wafuu-sumi shadow-lg transition-transform hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                        "flex flex-col justify-around px-0.5 text-[11px] font-semibold text-muted-foreground",
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
            {overlay}
        </div>
    );
}

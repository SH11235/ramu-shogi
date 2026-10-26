import type { Player, PositionState } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import { type CSSProperties, type ReactElement, useState } from "react";
import { DEFAULT_SHOGI_CELL_SIZE, ShogiBoard } from "./shogi-board";
import { HandPiecesDisplay } from "./shogi-match/components/HandPiecesDisplay";
import { cellSizeForWidth, useElementWidth } from "./shogi-match/hooks/useMobileCellSize";
import type { SquareNotation } from "./shogi-match/types";
import { boardToGrid } from "./shogi-match/utils/positionUtils";

type StaticHandSize = "compact" | "medium" | "normal";

/** 置き場所の幅に合わせてマスの大きさを決めるときの範囲。 */
interface BoardFit {
    minCellSize: number;
    maxCellSize: number;
    /** 幅を測る前の見積もりで、画面の幅から引く分（置き場所の左右の余白など）。測ったあとは使わない。 */
    viewportInset?: number;
}

interface StaticBoardViewProps {
    position: Pick<PositionState, "board" | "hands">;
    /** 後手を手前にする（盤の並びと持ち駒の上下を入れ替える） */
    flipBoard?: boolean;
    lastMove?: { from?: string | null; to?: string | null };
    squareNotation?: SquareNotation;
    showBoardLabels?: boolean;
    /**
     * 持ち駒の大きさ。"auto" は置き場所の幅で選ぶ（7 種類を 1 行に並べられる大きさにする）。
     */
    handSize?: StaticHandSize | "auto";
    /** 持っていない駒を出さない（全部無ければ段ごと出さない） */
    hideEmptyHandPieces?: boolean;
    /** 持ち駒が無い段も 1 段分の高さを取る（手を送るたびに盤が上下に動かないように） */
    reserveHandHeight?: boolean;
    /** 置き場所の幅に合わせる。省くとマスは既定の大きさ */
    fit?: BoardFit;
    className?: string;
}

/** 画面の幅が分からないとき（サーバー側など）の見積もり。既定の大きさの盤が収まる幅。 */
const FALLBACK_WIDTH = 560;
/** 持ち駒を medium / normal で 7 種類並べられる幅。これより狭ければ 1 段小さくする。 */
const MEDIUM_HAND_MIN_WIDTH = 330;
const NORMAL_HAND_MIN_WIDTH = 560;

function handSizeForWidth(width: number): StaticHandSize {
    if (width < MEDIUM_HAND_MIN_WIDTH) return "compact";
    if (width < NORMAL_HAND_MIN_WIDTH) return "medium";
    return "normal";
}

/**
 * 見るだけの盤（盤と、その上下の持ち駒）。駒は動かせない。
 * `--shogi-cell-size` を自分で決めるので、盤と持ち駒の大きさは置き場所によらずそろう。
 */
export function StaticBoardView({
    position,
    flipBoard = false,
    lastMove,
    squareNotation,
    showBoardLabels,
    handSize = "medium",
    hideEmptyHandPieces = false,
    reserveHandHeight = false,
    fit,
    className,
}: StaticBoardViewProps): ReactElement {
    const [root, setRoot] = useState<HTMLDivElement | null>(null);
    const measuredWidth = useElementWidth(root);
    // 測る前は画面の幅からの見積もりで描く（測るまでの 1 コマ、盤がはみ出さないように）。
    const width =
        measuredWidth ??
        (typeof document === "undefined"
            ? FALLBACK_WIDTH
            : document.documentElement.clientWidth - (fit?.viewportInset ?? 0));
    const cellSize = fit
        ? Math.max(
              fit.minCellSize,
              Math.min(cellSizeForWidth(width, fit.minCellSize), fit.maxCellSize),
          )
        : DEFAULT_SHOGI_CELL_SIZE;
    const resolvedHandSize = handSize === "auto" ? handSizeForWidth(width) : handSize;

    // ShogiBoard は grid を並べ替えないので、後手を手前にするときは盤の並びをここで逆にする。
    const grid = boardToGrid(position.board);
    const orientedGrid = flipBoard ? [...grid].reverse().map((row) => [...row].reverse()) : grid;
    const hand = (owner: Player) => (
        <HandPiecesDisplay
            owner={owner}
            hand={position.hands[owner]}
            flipBoard={flipBoard}
            size={resolvedHandSize}
            hideEmptyPieces={hideEmptyHandPieces}
            reserveHeight={reserveHandHeight}
        />
    );

    return (
        <div
            ref={setRoot}
            className={cn("flex flex-col", className)}
            style={{ "--shogi-cell-size": `${cellSize}px` } as CSSProperties}
        >
            {hand(flipBoard ? "sente" : "gote")}
            <ShogiBoard
                grid={orientedGrid}
                flipBoard={flipBoard}
                lastMove={lastMove}
                squareNotation={squareNotation}
                showBoardLabels={showBoardLabels}
            />
            {hand(flipBoard ? "gote" : "sente")}
        </div>
    );
}

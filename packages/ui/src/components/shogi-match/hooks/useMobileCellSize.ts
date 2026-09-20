import type { RefObject } from "react";
import { useEffect, useState } from "react";

const BOARD_CELLS = 9;
// 左右の段ラベル (15px × 2)、外枠 (2px)、盤の左罫線 (1px)。
const BOARD_DECORATION_WIDTH = 33;
const MIN_CELL_SIZE = 28;
const MAX_CELL_SIZE = 52;

function cellSizeForWidth(width: number): number {
    return Math.max(
        MIN_CELL_SIZE,
        Math.min(MAX_CELL_SIZE, Math.floor((width - BOARD_DECORATION_WIDTH) / BOARD_CELLS)),
    );
}

/** 盤の親コンテナの幅に合わせる。高さが足りない画面ではページをスクロールする。 */
export function useMobileCellSize(boardRef: RefObject<HTMLElement | null>): number {
    const [cellSize, setCellSize] = useState(() =>
        typeof document === "undefined"
            ? 28
            : cellSizeForWidth(document.documentElement.clientWidth - 16),
    );

    useEffect(() => {
        const container = boardRef.current?.parentElement;
        if (!container) return;
        const update = () => setCellSize(cellSizeForWidth(container.clientWidth));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(container);
        return () => observer.disconnect();
    }, [boardRef]);

    return cellSize;
}

import type { RefObject } from "react";
import { useEffect, useState } from "react";

const BOARD_CELLS = 9;
// 左右の段ラベル (15px × 2)、外枠 (2px)、盤の左罫線 (1px)。
const BOARD_DECORATION_WIDTH = 33;
const MIN_CELL_SIZE = 28;
const MAX_CELL_SIZE = 52;

/** 盤を置く幅（px）に収まるマスの大きさ。`minCellSize` より小さくはしない（幅が足りなければはみ出す）。 */
export function cellSizeForWidth(width: number, minCellSize = MIN_CELL_SIZE): number {
    return Math.max(
        minCellSize,
        Math.min(MAX_CELL_SIZE, Math.floor((width - BOARD_DECORATION_WIDTH) / BOARD_CELLS)),
    );
}

/** 要素の幅（clientWidth）が変わるたびに `onWidth` を呼ぶ。返り値で監視をやめる。 */
function observeWidth(element: HTMLElement, onWidth: (width: number) => void): () => void {
    const update = () => {
        // 隠している間（display:none）は幅 0 になる。そのまま渡すと最小のマスになり、
        // 表示した瞬間に盤が小さく出てから広がるので、見えるまでは前の幅を保つ。
        if (element.clientWidth === 0) return;
        onWidth(element.clientWidth);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
}

/**
 * 要素の幅を測る。測るまでは null。要素を state（コールバック ref）で受けるのは、ダイアログの中身のように
 * あとから現れる要素でも、現れたときに測り始めるため（ref だと effect が走り直さない）。
 */
export function useElementWidth(element: HTMLElement | null): number | null {
    const [width, setWidth] = useState<number | null>(null);
    useEffect(() => {
        if (!element) return;
        return observeWidth(element, setWidth);
    }, [element]);
    return width;
}

/** 盤の親コンテナの幅に合わせる。高さが足りない画面ではページをスクロールする。 */
export function useMobileCellSize(
    boardRef: RefObject<HTMLElement | null>,
    minCellSize = MIN_CELL_SIZE,
): number {
    const [cellSize, setCellSize] = useState(() =>
        typeof document === "undefined"
            ? minCellSize
            : cellSizeForWidth(document.documentElement.clientWidth - 16, minCellSize),
    );

    useEffect(() => {
        const container = boardRef.current?.parentElement;
        if (!container) return;
        return observeWidth(container, (width) =>
            setCellSize(cellSizeForWidth(width, minCellSize)),
        );
    }, [boardRef, minCellSize]);

    return cellSize;
}

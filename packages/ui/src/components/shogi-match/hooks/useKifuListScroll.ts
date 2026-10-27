import { useEffect, useRef } from "react";
import type { KifuViewMode } from "./useKifuViewState";

/**
 * 本譜ビューのスクロールを管理する。
 * 今の手を一覧の中央に寄せ、本譜から別のビューへ移って戻ったときはスクロール位置を戻す。
 * `listRef` は本譜の一覧に、`currentRowRef` は今の手の行に付ける。
 */
export function useKifuListScroll({
    viewMode,
    currentPly,
    moveCount,
}: {
    viewMode: KifuViewMode;
    currentPly: number;
    moveCount: number;
}) {
    const listRef = useRef<HTMLDivElement>(null);
    const currentRowRef = useRef<HTMLDivElement>(null);
    const mainScrollPositionRef = useRef<number>(0);
    const prevViewModeRef = useRef<KifuViewMode>(viewMode);

    // main → 非main への遷移時にスクロール位置を保存
    useEffect(() => {
        if (prevViewModeRef.current === "main" && viewMode !== "main") {
            if (listRef.current) {
                mainScrollPositionRef.current = listRef.current.scrollTop;
            }
        }
        prevViewModeRef.current = viewMode;
    }, [viewMode]);

    // 本譜ビューに戻ったときにスクロール位置を復元
    useEffect(() => {
        if (viewMode === "main" && listRef.current && mainScrollPositionRef.current > 0) {
            // 一覧が描き直されたあとに戻す
            requestAnimationFrame(() => {
                if (listRef.current) {
                    listRef.current.scrollTop = mainScrollPositionRef.current;
                }
            });
        }
    }, [viewMode]);

    // 現在の手数が変わったら自動スクロール（現在の手を中央に配置）
    useEffect(() => {
        if (currentPly < 1 || currentPly > moveCount) return;

        const container = listRef.current;
        const row = currentRowRef.current;
        if (!container || !row) return;

        const rowTop = row.offsetTop - container.offsetTop;
        const rowHeight = row.offsetHeight;
        const containerHeight = container.clientHeight;
        const targetScrollTop = rowTop - containerHeight / 2 + rowHeight / 2;

        container.scrollTop = Math.max(0, targetScrollTop);
    }, [currentPly, moveCount]);

    return { listRef, currentRowRef };
}

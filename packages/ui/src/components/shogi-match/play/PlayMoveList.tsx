/**
 * 対局画面の棋譜の一覧。指し手を並べるだけ（解析・分岐の操作は持たない）。
 *
 * 対局中は最新の手へ自動で送り、押しても動かない。終局後は押した手の局面を盤に出せる。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { useNavigation } from "../contexts/NavigationContext";
import { formatEval } from "../utils/kifFormat";
import { formatElapsedTime } from "../utils/timeFormat";

const ROW_GRID = "grid grid-cols-[1.75rem_minmax(0,1fr)_4rem] items-baseline gap-x-1.5";
const ROW_GRID_WITH_EVAL =
    "grid grid-cols-[1.75rem_minmax(0,1fr)_4rem_3.25rem] items-baseline gap-x-1.5";

interface PlayMoveListProps {
    /** 指し手を押して、その局面へ移れるか（終局後） */
    selectable: boolean;
    /** いま見ている手までだけ出す（対局中。待ったで取り消した手を並べない） */
    upToCurrent?: boolean;
    /** 評価値の列を出すか（評価値を見せる対局） */
    showEval?: boolean;
    /** 指し手の一覧（見出しの行を除く）に付ける。高さの上限はここで決める */
    className?: string;
}

export function PlayMoveList({
    selectable,
    upToCurrent = false,
    showEval = false,
    className,
}: PlayMoveListProps): ReactElement {
    const { kifMoves: allMoves, navigationState, handlePlySelect } = useNavigation();
    const { currentPly } = navigationState;
    const kifMoves = upToCurrent ? allMoves.filter((move) => move.ply <= currentPly) : allMoves;
    const listRef = useRef<HTMLOListElement>(null);

    // 見ている手（対局中は最新の手）が見える位置へ送る。
    // biome-ignore lint/correctness/useExhaustiveDependencies: 手数が変わるたびに送り直す
    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const current = list.querySelector<HTMLElement>('[aria-current="true"]');
        if (current) {
            current.scrollIntoView({ block: "nearest" });
        } else {
            list.scrollTop = 0;
        }
    }, [currentPly, kifMoves.length]);

    if (kifMoves.length === 0) {
        return (
            <p className={cn("px-1 py-2 text-sm text-wafuu-sumi-light", className)}>
                まだ指し手がありません。
            </p>
        );
    }

    const rowGrid = showEval ? ROW_GRID_WITH_EVAL : ROW_GRID;
    return (
        <div className="flex min-h-0 flex-col gap-1">
            <div
                className={cn(
                    rowGrid,
                    "border-b border-wafuu-border px-1 pb-1 text-[11px] text-wafuu-sumi-light",
                )}
                aria-hidden="true"
            >
                <span className="text-right">手</span>
                <span>指し手</span>
                <span className="text-right">消費</span>
                {showEval && <span className="text-right">評価値</span>}
            </div>
            <ol
                ref={listRef}
                aria-label="棋譜"
                className={cn("flex flex-col overflow-y-auto overscroll-contain pr-1", className)}
            >
                {kifMoves.map((move) => {
                    const isCurrent = move.ply === currentPly;
                    const mover = move.mover ?? (move.ply % 2 === 1 ? "sente" : "gote");
                    const evalText = showEval ? formatEval(move.evalCp, move.evalMate) : "";
                    const content = (
                        <>
                            <span className="text-right font-mono text-[11px] tabular-nums text-wafuu-sumi-light">
                                {move.ply}
                            </span>
                            <span className="truncate">{move.displayText}</span>
                            <span className="text-right font-mono text-xs tabular-nums text-wafuu-sumi-light">
                                {move.elapsedMs !== undefined ? (
                                    formatElapsedTime(move.elapsedMs)
                                ) : (
                                    <span className="opacity-60">—</span>
                                )}
                            </span>
                            {showEval && (
                                // 評価値の色は符号ではなく、その手を指した側で決める（評価値グラフの線と同じ対応）。
                                <span
                                    className={cn(
                                        "text-right font-mono text-xs tabular-nums",
                                        mover === "sente" ? "text-wafuu-shu" : "text-wafuu-ai",
                                    )}
                                >
                                    {evalText || (
                                        <span className="text-wafuu-sumi-light/60">—</span>
                                    )}
                                </span>
                            )}
                        </>
                    );
                    const rowClass = cn(
                        rowGrid,
                        "min-h-7 w-full content-center rounded px-1 text-left text-sm",
                        isCurrent
                            ? "bg-wafuu-kin/25 font-semibold text-wafuu-sumi"
                            : "text-wafuu-sumi",
                    );
                    return (
                        <li key={move.ply} className="min-w-0">
                            {selectable ? (
                                <button
                                    type="button"
                                    aria-current={isCurrent ? "true" : undefined}
                                    onClick={() => handlePlySelect(move.ply)}
                                    className={cn(
                                        rowClass,
                                        "hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    )}
                                >
                                    {content}
                                </button>
                            ) : (
                                <span
                                    aria-current={isCurrent ? "true" : undefined}
                                    className={rowClass}
                                >
                                    {content}
                                </span>
                            )}
                        </li>
                    );
                })}
            </ol>
        </div>
    );
}

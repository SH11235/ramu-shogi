/**
 * 対局画面の棋譜の一覧。指し手を並べるだけ（解析・分岐の操作は持たない）。
 *
 * 対局中は最新の手へ自動で送り、押しても動かない。終局後は押した手の局面を盤に出せる。
 */

import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { useNavigation } from "../contexts/NavigationContext";

interface PlayMoveListProps {
    /** 指し手を押して、その局面へ移れるか（終局後） */
    selectable: boolean;
    /** いま見ている手までだけ出す（対局中。待ったで取り消した手を並べない） */
    upToCurrent?: boolean;
    className?: string;
}

export function PlayMoveList({
    selectable,
    upToCurrent = false,
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

    return (
        <ol
            ref={listRef}
            aria-label="棋譜"
            className={cn(
                "grid grid-cols-2 content-start gap-x-2 gap-y-0.5 overflow-y-auto pr-1",
                className,
            )}
        >
            {kifMoves.map((move) => {
                const isCurrent = move.ply === currentPly;
                const content = (
                    <>
                        <span className="w-7 shrink-0 text-right text-[11px] tabular-nums text-wafuu-sumi-light">
                            {move.ply}
                        </span>
                        <span className="truncate">{move.displayText}</span>
                    </>
                );
                const rowClass = cn(
                    "flex min-h-7 w-full items-baseline gap-1.5 rounded px-1 text-left text-sm",
                    isCurrent ? "bg-wafuu-kin/25 font-semibold text-wafuu-sumi" : "text-wafuu-sumi",
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
    );
}

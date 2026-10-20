import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";

export interface KifuMove {
    /** 手数（1から始まる） */
    ply: number;
    /** 日本語表記の指し手 */
    displayText: string;
}

interface MobileKifuBarProps {
    /** 棋譜データ */
    moves: KifuMove[];
    /** 現在の手数 */
    currentPly: number;
    /** 手数選択時のコールバック */
    onPlySelect?: (ply: number) => void;
    /** 見た目。`"wafuu"` は和の配色（地は和紙、いまの手は金の淡塗り）。省略時は既定の配色 */
    tone?: "default" | "wafuu";
}

/**
 * スマホ対局モード用の1行棋譜表示
 * 横スクロールで全体を表示し、現在手を中央に配置
 */
export function MobileKifuBar({
    moves,
    currentPly,
    onPlySelect,
    tone = "default",
}: MobileKifuBarProps): ReactElement {
    const isWafuu = tone === "wafuu";
    const containerRef = useRef<HTMLDivElement>(null);

    // 現在の手を中央にスクロール（コールバックref）
    const scrollToCurrentRef = (node: HTMLButtonElement | null) => {
        if (node && containerRef.current) {
            const container = containerRef.current;
            const containerWidth = container.clientWidth;
            const currentLeft = node.offsetLeft;
            const currentWidth = node.clientWidth;
            // 現在の手を中央に配置
            const scrollLeft = currentLeft - containerWidth / 2 + currentWidth / 2;
            container.scrollTo({ left: scrollLeft, behavior: "smooth" });
        }
    };
    useEffect(() => {
        if (currentPly !== 0) return;
        if (!containerRef.current) return;
        // 0手目は未選択扱いなので、先頭まで戻す
        containerRef.current.scrollTo({ left: 0, behavior: "smooth" });
    }, [currentPly]);

    if (moves.length === 0) {
        return (
            <div
                className={cn(
                    "h-9 flex items-center justify-center text-sm rounded",
                    isWafuu
                        ? "bg-wafuu-washi-warm text-wafuu-sumi-light"
                        : "text-muted-foreground bg-muted/30",
                )}
            >
                開始局面
            </div>
        );
    }

    return (
        <div
            ref={containerRef}
            className={cn(
                "h-9 flex items-center gap-1 overflow-x-auto scrollbar-hide rounded px-2 [scrollbar-width:none] [-ms-overflow-style:none]",
                isWafuu ? "bg-wafuu-washi-warm" : "bg-muted/30",
            )}
        >
            {moves.map((move) => {
                const isCurrent = currentPly > 0 && move.ply === currentPly;
                return (
                    <button
                        key={move.ply}
                        ref={isCurrent ? scrollToCurrentRef : undefined}
                        type="button"
                        onClick={onPlySelect ? () => onPlySelect(move.ply) : undefined}
                        disabled={!onPlySelect}
                        className={cn(
                            "shrink-0 px-1.5 py-1 rounded text-sm whitespace-nowrap transition-colors",
                            isCurrent
                                ? isWafuu
                                    ? "bg-wafuu-kin/30 font-semibold text-wafuu-sumi"
                                    : "bg-primary text-primary-foreground font-semibold"
                                : isWafuu
                                  ? "text-wafuu-sumi"
                                  : "text-foreground",
                            onPlySelect && !isCurrent && "hover:bg-muted",
                            !onPlySelect && "cursor-default",
                        )}
                    >
                        <span
                            className={cn(
                                "text-[10px] mr-0.5 tabular-nums",
                                isCurrent ? "opacity-80" : "opacity-50",
                            )}
                        >
                            {move.ply}
                        </span>
                        {move.displayText}
                    </button>
                );
            })}
        </div>
    );
}

import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";

export interface KifuMove {
    /** 手数（1から始まる） */
    ply: number;
    /** 日本語表記の指し手 */
    displayText: string;
    /** 悪手・疑問手の印（研究ノートの解析結果）。無ければ出さない */
    mark?: "blunder" | "dubious";
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
    /** いまの手に添えるもの（評価値など） */
    currentExtra?: ReactNode;
    /** いまの手をもう一度押したとき（詳しく開くなど）。無ければ押せない */
    onCurrentSelect?: () => void;
    className?: string;
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
    currentExtra,
    onCurrentSelect,
    className,
}: MobileKifuBarProps): ReactElement {
    const isWafuu = tone === "wafuu";
    const containerRef = useRef<HTMLDivElement>(null);

    const currentRef = useRef<HTMLButtonElement | null>(null);
    const hasScrolledRef = useRef(false);

    // 現在の手を中央にスクロールする。ref の付く順（子が先）に左右されないよう、描画のあとで行う。
    // 最初に出すときは途中の手から開いても一瞬で合わせ、そのあとの移動は滑らかに送る。
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const behavior: ScrollBehavior = hasScrolledRef.current ? "smooth" : "auto";
        hasScrolledRef.current = true;
        const node = currentRef.current;
        // 0手目は未選択扱いなので、先頭まで戻す
        if (currentPly === 0 || !node) {
            container.scrollTo({ left: 0, behavior });
            return;
        }
        // offsetLeft は位置の基準になる祖先からの距離で、この帯からの距離とは限らないので、見えている
        // 位置の差から求める。
        const offset = node.getBoundingClientRect().left - container.getBoundingClientRect().left;
        const scrollLeft =
            container.scrollLeft + offset - container.clientWidth / 2 + node.clientWidth / 2;
        container.scrollTo({ left: scrollLeft, behavior });
    }, [currentPly]);

    if (moves.length === 0) {
        return (
            <div
                className={cn(
                    "h-9 flex items-center justify-center text-sm rounded",
                    isWafuu
                        ? "bg-wafuu-washi-warm text-wafuu-sumi-light"
                        : "text-muted-foreground bg-muted/30",
                    className,
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
                className,
            )}
        >
            {moves.map((move) => {
                const isCurrent = currentPly > 0 && move.ply === currentPly;
                const onClick =
                    isCurrent && onCurrentSelect
                        ? onCurrentSelect
                        : onPlySelect
                          ? () => onPlySelect(move.ply)
                          : undefined;
                return (
                    <button
                        key={move.ply}
                        ref={isCurrent ? currentRef : undefined}
                        type="button"
                        onClick={onClick}
                        disabled={!onClick}
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
                        {isCurrent && currentExtra}
                        {move.mark && (
                            <span
                                className={cn(
                                    "ml-1 rounded border px-0.5 text-[10px] font-semibold leading-4",
                                    move.mark === "blunder"
                                        ? "border-study-blunder-border bg-study-blunder-bg text-study-blunder"
                                        : "border-study-dubious-border bg-study-dubious-bg text-study-dubious",
                                )}
                            >
                                {move.mark === "blunder" ? "悪手" : "疑問手"}
                            </span>
                        )}
                    </button>
                );
            })}
        </div>
    );
}

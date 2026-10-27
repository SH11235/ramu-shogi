import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";

/**
 * 一括解析の進捗バナー（件数・プログレスバー・キャンセル）
 */
export function BatchAnalysisProgressBanner({
    currentIndex,
    totalCount,
    inProgress,
    onCancel,
    className,
}: {
    currentIndex: number;
    totalCount: number;
    /** 並列解析中の手番号 */
    inProgress?: number[];
    onCancel?: () => void;
    className?: string;
}): ReactElement {
    return (
        <section
            className={cn("bg-primary/10 border border-primary/30 rounded-lg px-3 py-2", className)}
            aria-label={`一括解析中: ${currentIndex}/${totalCount}手完了`}
        >
            <div className="flex items-center justify-between gap-2 mb-1.5">
                <div className="flex items-center gap-2 text-[12px] text-primary font-medium">
                    <span className="animate-pulse">●</span>
                    <span>
                        一括解析中... {currentIndex}/{totalCount}
                        {inProgress && inProgress.length > 1 && ` (${inProgress.length}手並列)`}
                    </span>
                </div>
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-2 py-0.5 text-[11px] rounded border cursor-pointer transition-colors bg-background text-foreground border-border hover:bg-muted"
                    >
                        キャンセル
                    </button>
                )}
            </div>
            {/* プログレスバー */}
            <div
                className="h-1.5 bg-primary/20 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={totalCount}
                aria-valuenow={currentIndex}
            >
                <div
                    className="h-full bg-primary transition-all duration-300 ease-out"
                    style={{
                        width: `${(currentIndex / totalCount) * 100}%`,
                    }}
                />
            </div>
        </section>
    );
}

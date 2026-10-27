import type { ReactElement } from "react";

/** スマホで AI 解析のシートを閉じている間に出す、最善手の評価値（先手から見た cp）の帯 */
export function AnalysisSummaryBar({
    evalCp,
    onOpen,
}: {
    evalCp: number | null;
    onOpen: () => void;
}): ReactElement {
    const evalPercent =
        evalCp !== null ? Math.min(100, Math.max(0, 50 + (evalCp / 2000) * 50)) : 50;
    return (
        <button
            type="button"
            onClick={onOpen}
            className="md:hidden flex items-center gap-2 rounded-md border border-border bg-card/80 px-3 py-1.5 text-xs w-full"
        >
            <span className="text-muted-foreground shrink-0">🤖</span>
            <div className="flex-1 h-1.5 rounded-full bg-wafuu-ai overflow-hidden">
                <div
                    className="h-full bg-wafuu-shu transition-all duration-300"
                    style={{ width: `${evalPercent}%` }}
                />
            </div>
            <span
                className={`font-mono tabular-nums shrink-0 ${evalCp !== null && evalCp < 0 ? "text-wafuu-ai" : "text-wafuu-shu"}`}
            >
                {evalCp !== null ? (evalCp > 0 ? `+${evalCp}` : String(evalCp)) : "---"}
            </span>
            <span className="text-muted-foreground shrink-0">詳細 ›</span>
        </button>
    );
}

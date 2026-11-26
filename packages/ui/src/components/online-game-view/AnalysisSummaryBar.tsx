import type { ReactElement } from "react";
import { summarizeAiHintEval } from "../shogi-match/components/AiHintPanel";
import { formatEval, mateScoreSide } from "../shogi-match/utils/kifFormat";

/** スマホで AI 解析のシートを閉じているときの、最善手の評価値。 */
export function AnalysisSummaryBar({
    evalCp,
    evalMate,
    onOpen,
}: {
    evalCp?: number;
    evalMate?: number;
    onOpen: () => void;
}): ReactElement {
    const { percent } = summarizeAiHintEval(evalCp, evalMate);
    const gote = evalMate != null ? mateScoreSide(evalMate) === "gote" : (evalCp ?? 0) < 0;
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
                    style={{ width: `${percent}%` }}
                />
            </div>
            <span
                className={`font-mono tabular-nums shrink-0 whitespace-nowrap ${gote ? "text-wafuu-ai" : "text-wafuu-shu"}`}
            >
                {formatEval(evalCp, evalMate) || "---"}
            </span>
            <span className="text-muted-foreground shrink-0">詳細 ›</span>
        </button>
    );
}

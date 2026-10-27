import type { ReactElement } from "react";
import { Button } from "../button";
import { AnalyzeIcon } from "./StudyIcons";
import type { StudyAnalysisController } from "./useStudyAnalysis";

/** 全体の解析を始める・続ける・止める操作に要る状態。 */
export interface StudyAnalysisRunState {
    mode: StudyAnalysisController["mode"];
    progress: StudyAnalysisController["progress"];
    fullTargetCount: number;
    locked: boolean;
    /** 表示中の設定の結果が全体の半分に満たない（「全体を解析」を出す）。 */
    needsFullAnalysis: boolean;
    unanalyzedCount: number;
    /** 解析を始められない（準備中・詰み探索の途中・解析の途中）。 */
    startDisabled: boolean;
    onStartFull: () => void;
    onResume: () => void;
    onCancel: () => void;
}

/**
 * 評価値グラフの見出しの行に置く解析の操作（PC・スマートフォン共通）。結果の出るグラフのすぐ上に
 * 置き、どの状態（始める・進み具合と中止・残りを解析）でも同じ場所・同じ高さで中身だけを替える。
 */
export function StudyCompactAnalysisAction({
    run,
    wide = false,
}: {
    run: StudyAnalysisRunState;
    /** 幅に余裕がある（PC）。文言を略さずに出す。 */
    wide?: boolean;
}): ReactElement | null {
    if (run.mode === "full") {
        return (
            <div className="flex shrink-0 items-center gap-2">
                <output aria-live="polite" className="font-mono tabular-nums">
                    解析中 {run.progress?.completed ?? 0} / {run.progress?.total ?? 0}
                    {wide && " 局面"}
                </output>
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={run.onCancel}
                >
                    中止
                </Button>
            </div>
        );
    }
    if (run.locked) return null;
    if (run.needsFullAnalysis) {
        return (
            <Button
                type="button"
                size="sm"
                className="h-7 shrink-0 gap-1 px-2 text-xs"
                onClick={run.onStartFull}
                disabled={run.startDisabled}
            >
                <AnalyzeIcon />
                {run.fullTargetCount === 0
                    ? wide
                        ? "解析済みの結果を表示"
                        : "結果を表示"
                    : "全体を解析"}
            </Button>
        );
    }
    // 解析の途中で止めた・手を足したなどで、未解析の局面が残っているとき。
    if (run.unanalyzedCount > 0) {
        return (
            <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 gap-1 px-2 text-xs"
                onClick={run.onResume}
                disabled={run.startDisabled}
            >
                残り {run.unanalyzedCount} 局面を解析
            </Button>
        );
    }
    return null;
}

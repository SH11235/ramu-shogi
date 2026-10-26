import type { ReactElement } from "react";
import { Button } from "../button";
import { Progress } from "../progress";
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
 * PC の解析の操作（始める・進み具合と中止・残りを解析）。表題の行の「解析の設定」の隣に置き、
 * 「この AI・時間で解析する」と一続きに読めるようにする。グラフが空のときは、グラフの中央の
 * ボタンに任せて出さない。
 */
export function StudyHeaderAnalysisAction({
    run,
    graphIsEmpty,
}: {
    run: StudyAnalysisRunState;
    graphIsEmpty: boolean;
}): ReactElement | null {
    if (run.mode === "full") {
        const percent =
            run.progress && run.progress.total > 0
                ? Math.round((run.progress.completed / run.progress.total) * 100)
                : undefined;
        return (
            <div className="flex shrink-0 items-center gap-2">
                <output aria-live="polite" className="text-xs text-wafuu-sumi tabular-nums">
                    解析中 {run.progress?.completed ?? 0} / {run.progress?.total ?? 0} 局面
                </output>
                <Progress value={percent} aria-label="解析の進み具合" className="h-1.5 w-20" />
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-10 px-3"
                    onClick={run.onCancel}
                >
                    中止
                </Button>
            </div>
        );
    }
    if (run.locked || graphIsEmpty) return null;
    if (run.needsFullAnalysis) {
        return (
            <Button
                type="button"
                className="h-10 shrink-0 gap-1.5 px-3"
                onClick={run.onStartFull}
                disabled={run.startDisabled}
            >
                <AnalyzeIcon />
                {run.fullTargetCount === 0 ? "解析済みの結果を表示" : "全体を解析"}
            </Button>
        );
    }
    // 解析の途中で止めた・手を足したなどで、未解析の局面が残っているとき。
    if (run.unanalyzedCount > 0) {
        return (
            <Button
                type="button"
                variant="outline"
                className="h-10 shrink-0 px-3"
                onClick={run.onResume}
                disabled={run.startDisabled}
            >
                残り {run.unanalyzedCount} 局面を解析
            </Button>
        );
    }
    return null;
}

/** スマートフォンの評価値グラフの見出しの行に置く、詰めた解析の操作。 */
export function StudyCompactAnalysisAction({
    run,
}: {
    run: StudyAnalysisRunState;
}): ReactElement | null {
    if (run.mode === "full") {
        return (
            <div className="flex shrink-0 items-center gap-2">
                <output aria-live="polite" className="font-mono tabular-nums">
                    解析中 {run.progress?.completed ?? 0} / {run.progress?.total ?? 0}
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
                {run.fullTargetCount === 0 ? "結果を表示" : "全体を解析"}
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

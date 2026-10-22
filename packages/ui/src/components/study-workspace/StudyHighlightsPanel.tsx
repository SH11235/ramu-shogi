/**
 * 注目局面（研究ノートの画面の主役）。
 *
 * - 未解析: 「全体を解析」だけを主操作として出す。
 * - 解析中: 進み具合と中止。見つかった手はその場で並んでいく。
 * - 解析後: 悪手・疑問手・コメントのある手の一覧。押すとその局面へ移る。
 *   悪手・疑問手には、代わりに指すべきだった手（1 手前の局面の最善手）を添える。
 */

import type { KifuTree, StudyHighlight } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../button";
import { Progress } from "../progress";
import { AnalyzeIcon, CommentIcon } from "./StudyIcons";
import { formatStudyScore, studyHighlightTitle } from "./studyView";

interface StudyHighlightsPanelProps {
    tree: KifuTree;
    highlights: readonly StudyHighlight[];
    /** 悪手・疑問手の代わりの最善手の表記（ノード ID → 例: `☗7六歩(77)`）。結果がある手だけ。 */
    bestMoveLabels: ReadonlyMap<string, string>;
    currentNodeId: string;
    /** 表示中の解析の設定で、解析が済んでいる局面の数。 */
    analyzedCount: number;
    /** 局面の総数（開始局面を含む）。 */
    totalCount: number;
    /** いまの設定で解析したときの表示名（例: 「RAMU・1 秒」）。 */
    settingsLabel: string;
    /** いまの設定で全体を解析したときに、実際に解析する局面の数。 */
    fullTargetCount: number;
    /** 表示中の解析の設定の表示名（例: 「RAMU・1 秒」）。結果が無ければ null。 */
    displayLabel: string | null;
    analysisMode: "full" | "deep" | null;
    isPreparing: boolean;
    progress: { completed: number; total: number } | null;
    onSelect: (nodeId: string) => void;
    onStartFull: () => void;
    /** 表示中の設定で、まだ解析していない局面を解析する（「残りを解析」）。 */
    onResume: () => void;
    onCancel: () => void;
    /** 解析の設定を開く。 */
    onOpenSettings: () => void;
    /** 見出しを出さない（スマートフォンでは切り替えのタブが見出しを兼ねる）。 */
    hideHeading?: boolean;
    /** 「全体を解析」のボタンを出さない（スマートフォンでは画面下に固定して出すため）。 */
    hideStartButton?: boolean;
    /**
     * 一覧の下の「未解析の局面が N あります・残りを解析」を出さない（スマートフォンでは一覧の行数を
     * 削ってしまうので、盤の表示のグラフの見出しに出す）。
     */
    hideResume?: boolean;
    className?: string;
}

type HighlightOrder = "ply" | "drop";

const KIND_BADGE = {
    blunder: {
        label: "悪手",
        className: "border-study-blunder-border bg-study-blunder-bg text-study-blunder",
    },
    dubious: {
        label: "疑問手",
        className: "border-study-dubious-border bg-study-dubious-bg text-study-dubious",
    },
} as const;

function HighlightBadge({ highlight }: { highlight: StudyHighlight }): ReactElement {
    const base =
        "inline-flex w-14 shrink-0 items-center justify-center rounded-md border px-1 py-0.5 text-xs font-semibold";
    if (highlight.kind) {
        const badge = KIND_BADGE[highlight.kind];
        return <span className={cn(base, badge.className)}>{badge.label}</span>;
    }
    return <span className={cn(base, "border-border bg-muted text-muted-foreground")}>メモ</span>;
}

/** 手数の順（同じ手数なら本譜を先）に並べる。 */
function sortByPly(highlights: readonly StudyHighlight[]): StudyHighlight[] {
    return [...highlights].sort(
        (a, b) => a.ply - b.ply || Number(b.isMainLine) - Number(a.isMainLine),
    );
}

export function StudyHighlightsPanel({
    tree,
    highlights,
    bestMoveLabels,
    currentNodeId,
    analyzedCount,
    totalCount,
    settingsLabel,
    fullTargetCount,
    displayLabel,
    analysisMode,
    isPreparing,
    progress,
    onSelect,
    onStartFull,
    onResume,
    onCancel,
    onOpenSettings,
    hideHeading = false,
    hideStartButton = false,
    hideResume = false,
    className,
}: StudyHighlightsPanelProps): ReactElement {
    // 振り返りは対局の流れに沿って見るのが自然なので、既定は手数順にする。
    const [order, setOrder] = useState<HighlightOrder>("ply");
    const isRunningFull = analysisMode === "full";
    const judgedCount = highlights.filter((highlight) => highlight.kind !== null).length;
    const hasResults = analyzedCount > 0;
    const unanalyzedCount = Math.max(0, totalCount - analyzedCount);
    // 全体の半分も解析していなければ（1 局面だけ深く解析した、すぐ中止した、など）、
    // 「全体を解析」を主操作として出す。
    const needsFullAnalysis = !isRunningFull && analyzedCount * 2 < totalCount;
    const percent =
        progress && progress.total > 0
            ? Math.round((progress.completed / progress.total) * 100)
            : undefined;
    // `highlights` は落差の大きい順（そのあとに、メモだけの手）で届く。
    const ordered = order === "ply" ? sortByPly(highlights) : highlights;
    const settingsLink = (
        <button
            type="button"
            onClick={onOpenSettings}
            className="relative rounded-sm text-wafuu-ai underline underline-offset-2 after:absolute after:inset-x-0 after:-inset-y-2.5 hover:text-wafuu-ai-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
            設定を変える
        </button>
    );

    return (
        <section
            aria-label="注目局面"
            className={cn(
                "flex min-h-0 flex-col gap-3 rounded-xl border border-wafuu-border bg-card p-3 shadow-sm",
                className,
            )}
        >
            <div
                className={cn(
                    "flex flex-wrap items-center justify-between gap-2",
                    hideHeading && highlights.length === 0 && "sr-only",
                )}
            >
                <h2
                    className={cn(
                        "font-display text-base font-semibold text-wafuu-sumi",
                        hideHeading && "sr-only",
                    )}
                >
                    注目局面
                </h2>
                {highlights.length > 0 && (
                    <div className="flex items-center gap-2">
                        {hasResults && (
                            <span className="text-xs text-muted-foreground">
                                悪手・疑問手 {judgedCount} 手
                            </span>
                        )}
                        <fieldset className="flex overflow-hidden rounded-md border border-border text-xs">
                            <legend className="sr-only">注目局面の並び順</legend>
                            {(
                                [
                                    { id: "ply", label: "手数順" },
                                    { id: "drop", label: "大きい順" },
                                ] as const
                            ).map((option) => (
                                <button
                                    key={option.id}
                                    type="button"
                                    aria-pressed={order === option.id}
                                    onClick={() => setOrder(option.id)}
                                    className={cn(
                                        "px-2 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                                        order === option.id
                                            ? "bg-wafuu-shu/10 font-medium text-wafuu-shu"
                                            : "text-muted-foreground hover:bg-muted/60",
                                    )}
                                >
                                    {option.label}
                                </button>
                            ))}
                        </fieldset>
                    </div>
                )}
            </div>

            {needsFullAnalysis && (
                <div className="flex flex-col gap-3 rounded-lg bg-wafuu-washi px-3 py-4">
                    <p className="text-sm text-wafuu-sumi">
                        全体を解析すると、見直すべき手がここに並びます。
                    </p>
                    {!hideStartButton && (
                        <Button
                            type="button"
                            size="lg"
                            className="w-full gap-2"
                            onClick={onStartFull}
                            disabled={isPreparing || analysisMode !== null}
                        >
                            <AnalyzeIcon />
                            {fullTargetCount === 0 ? "解析済みの結果を表示" : "全体を解析"}
                        </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                        {fullTargetCount === 0
                            ? // いまの設定の解析は済んでいる（表示しているのが、別の設定の結果）。
                              `${settingsLabel}の解析は全局面で済んでいます。押すと、その結果を表示します。`
                            : `${settingsLabel}で ${fullTargetCount} 局面を解析します。`}{" "}
                        {settingsLink}
                    </p>
                </div>
            )}

            {isRunningFull && (
                <div className="flex flex-col gap-2 rounded-lg bg-wafuu-washi px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                        <output aria-live="polite" className="text-sm text-wafuu-sumi">
                            解析中 {progress?.completed ?? 0} / {progress?.total ?? 0} 局面
                        </output>
                        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                            中止
                        </Button>
                    </div>
                    <Progress value={percent} aria-label="解析の進み具合" />
                </div>
            )}

            {ordered.length > 0 ? (
                <ol className="flex min-h-0 flex-col gap-0.5 overflow-y-auto overscroll-contain">
                    {ordered.map((highlight) => {
                        const isCurrent = highlight.nodeId === currentNodeId;
                        const before = formatStudyScore(highlight.scoreBefore);
                        const after = formatStudyScore(highlight.scoreAfter);
                        const best = bestMoveLabels.get(highlight.nodeId);
                        const hasDetail =
                            highlight.kind !== null &&
                            (best !== undefined || (before !== "" && after !== ""));
                        return (
                            <li key={highlight.nodeId}>
                                <button
                                    type="button"
                                    onClick={() => onSelect(highlight.nodeId)}
                                    aria-current={isCurrent ? "true" : undefined}
                                    className={cn(
                                        "flex min-h-10 w-full items-start gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        isCurrent && "border-wafuu-border bg-wafuu-kin/15",
                                    )}
                                >
                                    <HighlightBadge highlight={highlight} />
                                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
                                            <span className="font-medium text-wafuu-sumi">
                                                {studyHighlightTitle(tree, highlight)}
                                            </span>
                                            {!highlight.isMainLine && (
                                                <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
                                                    変化
                                                </span>
                                            )}
                                            {highlight.kind !== null && highlight.hasComment && (
                                                <CommentIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                            )}
                                        </span>
                                        {hasDetail && (
                                            <span className="flex flex-wrap items-baseline gap-x-3 text-xs text-muted-foreground">
                                                {best !== undefined && (
                                                    <span>
                                                        最善{" "}
                                                        <span className="text-wafuu-sumi">
                                                            {best}
                                                        </span>
                                                    </span>
                                                )}
                                                {before !== "" && after !== "" && (
                                                    <span className="font-mono tabular-nums">
                                                        {before} → {after}
                                                    </span>
                                                )}
                                            </span>
                                        )}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ol>
            ) : (
                hasResults &&
                !needsFullAnalysis &&
                !isRunningFull && (
                    <p className="px-1 text-sm text-muted-foreground">
                        悪手・疑問手は見つかりませんでした。気になる手にコメントを付けると、ここに並びます。
                    </p>
                )
            )}

            {/* 一覧の行数を圧迫しないよう、一覧の下に 1 行で出す。 */}
            {!hideResume && !needsFullAnalysis && !isRunningFull && unanalyzedCount > 0 && (
                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border pt-2">
                    <p className="min-w-0 text-xs text-muted-foreground">
                        {displayLabel ? `${displayLabel}で` : ""}未解析の局面が {unanalyzedCount}{" "}
                        あります。
                    </p>
                    <button
                        type="button"
                        onClick={onResume}
                        disabled={isPreparing || analysisMode !== null}
                        className="min-h-10 shrink-0 rounded-md border border-input bg-background px-3 text-xs font-medium text-wafuu-sumi transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 md:min-h-8"
                    >
                        残りを解析
                    </button>
                </div>
            )}
        </section>
    );
}

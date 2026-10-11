/**
 * 注目局面（研究ノートの画面の主役）。
 *
 * - 未解析: 「全体を解析」だけを主操作として出す。
 * - 解析中: 進み具合と中止。見つかった手はその場で並んでいく。
 * - 解析後: 悪手・疑問手・しおり・コメントのある手の一覧。押すとその局面へ移る。
 */

import type { KifuTree, StudyHighlight } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { Button } from "../button";
import { Progress } from "../progress";
import { AnalyzeIcon, BookmarkIcon, CommentIcon } from "./StudyIcons";
import { formatStudyScore, studyHighlightTitle } from "./studyView";

interface StudyHighlightsPanelProps {
    tree: KifuTree;
    highlights: readonly StudyHighlight[];
    currentNodeId: string;
    /** 表示中の解析の設定で、解析が済んでいる局面の数。 */
    analyzedCount: number;
    /** 局面の総数（開始局面を含む）。 */
    totalCount: number;
    /** いまの設定で解析したときの表示名（例: 「RAMU・1 秒」）。 */
    settingsLabel: string;
    analysisMode: "full" | "deep" | null;
    isPreparing: boolean;
    progress: { completed: number; total: number } | null;
    onSelect: (nodeId: string) => void;
    onStartFull: () => void;
    onCancel: () => void;
    /** 見出しを出さない（スマートフォンでは切り替えのタブが見出しを兼ねる）。 */
    hideHeading?: boolean;
    className?: string;
}

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
    if (highlight.bookmarked) {
        return (
            <span className={cn(base, "border-wafuu-border bg-wafuu-kin/20 text-wafuu-sumi")}>
                しおり
            </span>
        );
    }
    return <span className={cn(base, "border-border bg-muted text-muted-foreground")}>メモ</span>;
}

export function StudyHighlightsPanel({
    tree,
    highlights,
    currentNodeId,
    analyzedCount,
    totalCount,
    settingsLabel,
    analysisMode,
    isPreparing,
    progress,
    onSelect,
    onStartFull,
    onCancel,
    hideHeading = false,
    className,
}: StudyHighlightsPanelProps): ReactElement {
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
                    "flex items-baseline justify-between gap-2",
                    hideHeading && needsFullAnalysis && "sr-only",
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
                {!needsFullAnalysis && !isRunningFull && (
                    <span className="text-xs text-muted-foreground">
                        悪手・疑問手 {judgedCount} 手
                    </span>
                )}
            </div>

            {needsFullAnalysis && (
                <div className="flex flex-col gap-3 rounded-lg bg-wafuu-washi px-3 py-4">
                    <p className="text-sm text-wafuu-sumi">
                        全体を解析すると、見直すべき手がここに並びます。
                    </p>
                    <Button
                        type="button"
                        size="lg"
                        className="w-full gap-2"
                        onClick={onStartFull}
                        disabled={isPreparing || analysisMode !== null}
                    >
                        <AnalyzeIcon />
                        全体を解析
                    </Button>
                    <p className="text-xs text-muted-foreground">
                        {settingsLabel}で {unanalyzedCount} 局面を解析します。
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

            {!needsFullAnalysis && !isRunningFull && unanalyzedCount > 0 && (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-wafuu-washi px-3 py-2">
                    <p className="text-xs text-muted-foreground">
                        まだ解析していない局面が {unanalyzedCount} あります。
                    </p>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={onStartFull}
                        disabled={isPreparing || analysisMode !== null}
                    >
                        残りを解析
                    </Button>
                </div>
            )}

            {highlights.length > 0 ? (
                <ol className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                    {highlights.map((highlight) => {
                        const isCurrent = highlight.nodeId === currentNodeId;
                        const before = formatStudyScore(highlight.scoreBefore);
                        const after = formatStudyScore(highlight.scoreAfter);
                        return (
                            <li key={highlight.nodeId}>
                                <button
                                    type="button"
                                    onClick={() => onSelect(highlight.nodeId)}
                                    aria-current={isCurrent ? "true" : undefined}
                                    className={cn(
                                        "flex w-full items-center gap-2 rounded-md border border-transparent px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        isCurrent && "border-wafuu-border bg-wafuu-kin/15",
                                    )}
                                >
                                    <HighlightBadge highlight={highlight} />
                                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                                        <span className="truncate font-medium text-wafuu-sumi">
                                            {studyHighlightTitle(tree, highlight)}
                                        </span>
                                        {!highlight.isMainLine && (
                                            <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground">
                                                変化
                                            </span>
                                        )}
                                        {highlight.kind !== null && highlight.bookmarked && (
                                            <BookmarkIcon
                                                filled
                                                className="h-3.5 w-3.5 text-wafuu-kin"
                                            />
                                        )}
                                        {highlight.kind !== null && highlight.hasComment && (
                                            <CommentIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                        )}
                                    </span>
                                    {highlight.kind !== null && before !== "" && after !== "" && (
                                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                                            {before} → {after}
                                        </span>
                                    )}
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
                        悪手・疑問手は見つかりませんでした。気になる手にしおりやコメントを付けると、ここに並びます。
                    </p>
                )
            )}
        </section>
    );
}

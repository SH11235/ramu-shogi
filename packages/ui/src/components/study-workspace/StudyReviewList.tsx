import type { KifuTree, StudyDocument, StudyHighlight, StudyHighlightKind } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { cardVariants } from "../card";
import { STUDY_KIND_BADGE } from "./StudyPositionBand";
import {
    pickStudyDeeperResult,
    pickStudyPositionResult,
    studyBestCandidate,
    studyFirstMoveLabel,
    studyMoveLabel,
} from "./studyView";

export interface StudyReviewItem {
    nodeId: string;
    /** 表示中の手順での位置（グラフの横軸と同じ）。 */
    ply: number;
    moveLabel: string;
    kind: StudyHighlightKind | null;
    /** 1 手前の局面の最善手。指した手と同じとき・未解析のときは null。 */
    bestLabel: string | null;
    comment: string;
}

/**
 * 表示中の手順のうち、見直す手（悪手・疑問手・コメントのある手）を手順の順に並べる。
 * 悪手・疑問手には、1 手前の局面の最善手を添える（一覧から移らなくても答えが見えるように）。
 */
export function buildStudyReviewItems({
    doc,
    tree,
    line,
    highlights,
    displayLayerId,
}: {
    doc: StudyDocument;
    tree: KifuTree;
    line: readonly string[];
    highlights: readonly StudyHighlight[];
    displayLayerId: string | null;
}): StudyReviewItem[] {
    const items: StudyReviewItem[] = [];
    for (const highlight of highlights) {
        const ply = line.indexOf(highlight.nodeId);
        if (ply < 0 || (highlight.kind === null && !highlight.hasComment)) continue;
        const parent = highlight.parentId === null ? undefined : tree.nodes.get(highlight.parentId);
        // 深く読んだ結果で判定した手には、その結果の最善手を添える（判定と最善手の出典をそろえる）。
        const parentResult =
            highlight.kind !== null && parent
                ? ((highlight.judgedByDeeper
                      ? pickStudyDeeperResult(doc, parent.id, displayLayerId)
                      : null) ?? pickStudyPositionResult(doc, parent.id, displayLayerId))
                : null;
        const best = parentResult ? studyBestCandidate(parentResult.result) : null;
        const bestLabel =
            parent && best && best.pv[0] !== highlight.usiMove
                ? studyFirstMoveLabel(parent, best.pv)
                : null;
        const stored = Object.hasOwn(doc.tree.nodes, highlight.nodeId)
            ? doc.tree.nodes[highlight.nodeId]
            : undefined;
        items.push({
            nodeId: highlight.nodeId,
            ply,
            moveLabel: studyMoveLabel(tree, highlight.nodeId),
            kind: highlight.kind,
            bestLabel,
            comment: stored?.comment ?? "",
        });
    }
    return items.sort((a, b) => a.ply - b.ply);
}

/** グラフの下に出す、見直す手の一覧。押すとその局面へ移る。 */
export function StudyReviewList({
    items,
    currentNodeId,
    hasResults,
    unanalyzedCount,
    onSelect,
}: {
    items: readonly StudyReviewItem[];
    currentNodeId: string;
    hasResults: boolean;
    /** 表示中の解析で、まだ読み終えていない局面の数。 */
    unanalyzedCount: number;
    onSelect: (nodeId: string) => void;
}): ReactElement {
    return (
        <section
            aria-label="見直す手"
            className={cn(cardVariants({ variant: "wafuu", elevation: "raised" }), "px-2 py-1")}
        >
            <h2 className="sr-only">見直す手</h2>
            {items.length === 0 ? (
                <p className="px-1 py-2 text-xs text-muted-foreground">
                    {!hasResults
                        ? "全体を解析すると、悪手・疑問手がここに並びます。"
                        : unanalyzedCount > 0
                          ? `解析した手には、悪手・疑問手・コメントのある手はありません（まだ解析していない局面が ${unanalyzedCount} あります）。`
                          : "悪手・疑問手・コメントのある手はありません。"}
                </p>
            ) : (
                <ol className="flex flex-col">
                    {items.map((item) => {
                        const isCurrent = item.nodeId === currentNodeId;
                        return (
                            <li key={item.nodeId}>
                                <button
                                    type="button"
                                    aria-current={isCurrent ? "step" : undefined}
                                    onClick={() => onSelect(item.nodeId)}
                                    className={cn(
                                        "flex min-h-10 w-full items-center gap-2 rounded-md px-1.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        isCurrent ? "bg-wafuu-kin/30" : "hover:bg-muted/60",
                                    )}
                                >
                                    {item.kind !== null ? (
                                        <span
                                            className={cn(
                                                "shrink-0 rounded border px-1 text-xs font-medium",
                                                STUDY_KIND_BADGE[item.kind].className,
                                            )}
                                        >
                                            {STUDY_KIND_BADGE[item.kind].label}
                                        </span>
                                    ) : (
                                        <span className="shrink-0 rounded border border-wafuu-border px-1 text-xs text-muted-foreground">
                                            コメント
                                        </span>
                                    )}
                                    <span className="shrink-0 tabular-nums text-muted-foreground">
                                        {item.ply}
                                    </span>
                                    <span className="shrink-0 text-wafuu-sumi">
                                        {item.moveLabel}
                                    </span>
                                    <span className="ml-auto min-w-0 truncate text-xs text-muted-foreground">
                                        {item.bestLabel !== null
                                            ? `最善 ${item.bestLabel}`
                                            : item.comment}
                                    </span>
                                </button>
                            </li>
                        );
                    })}
                </ol>
            )}
        </section>
    );
}

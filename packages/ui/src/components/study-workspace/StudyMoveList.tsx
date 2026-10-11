/**
 * 棋譜と変化。
 *
 * いま見ている手順（本譜、または選んだ変化）を縦に並べ、枝分かれのある手の下に
 * 他の変化を出す。各手には表示中の解析の設定での評価値を出し、棋譜に元から付いていた
 * 評価値（対局時の評価値）がある棋譜では、別の列として並べる。
 */

import type { KifuTree, StudyDocument, StudyHighlightKind } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useRef } from "react";
import { formatEval } from "../shogi-match/utils/kifFormat";
import { StudyIconButton } from "./StudyIconButton";
import { BookmarkIcon, BranchIcon, CommentIcon, TrashIcon } from "./StudyIcons";
import {
    formatStudyScore,
    isStudyMainLine,
    studyMoveLabel,
    studyScoreSide,
    studyVariationLength,
} from "./studyView";

interface StudyMoveListProps {
    doc: StudyDocument;
    tree: KifuTree;
    /** 表示する手順（ルートから末端までのノード ID）。 */
    line: readonly string[];
    currentNodeId: string;
    /** 悪手・疑問手と判定された手（ノード ID → 判定）。 */
    highlightKinds: ReadonlyMap<string, StudyHighlightKind>;
    onSelect: (nodeId: string) => void;
    /** 本譜の表示に戻す。 */
    onBackToMainLine: () => void;
    /** 変化（そのノードと配下）の削除を求める。確認は呼び出し側で行う。 */
    onRequestDeleteVariation: (nodeId: string) => void;
    className?: string;
}

const ROW_GRID = "grid grid-cols-[1.75rem_minmax(0,1fr)_3.25rem] items-center gap-x-1.5";
const ROW_GRID_WITH_SOURCE =
    "grid grid-cols-[1.75rem_minmax(0,1fr)_3.25rem_3.25rem] items-center gap-x-1.5";

const sideClass = (side: "sente" | "gote" | null): string =>
    side === "sente" ? "text-wafuu-shu" : side === "gote" ? "text-wafuu-ai" : "text-foreground";

const evalSide = (scoreCp?: number, scoreMate?: number): "sente" | "gote" | null => {
    const value = scoreMate ?? scoreCp;
    if (value === undefined || value === 0) return null;
    return value > 0 ? "sente" : "gote";
};

const KIND_MARK: Record<StudyHighlightKind, { text: string; label: string; className: string }> = {
    blunder: {
        text: "悪手",
        label: "悪手",
        className: "border-study-blunder-border bg-study-blunder-bg text-study-blunder",
    },
    dubious: {
        text: "疑問",
        label: "疑問手",
        className: "border-study-dubious-border bg-study-dubious-bg text-study-dubious",
    },
};

export function StudyMoveList({
    doc,
    tree,
    line,
    currentNodeId,
    highlightKinds,
    onSelect,
    onBackToMainLine,
    onRequestDeleteVariation,
    className,
}: StudyMoveListProps): ReactElement {
    const hasSource = Object.values(doc.tree.nodes).some((node) => node.source?.score != null);
    const rowGrid = hasSource ? ROW_GRID_WITH_SOURCE : ROW_GRID;
    const onMainLine = isStudyMainLine(tree, line);
    // 本譜から外れた最初の手（変化の先頭）。
    const variationHeadId = onMainLine
        ? null
        : (line.find(
              (nodeId, index) =>
                  index > 0 && tree.nodes.get(line[index - 1])?.children[0] !== nodeId,
          ) ?? null);

    const currentRowRef = useRef<HTMLLIElement | null>(null);
    // biome-ignore lint/correctness/useExhaustiveDependencies: いま見ている手が変わったら、その行が見える位置まで送る
    useEffect(() => {
        currentRowRef.current?.scrollIntoView?.({ block: "nearest" });
    }, [currentNodeId]);

    return (
        <section
            aria-label="棋譜と変化"
            className={cn(
                "flex min-h-0 flex-col gap-2 rounded-xl border border-wafuu-border bg-card p-3 shadow-sm",
                className,
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-wafuu-sumi">棋譜と変化</h2>
                {!onMainLine && (
                    <div className="flex items-center gap-1">
                        <span className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
                            <BranchIcon className="h-3.5 w-3.5" />
                            変化を表示中
                        </span>
                        <button
                            type="button"
                            onClick={onBackToMainLine}
                            className="rounded-md px-2 py-1 text-xs font-medium text-wafuu-ai underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            本譜に戻る
                        </button>
                        {variationHeadId && (
                            <StudyIconButton
                                label="この変化を削除"
                                onClick={() => onRequestDeleteVariation(variationHeadId)}
                            >
                                <TrashIcon />
                            </StudyIconButton>
                        )}
                    </div>
                )}
            </div>

            <div
                className={cn(
                    rowGrid,
                    "border-b border-border px-2 pb-1 text-[11px] text-muted-foreground",
                )}
                aria-hidden="true"
            >
                <span className="text-right">手</span>
                <span>指し手</span>
                <span className="text-right">解析</span>
                {hasSource && <span className="text-right">対局時</span>}
            </div>

            <ol className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                {line.map((nodeId, index) => {
                    const node = tree.nodes.get(nodeId);
                    if (!node) return null;
                    const stored = Object.hasOwn(doc.tree.nodes, nodeId)
                        ? doc.tree.nodes[nodeId]
                        : undefined;
                    const isCurrent = nodeId === currentNodeId;
                    const parent = node.parentId ? tree.nodes.get(node.parentId) : undefined;
                    const siblings = parent
                        ? parent.children.filter((childId) => childId !== nodeId)
                        : [];
                    const kind = highlightKinds.get(nodeId);
                    const analysisText = formatEval(node.eval?.scoreCp, node.eval?.scoreMate);
                    const sourceScore = stored?.source?.score ?? null;
                    const label = index === 0 ? "開始局面" : studyMoveLabel(tree, nodeId);
                    return (
                        <li key={nodeId} ref={isCurrent ? currentRowRef : undefined}>
                            <button
                                type="button"
                                onClick={() => onSelect(nodeId)}
                                aria-current={isCurrent ? "true" : undefined}
                                className={cn(
                                    rowGrid,
                                    "w-full rounded-md border border-transparent px-2 py-1 text-left text-sm transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                    isCurrent && "border-wafuu-border bg-wafuu-kin/20",
                                )}
                            >
                                <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                                    {index === 0 ? "" : index}
                                </span>
                                {/* 指し手は切らずに出し、印（悪手・しおりなど）は入る分だけ出す。 */}
                                <span className="flex min-w-0 items-center gap-1 overflow-hidden">
                                    <span className="shrink-0 whitespace-nowrap text-wafuu-sumi">
                                        {label}
                                    </span>
                                    {kind && (
                                        <span
                                            role="img"
                                            aria-label={KIND_MARK[kind].label}
                                            className={cn(
                                                "shrink-0 rounded border px-1 text-[10px] font-semibold leading-4",
                                                KIND_MARK[kind].className,
                                            )}
                                        >
                                            {KIND_MARK[kind].text}
                                        </span>
                                    )}
                                    {stored?.bookmarked && (
                                        <span role="img" aria-label="しおり" className="shrink-0">
                                            <BookmarkIcon
                                                filled
                                                className="h-3.5 w-3.5 text-wafuu-kin"
                                            />
                                        </span>
                                    )}
                                    {stored && stored.comment !== "" && (
                                        <span
                                            role="img"
                                            aria-label="コメントあり"
                                            className="shrink-0"
                                        >
                                            <CommentIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                        </span>
                                    )}
                                </span>
                                <span
                                    className={cn(
                                        "text-right font-mono text-xs tabular-nums",
                                        sideClass(
                                            evalSide(node.eval?.scoreCp, node.eval?.scoreMate),
                                        ),
                                    )}
                                >
                                    {analysisText || (
                                        <span className="text-muted-foreground/60">—</span>
                                    )}
                                </span>
                                {hasSource && (
                                    <span
                                        className={cn(
                                            "text-right font-mono text-xs tabular-nums opacity-70",
                                            sideClass(studyScoreSide(sourceScore)),
                                        )}
                                    >
                                        {formatStudyScore(sourceScore)}
                                    </span>
                                )}
                            </button>
                            {siblings.length > 0 && (
                                <ul className="flex flex-col gap-0.5 py-0.5 pl-10 pr-1">
                                    {siblings.map((siblingId) => {
                                        const isMain = parent?.children[0] === siblingId;
                                        const length = studyVariationLength(tree, siblingId);
                                        return (
                                            <li
                                                key={siblingId}
                                                className="flex items-center gap-1 text-xs"
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => onSelect(siblingId)}
                                                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-muted-foreground transition-colors hover:bg-muted/60 hover:text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                                >
                                                    <BranchIcon className="h-3.5 w-3.5" />
                                                    <span className="shrink-0">
                                                        {isMain ? "本譜" : "変化"}
                                                    </span>
                                                    <span className="truncate text-wafuu-sumi">
                                                        {studyMoveLabel(tree, siblingId)}
                                                    </span>
                                                    <span className="shrink-0">{length} 手</span>
                                                </button>
                                                {!isMain && (
                                                    <StudyIconButton
                                                        label={`変化 ${studyMoveLabel(tree, siblingId)} を削除`}
                                                        className="h-7 w-7"
                                                        onClick={() =>
                                                            onRequestDeleteVariation(siblingId)
                                                        }
                                                    >
                                                        <TrashIcon className="h-3.5 w-3.5" />
                                                    </StudyIconButton>
                                                )}
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </li>
                    );
                })}
            </ol>
        </section>
    );
}

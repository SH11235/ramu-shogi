import {
    type KifuNode,
    type KifuTree,
    type StudyAnalysisResult,
    type StudyDocument,
    type StudyHighlight,
    type StudyScore,
    studyScoreToKifuEval,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { cardVariants } from "../card";
import { EvalGraph, type EvalGraphMarker } from "../shogi-match/components/EvalGraph";
import type { EvalHistory } from "../shogi-match/utils/kifFormat";
import { type StudyAnalysisRunState, StudyCompactAnalysisAction } from "./StudyAnalysisRunControls";
import {
    formatStudyScore,
    studyBestCandidate,
    studyHighlightTitle,
    studyLineEvalHistory,
    studyLineSourceEvalHistory,
    studyMoveLabel,
    studyScoreSide,
} from "./studyView";

/** 研究ノートの評価値グラフの縦軸の上限（センチポーン）。詰みや大差は端に張り付けて描く。 */
const GRAPH_AXIS_CAP = 3000;
const GRAPH_MIN_SCALE = 1000;

/** 自動で読んだ値の名前（保存の区切りの時間は読んだ長さではないので、時間では呼ばない）。 */
export const STUDY_AUTO_READ_LABEL = "自動読み";

/** グラフに置く、ある局面の読み（局面の帯に出す値と同じもの）。 */
export interface StudyGraphRead {
    /** どの読みか（例: `1秒`・`自動読み`。別の AI なら、その設定の名前）。 */
    label: string;
    result: StudyAnalysisResult;
}

export type StudyGraphSeries = "source" | "analysis";

/** 見出しに出す、いまの局面の値（局面の帯と同じ値）。 */
interface StudyGraphCurrentRead {
    label: string;
    score: StudyScore | null;
    depth: number;
    /** 表示中の AI とは別の AI の値（線には載せず、灰色の丸で置く）。 */
    otherAi: boolean;
}

interface StudyEvalGraphData {
    /** 主の線にしている評価値。 */
    primary: StudyGraphSeries;
    history: EvalHistory[];
    /** 対局時の評価値と解析の両方があるときの、破線で重ねるもう一方。 */
    secondaryHistory: EvalHistory[] | undefined;
    hasSourceGraph: boolean;
    /** 解析の線に描ける値がある（保存済みの結果か、読んでいる途中の値）。 */
    hasAnalysis: boolean;
    markers: EvalGraphMarker[];
    /** 別の AI の値の凡例（設定の名前。局面ごとに違えば null）。手順に無ければ undefined。 */
    otherAiLabel: string | null | undefined;
    current: StudyGraphCurrentRead | null;
}

/**
 * 表示中の手順の評価値グラフの線と印。解析の線は、局面ごとに帯と同じ値（表示中の AI のうち、
 * いちばん深く読めた値）をつなぐ。別の AI の値は深さを比べられないので線に混ぜず、灰色の丸で置く。
 * 棋譜に付いていた評価値（対局時）は、解析したあとも消さずに解析の線と重ねる。対局時のほうが長く
 * 読んでいることがある（AI 同士の棋譜など）ので、解析の値で置き換えたことにしない。
 */
export function buildStudyEvalGraph({
    doc,
    tree,
    line,
    highlights,
    hasResults,
    primaryChoice,
    lineReads,
    otherAiReads,
    currentNodeId,
}: {
    doc: StudyDocument;
    tree: KifuTree;
    line: readonly string[];
    highlights: readonly StudyHighlight[];
    hasResults: boolean;
    primaryChoice: StudyGraphSeries;
    /** 局面ごとの、表示中の AI でいちばん深く読めた値。 */
    lineReads: ReadonlyMap<string, StudyGraphRead>;
    /** 局面の帯が別の AI の値を出す局面と、その値。 */
    otherAiReads: ReadonlyMap<string, StudyGraphRead>;
    currentNodeId: string;
}): StudyEvalGraphData {
    const sourceHistory = studyLineSourceEvalHistory(doc, tree, line);
    const hasSourceGraph = sourceHistory.some(
        (entry) => entry.evalCp !== null || entry.evalMate !== null,
    );
    const analysisHistory = studyLineEvalHistory(tree, line).map((entry, index) => {
        const read = lineReads.get(line[index]);
        if (!read) return entry;
        const evalData = studyScoreToKifuEval(studyBestCandidate(read.result)?.score ?? null);
        return {
            ...entry,
            evalCp: evalData?.scoreCp ?? null,
            evalMate: evalData?.scoreMate ?? null,
        };
    });
    // 保存済みの結果がまだ無くても、自動で読んでいる途中の値があれば解析の線を出す。
    const hasAnalysis =
        hasResults ||
        analysisHistory.some((entry) => entry.evalCp !== null || entry.evalMate !== null);
    const primary: StudyGraphSeries = !hasSourceGraph
        ? "analysis"
        : !hasAnalysis
          ? "source"
          : primaryChoice;
    const history = primary === "source" ? sourceHistory : analysisHistory;
    const secondaryHistory =
        hasSourceGraph && hasAnalysis
            ? primary === "source"
                ? analysisHistory
                : sourceHistory
            : undefined;
    const markers: EvalGraphMarker[] = [];
    // 悪手・疑問手の印は悪手だけ（疑問手まで出すと、件数が多いときに埋もれる。疑問手は一覧で分かる）。
    for (const highlight of highlights) {
        const index = line.indexOf(highlight.nodeId);
        if (index < 0 || highlight.kind !== "blunder") continue;
        markers.push({
            ply: index,
            tone: "blunder",
            label: `${studyHighlightTitle(tree, highlight)}（悪手）`,
            // 悪手は解析の値で決めるので、印は解析の線に載せる。
            series: primary === "analysis" ? "primary" : "secondary",
        });
    }
    // 悪手の印と同じ高さに重なっても両方見えるよう、別の AI の丸は小さくして後から描く。評価値の無い
    // 読みは、高さを決められないので点にしない。
    const otherAiLabels = new Set<string>();
    line.forEach((nodeId, index) => {
        const read = otherAiReads.get(nodeId);
        if (!read) return;
        otherAiLabels.add(read.label);
        const score = studyBestCandidate(read.result)?.score ?? null;
        const evalData = studyScoreToKifuEval(score);
        if (!evalData) return;
        const position = index === 0 ? "開始局面" : `${index}手目 ${studyMoveLabel(tree, nodeId)}`;
        markers.push({
            ply: index,
            tone: "otherAi",
            label: `${position}（別の AI・${read.label} ${formatStudyScore(score)} 深さ${read.result.depth}）`,
            value: { evalCp: evalData.scoreCp ?? null, evalMate: evalData.scoreMate ?? null },
            current: nodeId === currentNodeId,
        });
    });
    const otherAiLabel =
        otherAiLabels.size === 0
            ? undefined
            : otherAiLabels.size === 1
              ? [...otherAiLabels][0]
              : null;
    const otherHere = otherAiReads.get(currentNodeId);
    const currentRead = otherHere ?? lineReads.get(currentNodeId);
    return {
        primary,
        history,
        secondaryHistory,
        hasSourceGraph,
        hasAnalysis,
        markers,
        otherAiLabel,
        current: currentRead
            ? {
                  label: currentRead.label,
                  score: studyBestCandidate(currentRead.result)?.score ?? null,
                  depth: currentRead.result.depth,
                  otherAi: otherHere !== undefined,
              }
            : null,
    };
}

const sideTextClass = (side: "sente" | "gote" | null): string =>
    side === "sente" ? "text-wafuu-shu" : side === "gote" ? "text-wafuu-ai" : "text-foreground";

/** 主の線（手番で色分けした実線）の見本。 */
function PrimaryLineSwatch(): ReactElement {
    return (
        <span aria-hidden="true" className="flex h-0.5 w-4 shrink-0">
            <span className="flex-1 bg-wafuu-shu" />
            <span className="flex-1 bg-wafuu-ai" />
        </span>
    );
}

/** 別の AI の値の印（グラフの印と同じ形）の見本。 */
function OtherAiMarkSwatch(): ReactElement {
    return (
        <span
            aria-hidden="true"
            className="inline-block h-2 w-2 shrink-0 self-center rounded-full border-2 border-muted-foreground bg-background"
        />
    );
}

/** 別の AI の値に添える印（深さを表示中の AI の値と比べられないことを示す）。 */
function OtherAiChip(): ReactElement {
    return (
        <span className="shrink-0 self-center whitespace-nowrap rounded border border-muted-foreground/60 px-1 text-[10px] leading-4 text-muted-foreground">
            別の AI
        </span>
    );
}

/**
 * スマートフォンの見出しの代わりに出す、いまの手の評価値と解析の操作（盤の下に別の行を取らない
 * ため）。値の欄は幅を固定する（桁数で右の表示が動かないように）。
 */
function MobileGraphHeader({
    doc,
    currentNode,
    graph,
    analysisCondition,
    run,
}: {
    doc: StudyDocument;
    currentNode: KifuNode;
    graph: StudyEvalGraphData;
    /** 線の評価値の探索条件（例: `1秒`）。 */
    analysisCondition: string;
    run: StudyAnalysisRunState;
}): ReactElement {
    const mover: "sente" | "gote" | null =
        currentNode.ply === 0
            ? null
            : currentNode.positionAfter.turn === "sente"
              ? "gote"
              : "sente";
    const current = graph.current;
    const storedNode = Object.hasOwn(doc.tree.nodes, currentNode.id)
        ? doc.tree.nodes[currentNode.id]
        : undefined;
    const sourceText = formatStudyScore(storedNode?.source?.score ?? null);
    // 対局時の評価値がある棋譜では、どの手でもその欄を出す（値の無い手で欄が消えると、左の表示が動く）。
    const noteHasSource = Object.values(doc.tree.nodes).some((node) => node.source?.score != null);
    return (
        <div className="flex h-7 items-center justify-between gap-2 text-xs text-muted-foreground">
            <h2 className="sr-only">評価値グラフ</h2>
            <div className="flex min-w-0 items-baseline gap-3">
                <span className="flex min-w-0 items-baseline gap-1">
                    {current?.otherAi && <OtherAiChip />}
                    <span className="min-w-0 truncate">{current?.label ?? analysisCondition}</span>
                    <span
                        className={cn(
                            "inline-block min-w-[6ch] whitespace-nowrap text-right font-mono text-sm tabular-nums",
                            current?.otherAi
                                ? "text-muted-foreground"
                                : sideTextClass(studyScoreSide(current?.score ?? null)),
                        )}
                    >
                        {formatStudyScore(current?.score ?? null) || "—"}
                    </span>
                    {current && (
                        <span className="whitespace-nowrap tabular-nums">深さ{current.depth}</span>
                    )}
                </span>
                {noteHasSource && (
                    <span className="flex items-baseline gap-1">
                        対局時
                        <span
                            className={cn(
                                "inline-block min-w-[6ch] whitespace-nowrap text-right font-mono text-sm tabular-nums opacity-80",
                                sideTextClass(mover),
                            )}
                        >
                            {sourceText || "—"}
                        </span>
                    </span>
                )}
            </div>
            <StudyCompactAnalysisAction run={run} />
        </div>
    );
}

function DesktopGraphHeader({
    graph,
    hasResults,
    analysisLabel,
    onPrimaryChange,
    run,
}: {
    graph: StudyEvalGraphData;
    hasResults: boolean;
    analysisLabel: string;
    onPrimaryChange: (series: StudyGraphSeries) => void;
    run: StudyAnalysisRunState;
}): ReactElement {
    return (
        <div className="flex min-h-7 items-center justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                <h2 className="font-display text-sm font-semibold text-wafuu-sumi">評価値グラフ</h2>
                {graph.secondaryHistory ? (
                    // 押した側を主の線（手番で色分けした実線）にし、もう一方は破線で重ねる。
                    // ボタンの線の見本が、そのまま凡例になる。
                    <fieldset className="m-0 flex min-w-0 items-center gap-1 border-0 p-0">
                        <legend className="sr-only">主に描く評価値</legend>
                        {(
                            [
                                { series: "source", label: "対局時" },
                                { series: "analysis", label: analysisLabel },
                            ] as const
                        ).map(({ series, label }) => {
                            const isPrimary = graph.primary === series;
                            return (
                                <button
                                    key={series}
                                    type="button"
                                    aria-pressed={isPrimary}
                                    onClick={() => onPrimaryChange(series)}
                                    className={cn(
                                        "flex min-w-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                        isPrimary
                                            ? "bg-muted font-medium text-wafuu-sumi"
                                            : "text-muted-foreground hover:bg-muted/60",
                                    )}
                                >
                                    {isPrimary ? (
                                        <PrimaryLineSwatch />
                                    ) : (
                                        <span
                                            aria-hidden="true"
                                            className="w-4 shrink-0 border-t-[1.5px] border-dashed border-muted-foreground"
                                        />
                                    )}
                                    <span className="truncate">{label}</span>
                                </button>
                            );
                        })}
                    </fieldset>
                ) : (
                    // 線が 1 本だけのときも、2 本のときの切り替えと同じ見本で、何の線かを示す。
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {(graph.hasSourceGraph || hasResults) && <PrimaryLineSwatch />}
                        <span className="truncate">
                            {graph.hasSourceGraph
                                ? "対局時"
                                : hasResults
                                  ? analysisLabel
                                  : "解析すると、形勢の流れが出ます"}
                        </span>
                    </span>
                )}
                {graph.otherAiLabel !== undefined && (
                    <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        <OtherAiMarkSwatch />
                        <span className="truncate">
                            {graph.otherAiLabel === null
                                ? "別の AI"
                                : `別の AI（${graph.otherAiLabel}）`}
                        </span>
                    </span>
                )}
            </div>
            <StudyCompactAnalysisAction run={run} wide />
        </div>
    );
}

/** 評価値グラフの欄。グラフの手・悪手の印を押すと、その局面へ移る。 */
export function StudyEvalGraphPanel({
    doc,
    currentNode,
    currentPly,
    graph,
    displayLayerLabel,
    displayLayerCondition,
    onPrimaryChange,
    run,
    isMobile,
    isWide,
    mobileSlotHeight,
    onPlySelect,
}: {
    doc: StudyDocument;
    currentNode: KifuNode;
    /** 表示中の手順での、いまの局面の位置。 */
    currentPly: number;
    graph: StudyEvalGraphData;
    /** 表示中の解析の設定の名前。 */
    displayLayerLabel: string | null;
    /** 表示中の解析の設定の探索条件（例: `1秒`）。 */
    displayLayerCondition: string | null;
    onPrimaryChange: (series: StudyGraphSeries) => void;
    run: StudyAnalysisRunState;
    isMobile: boolean;
    isWide: boolean;
    /** スマートフォンでグラフに使える場所の高さ。 */
    mobileSlotHeight: number | null;
    onPlySelect: (ply: number) => void;
}): ReactElement {
    return (
        <section
            aria-label="評価値グラフ"
            className={cn(
                cardVariants({ variant: "wafuu", elevation: "raised" }),
                "flex flex-col gap-1",
                isMobile ? "px-2 py-1" : "px-3 py-2",
            )}
        >
            {isMobile ? (
                <MobileGraphHeader
                    doc={doc}
                    currentNode={currentNode}
                    graph={graph}
                    analysisCondition={displayLayerCondition ?? "解析"}
                    run={run}
                />
            ) : (
                <DesktopGraphHeader
                    graph={graph}
                    hasResults={graph.hasAnalysis}
                    analysisLabel={
                        displayLayerLabel !== null ? `解析（${displayLayerLabel}）` : "解析"
                    }
                    onPrimaryChange={onPrimaryChange}
                    run={run}
                />
            )}
            <div className="relative">
                <EvalGraph
                    compact
                    evalHistory={graph.history}
                    secondaryHistory={graph.secondaryHistory}
                    currentPly={currentPly}
                    // PC の広い画面では右の 2 列にまたがって横長に置くので、低くして列の高さを空ける。
                    height={
                        isMobile
                            ? Math.max(40, Math.floor((mobileSlotHeight ?? 102) - 62))
                            : isWide
                              ? 56
                              : 72
                    }
                    minScale={GRAPH_MIN_SCALE}
                    axisCap={GRAPH_AXIS_CAP}
                    onPlySelect={onPlySelect}
                    markers={graph.markers}
                    onMarkerSelect={(marker) => onPlySelect(marker.ply)}
                />
            </div>
        </section>
    );
}

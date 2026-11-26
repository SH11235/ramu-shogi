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
import { type EvalHistory, formatEval } from "../shogi-match/utils/kifFormat";
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

const DEEP_LABEL_MIXED = "深く読んだ";

/** 局面の帯が表示中の設定とは別の読みの値を出す局面の、その読み。 */
export interface StudyDeepRead {
    /** 読みの探索条件（例: `30秒`）。 */
    limits: string;
    result: StudyAnalysisResult;
}

export type StudyGraphSeries = "source" | "analysis";

interface StudyEvalGraphData {
    /** 主の線にしている評価値。 */
    primary: StudyGraphSeries;
    history: EvalHistory[];
    /** 対局時の評価値と解析の両方があるときの、破線で重ねるもう一方。 */
    secondaryHistory: EvalHistory[] | undefined;
    hasSourceGraph: boolean;
    markers: EvalGraphMarker[];
    /**
     * 表示中の設定より深く読んだ局面の印の凡例（例: `30秒`）。条件が局面ごとに違えば「深く読んだ」。
     * 深く読んだ局面が手順に無ければ null。
     */
    deepLabel: string | null;
    /** 今いる局面を深く読んだ値（局面の帯に出る値）。深く読んでいなければ null。 */
    currentDeepScore: StudyScore | null;
}

/**
 * 表示中の手順の評価値グラフの線と印。棋譜に付いていた評価値（対局時）は、解析したあとも消さずに
 * 解析の線と重ねる。対局時のほうが長く読んでいることがある（AI 同士の棋譜など）ので、解析の値で
 * 置き換えたことにしない。
 */
export function buildStudyEvalGraph({
    doc,
    tree,
    line,
    highlights,
    hasResults,
    primaryChoice,
    deepReads,
    currentNodeId,
}: {
    doc: StudyDocument;
    tree: KifuTree;
    line: readonly string[];
    highlights: readonly StudyHighlight[];
    hasResults: boolean;
    primaryChoice: StudyGraphSeries;
    /** 局面の帯が表示中の設定とは別の（より深い）読みの値を出す局面と、その読み。 */
    deepReads: ReadonlyMap<string, StudyDeepRead>;
    currentNodeId: string;
}): StudyEvalGraphData {
    const sourceHistory = studyLineSourceEvalHistory(doc, tree, line);
    const hasSourceGraph = sourceHistory.some(
        (entry) => entry.evalCp !== null || entry.evalMate !== null,
    );
    const analysisHistory = studyLineEvalHistory(tree, line);
    const primary: StudyGraphSeries = !hasSourceGraph
        ? "analysis"
        : !hasResults
          ? "source"
          : primaryChoice;
    const history = primary === "source" ? sourceHistory : analysisHistory;
    const secondaryHistory =
        hasSourceGraph && hasResults
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
    // 深く読んだ値は線に混ぜず、その値の高さに形の違う印を置く（帯の値がどこから来たかを示す）。
    // 悪手の印と同じ高さに重なっても両方見えるよう、小さいひし形を後から描く。評価値の無い読みは、
    // 高さを決められないので点にしない（見出しの値は「—」になる）。
    const deepLabels = new Set<string>();
    let currentDeepScore: StudyScore | null = null;
    line.forEach((nodeId, index) => {
        const read = deepReads.get(nodeId);
        if (!read) return;
        deepLabels.add(read.limits);
        const score = studyBestCandidate(read.result)?.score ?? null;
        if (nodeId === currentNodeId) currentDeepScore = score;
        const evalData = studyScoreToKifuEval(score);
        if (!evalData) return;
        const position = index === 0 ? "開始局面" : `${index}手目 ${studyMoveLabel(tree, nodeId)}`;
        markers.push({
            ply: index,
            tone: "deep",
            label: `${position}（${read.limits} ${formatStudyScore(score)} 深さ${read.result.depth}）`,
            value: { evalCp: evalData.scoreCp ?? null, evalMate: evalData.scoreMate ?? null },
            current: nodeId === currentNodeId,
        });
    });
    const deepLabel =
        deepLabels.size === 0
            ? null
            : deepLabels.size === 1
              ? [...deepLabels][0]
              : DEEP_LABEL_MIXED;
    return {
        primary,
        history,
        secondaryHistory,
        hasSourceGraph,
        markers,
        deepLabel,
        currentDeepScore,
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

/** 深く読んだ局面の印（グラフの印と同じ形）の見本。今いる局面の印があれば、グラフと同じく輪で囲む。 */
function DeepMarkSwatch({ current }: { current: boolean }): ReactElement {
    return (
        <span
            aria-hidden="true"
            className={cn(
                "mx-1 inline-block h-2 w-2 shrink-0 rotate-45 self-center border-2 border-wafuu-sumi bg-background",
                current &&
                    "outline outline-1 outline-offset-2 outline-wafuu-sumi ring-2 ring-wafuu-kin",
            )}
        />
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
    const evalText = formatEval(currentNode.eval?.scoreCp, currentNode.eval?.scoreMate);
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
                {/* 帯の値（深く読んだ値）と見分けられるよう、線の値の探索条件を添える。 */}
                <span className="flex items-baseline gap-1">
                    {analysisCondition}
                    <span
                        className={cn(
                            "inline-block min-w-[6ch] whitespace-nowrap text-right font-mono text-sm tabular-nums",
                            sideTextClass(mover),
                        )}
                    >
                        {evalText || "—"}
                    </span>
                </span>
                {graph.deepLabel !== null && (
                    <span className="flex items-baseline gap-1">
                        <DeepMarkSwatch current={graph.currentDeepScore !== null} />
                        {graph.deepLabel}
                        <span
                            className={cn(
                                "inline-block min-w-[6ch] whitespace-nowrap text-right font-mono text-sm tabular-nums",
                                // 帯と同じく、形勢の良い側の色にする（帯の値と同じものだと分かるように）。
                                sideTextClass(studyScoreSide(graph.currentDeepScore)),
                            )}
                        >
                            {formatStudyScore(graph.currentDeepScore) || "—"}
                        </span>
                    </span>
                )}
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
                {graph.deepLabel !== null && (
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <DeepMarkSwatch current={graph.currentDeepScore !== null} />
                        {graph.deepLabel === DEEP_LABEL_MIXED
                            ? DEEP_LABEL_MIXED
                            : `${DEEP_LABEL_MIXED}（${graph.deepLabel}）`}
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
    hasResults,
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
    hasResults: boolean;
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
                    hasResults={hasResults}
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

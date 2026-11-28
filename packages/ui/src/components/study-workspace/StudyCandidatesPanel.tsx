import type {
    KifuNode,
    StudyAnalysisResult,
    StudyCandidate,
    StudyScore,
    StudySource,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useId, useState } from "react";
import { Button } from "../button";
import { cardVariants } from "../card";
import { RamRunningIcon } from "../ram-running-icon";
import { convertPvToDisplay } from "../shogi-match/utils/kifFormat";
import { Switch } from "../switch";
import { StudyIconButton } from "./StudyIconButton";
import { AddBranchIcon, PlayIcon } from "./StudyIcons";
import {
    COMPACT_BUTTON_CLASS,
    StudyMateResult,
    studyMateProgressText,
    studyShortestProgressText,
} from "./StudyMateSection";
import {
    formatStudyScore,
    type StudyPositionResult,
    studyBestCandidate,
    studyCandidateArrowPlan,
    studyFirstMoveLabel,
    studyScoreSide,
} from "./studyView";
import { hasStudyLiveStarted, type StudyLiveSearch } from "./useStudyAnalysis";

/** 「読む」で、続きから読めずに読み終えたときの知らせ。 */
export const STUDY_AUTO_ANALYZE_FINISHED = "この局面は読み終えました。局面を移ると読みます";

import type { StudyMateState, StudyShortestState } from "./useStudyMate";

/** 読み筋を盤で見る・変化として足すときに渡す内容。 */
export interface StudyPvRequest {
    /** 読み筋の始まる局面のノード。 */
    nodeId: string;
    pv: string[];
    score: StudyScore | null;
}

/**
 * 別の局面で動いている解析・詰み探索。この局面からは見えないので、何がどこで動いているかと、
 * その局面へ戻る・止める手段を出す。
 */
export type StudyElsewhereActivity =
    | {
          kind: "deep";
          /** 解析している局面の短い表記（例: `12手目`）。 */
          positionLabel: string;
          /** 指し手まで含めた表記（例: `12手目 ☗7六歩`）。マウスを載せると出す。 */
          positionTitle: string;
          live: StudyLiveSearch;
          onGo: () => void;
          onStop: () => void;
      }
    | {
          kind: "mate";
          positionLabel: string;
          positionTitle: string;
          state: StudyMateState | undefined;
          /** 最短手順を求めているときの途中経過。 */
          shortest?: StudyShortestState;
          onGo: () => void;
          onStop: () => void;
      }
    | {
          kind: "full";
          progress: { completed: number; total: number } | null;
          onStop: () => void;
      }
    | {
          /** 別の局面で動いていたものが終わった（局面を移る・閉じるまで残す）。 */
          kind: "finished";
          what: "deep" | "mate" | "shortest" | "full";
          /** 全体の解析では null。 */
          position: { positionLabel: string; positionTitle: string; onGo: () => void } | null;
          onDismiss: () => void;
      };

/** ある局面の候補手のまとまり。 */
interface StudyCandidatesPanelProps {
    /** いま見ている局面のノード。 */
    node: KifuNode;
    /** いま見ている局面の解析結果。無ければ null。 */
    positionResult: StudyPositionResult | null;
    /**
     * いま見ている局面を、表示中の設定より深く読んだ結果（同じ AI で、探索の上限が大きい設定）。
     * 候補手は差し替えず、別の段として添える。
     */
    deeperResult?: StudyPositionResult | null;
    /** いま見ている手に棋譜から付いていた評価値・読み筋（対局時の評価値）。 */
    source: StudySource | null;
    analysisMode: "full" | "deep" | null;
    isPreparing: boolean;
    /** この局面を深く解析している途中経過。別の局面を解析中・解析していなければ undefined。 */
    live: StudyLiveSearch | undefined;
    /**
     * 読み方の「読む」（「パス」の間も入る）。`reading` は読み上げ向けに添える状態（読んでいる局面など）で、無ければ null。
     * 渡さなければ出さない（編集できないとき）。
     */
    autoAnalyze?: {
        enabled: boolean;
        onChange: (enabled: boolean) => void;
        reading: string | null;
    };
    /** 盤の矢印（上から `count` 個の候補）。渡さなければスイッチも見本の矢印も出さない。 */
    arrows?: {
        enabled: boolean;
        count: number;
        onChange: (enabled: boolean) => void;
    };
    /**
     * 「読む」がこの局面を読み始めるところ（前の局面の読みを止めている間など）。局面の帯と同じく、
     * まだ解析していないとは出さない。
     */
    readingSoon?: boolean;
    /**
     * 欄のいちばん上に置く、局面の帯と読み方のグループ（PC）。スマートフォンは局面の移動の下に置くので
     * 渡さない。
     */
    band?: ReactNode;
    onCancel: () => void;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation?: (request: StudyPvRequest) => void;
    /** 詰み探索。使えないエンジンでは渡さない。 */
    mate?: {
        /** この局面の結果（調べていなければ undefined）。 */
        state: StudyMateState | undefined;
        /** この局面に至った手の表記。開始局面は null。 */
        moveLabel: string | null;
        /** この局面の最短手順の操作と結果。 */
        shortest: {
            state: StudyShortestState | undefined;
            onStart: () => void;
            onStop: () => void;
        };
    };
    /** 別の局面で動いている解析・詰み探索（無ければ undefined）。 */
    elsewhere?: StudyElsewhereActivity;
    /**
     * 読む操作（「読む」・深く解析など）を候補手の下に置く。狭い画面では、答え（候補手）を
     * 欄の上に出すため。
     */
    controlsLast?: boolean;
    className?: string;
}

const PREPARING_TEXT = "AI を準備しています…";

const sideClass = (side: "sente" | "gote" | null): string =>
    side === "sente" ? "text-wafuu-shu" : side === "gote" ? "text-wafuu-ai" : "text-foreground";

/** どの結果かの注記（例: `RAMU・深さ 15・1 秒・48 万局面`）。 */
function resultNote(result: StudyPositionResult): string {
    return [
        // 設定の名前（「RAMU・30 秒」）の時間は 1 回に読む上限で、実際に読んだ時間と紛らわしいので、
        // AI の名前だけを出す。
        result.layer.display.nnueName ?? result.layer.display.label,
        // 上限の前に止めたかどうかは出さない（止めるのは利用者が満足したときで、どこまで読んだかは
        // 深さ・時間で分かる）。
        searchStats(result.result),
    ].join("・");
}

/** 読んだ局面の数（1 万以上は「万」「億」で丸める）。 */
function formatNodes(nodes: number): string {
    if (nodes >= 100_000_000) return `${(nodes / 100_000_000).toFixed(1)} 億局面`;
    if (nodes >= 10_000) return `${Math.round(nodes / 10_000)} 万局面`;
    return `${nodes} 局面`;
}

/** 読みの深さ・読んだ時間・読んだ局面の数（続けて読んだ分も足した値）。取れないものは出さない。 */
function searchStats(result: StudyAnalysisResult): string {
    return [
        `深さ ${result.depth}`,
        ...(result.timeMs != null ? [`${Math.round(result.timeMs / 1000)} 秒`] : []),
        ...(result.nodes != null ? [formatNodes(result.nodes)] : []),
    ].join("・");
}

/** 深く解析している間の「（残り m 秒）」。残りの時間は 1 秒ごとに数え直す。 */
function DeepProgressNote({ live }: { live: StudyLiveSearch }): ReactElement | null {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (live.startedAt === null) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1_000);
        return () => clearInterval(timer);
    }, [live.startedAt]);
    const { budgetMs } = live;
    const remaining =
        live.startedAt === null || budgetMs === null
            ? null
            : // 読み始めた直後の描画では `now` がまだ古いので、上限の秒数で抑える。
              Math.min(
                  budgetMs / 1_000,
                  Math.max(0, Math.ceil((live.startedAt + budgetMs - now) / 1_000)),
              );
    // 深さ・読んだ時間などは、途中の候補の見出しに出す。
    return remaining !== null ? <>（残り {remaining} 秒）</> : null;
}

const FINISHED_TEXT = {
    deep: "を読み終えました",
    mate: "の詰み探索が終わりました",
    shortest: "の最短手順の探索が終わりました",
};

/**
 * 別の局面で動いているもの・終わったものの 1 行。終わっても行を消さずに知らせに替えるので、裏の
 * 解析が終わった瞬間に下の候補手が動かない。1 行に収めるため、局面の表記だけを省略し、何をして
 * いるか・残りの時間は省略しない。
 */
function ElsewhereActivityLine({ activity }: { activity: StudyElsewhereActivity }): ReactElement {
    if (activity.kind === "finished") {
        const { position } = activity;
        return (
            <div className="flex h-8 items-center gap-1 rounded-md bg-muted/40 pl-2 pr-0.5 text-xs text-muted-foreground">
                <output
                    aria-live="polite"
                    className="flex min-w-0 flex-1 whitespace-nowrap"
                    title={position?.positionTitle}
                >
                    {position && <span className="truncate">{position.positionLabel}</span>}
                    <span className="shrink-0">
                        {activity.what === "full"
                            ? "全体の解析が終わりました"
                            : FINISHED_TEXT[activity.what]}
                    </span>
                </output>
                {position && (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 shrink-0 px-2 text-xs"
                        onClick={position.onGo}
                    >
                        その局面へ
                    </Button>
                )}
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label="知らせを閉じる"
                    className="h-7 w-7 shrink-0 p-0 text-xs"
                    onClick={activity.onDismiss}
                >
                    ×
                </Button>
            </div>
        );
    }
    const label = activity.kind === "full" ? null : activity.positionLabel;
    const status =
        activity.kind === "full" ? (
            <>
                全体を解析中
                {activity.progress && (
                    <>
                        （{activity.progress.completed} / {activity.progress.total} 局面）
                    </>
                )}
            </>
        ) : activity.kind === "deep" ? (
            <>
                を読んでいます
                <DeepProgressNote live={activity.live} />
            </>
        ) : (
            <>
                ：
                {activity.shortest?.status === "running"
                    ? studyShortestProgressText(activity.shortest, { short: true })
                    : activity.state?.status === "running"
                      ? studyMateProgressText(activity.state, { short: true })
                      : // 調べ始めた直後で、途中経過がまだ届いていない
                        "詰みを調べ中"}
            </>
        );
    return (
        <div className="flex h-8 items-center gap-1 rounded-md bg-muted/40 pl-1 pr-0.5 text-xs text-muted-foreground">
            <RamRunningIcon />
            <output
                aria-live="polite"
                className="flex min-w-0 flex-1 whitespace-nowrap tabular-nums"
                title={activity.kind === "full" ? undefined : activity.positionTitle}
            >
                {label !== null && <span className="truncate">{label}</span>}
                <span className="shrink-0">{status}</span>
            </output>
            {activity.kind !== "full" && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 px-2 text-xs"
                    onClick={activity.onGo}
                >
                    その局面へ
                </Button>
            )}
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={activity.onStop}
            >
                止める
            </Button>
        </div>
    );
}

/** 盤の矢印と同じ色・太さ・濃さの小さな矢印。どの矢印がどの候補かを示す。 */
function ArrowSwatch({
    emphasis,
    side,
}: {
    emphasis: "primary" | "secondary";
    side: "sente" | "gote";
}): ReactElement {
    const primary = emphasis === "primary";
    return (
        <svg
            aria-hidden="true"
            data-arrow-swatch={emphasis}
            viewBox="0 0 20 10"
            className={cn(
                "h-2.5 w-5 shrink-0 self-center",
                side === "sente" ? "fill-wafuu-shu" : "fill-wafuu-ai",
            )}
            fillOpacity={primary ? 0.8 : 0.45}
        >
            <path
                d={
                    primary
                        ? "M0 3.4 L13 3.4 L13 0.5 L20 5 L13 9.5 L13 6.6 L0 6.6 Z"
                        : "M0 4 L14 4 L14 1.6 L20 5 L14 8.4 L14 6 L0 6 Z"
                }
            />
        </svg>
    );
}

function CandidateRow({
    node,
    candidate,
    groupLabel,
    arrowEmphasis,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    candidate: StudyCandidate;
    /** 盤に矢印を出している候補なら、その太さ・濃さ（行に同じ見た目の小さな矢印を添える）。 */
    arrowEmphasis?: "primary" | "secondary";
    /** ボタンの読み上げで、どの局面の候補かを区別するための言葉。 */
    groupLabel: string;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation?: (request: StudyPvRequest) => void;
}): ReactElement {
    const display = convertPvToDisplay(candidate.pv, node.positionAfter);
    const [, ...rest] = display;
    const hasPv = display.length > 0;
    // 最初の手は、棋譜と同じ表記にする（直前の手と同じマスなら「同」）。
    const firstLabel = studyFirstMoveLabel(node, candidate.pv);
    const request: StudyPvRequest = { nodeId: node.id, pv: candidate.pv, score: candidate.score };
    return (
        <li className="flex items-baseline gap-2 rounded-md px-1 py-1">
            <span className="w-4 shrink-0 text-center font-mono text-xs tabular-nums text-muted-foreground">
                {candidate.rank}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    {arrowEmphasis && (
                        <ArrowSwatch emphasis={arrowEmphasis} side={node.positionAfter.turn} />
                    )}
                    <span className="truncate text-sm font-medium text-wafuu-sumi">
                        {firstLabel ?? "（読み筋なし）"}
                    </span>
                    <span
                        className={cn(
                            "shrink-0 whitespace-nowrap font-mono text-sm tabular-nums",
                            sideClass(studyScoreSide(candidate.score)),
                        )}
                    >
                        {formatStudyScore(candidate.score)}
                    </span>
                    {/* 途中で止めた読みでは候補ごとに深さが違うことがあるので、どの候補にも添える。 */}
                    <span className="shrink-0 text-xs text-muted-foreground">
                        深さ {candidate.depth}
                    </span>
                </div>
                {rest.length > 0 && (
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                        {rest.map((move) => move.displayText).join(" ")}
                    </p>
                )}
            </div>
            {hasPv && (
                <div className="flex shrink-0 items-center self-start">
                    <StudyIconButton
                        label={`${groupLabel}候補 ${candidate.rank} の読み筋を盤で見る`}
                        onClick={() => onPreviewPv(request)}
                    >
                        <PlayIcon />
                    </StudyIconButton>
                    {onAddPvAsVariation && (
                        <StudyIconButton
                            label={`${groupLabel}候補 ${candidate.rank} の読み筋を変化として追加`}
                            onClick={() => onAddPvAsVariation(request)}
                        >
                            <AddBranchIcon />
                        </StudyIconButton>
                    )}
                </div>
            )}
        </li>
    );
}

/**
 * より深く読んだ結果の段。ふだんは 1 行（最善手と評価値）に畳み、押すと候補手と読み筋を出す。
 * 利用者がいま深く解析して得た結果は、開いた状態で目立たせる。
 */
/** 深く解析した局面に添える、全体の解析の最善手（1 行）。 */
function ShallowResultLine({
    node,
    result,
}: {
    node: KifuNode;
    result: StudyPositionResult;
}): ReactElement | null {
    const best = studyBestCandidate(result.result);
    if (!best) return null;
    return (
        <p className="flex flex-wrap items-baseline gap-x-1.5 border-t border-border px-1 pt-1.5 text-xs text-muted-foreground">
            <span>全体の解析（深さ {result.result.depth}）</span>
            <span className="text-sm text-wafuu-sumi">{studyFirstMoveLabel(node, best.pv)}</span>
            <span
                className={cn(
                    "font-mono text-sm tabular-nums",
                    sideClass(studyScoreSide(best.score)),
                )}
            >
                {formatStudyScore(best.score)}
            </span>
        </p>
    );
}

export function StudyCandidatesPanel({
    node,
    positionResult,
    deeperResult = null,
    source,
    analysisMode,
    isPreparing,
    live,
    autoAnalyze,
    arrows,
    readingSoon = false,
    band,
    onCancel,
    onPreviewPv,
    onAddPvAsVariation,
    mate,
    elsewhere,
    controlsLast = false,
    className,
}: StudyCandidatesPanelProps): ReactElement {
    const arrowSwitchId = useId();
    const autoOn = autoAnalyze?.enabled ?? false;
    const isDeepHere = live !== undefined;
    /**
     * 「読む」を入れてから、この局面の読みが始まるまで（AI の読み込みなど）。止まって見えないよう、
     * ラムを走らせ、今の読みの枠を先に出す。
     */
    const autoPreparing = readingSoon && !isDeepHere;
    // 別の局面の深い解析・詰み探索は、押せばそれを止めて切り替える。全体の解析の途中だけは始めない。
    const startDisabled = isPreparing || analysisMode === "full";
    const sourceText = formatStudyScore(source?.score);
    const mainResult = deeperResult ?? positionResult;
    const mainNote = mainResult ? resultNote(mainResult) : null;

    const shownCandidates = live
        ? (live.preview?.candidates ?? [])
        : (mainResult?.result.candidates ?? []);
    const arrowPlan =
        arrows?.enabled === true
            ? studyCandidateArrowPlan(node, shownCandidates, arrows.count)
            : [];
    const arrowEmphasisOf = (rank: number): "primary" | "secondary" | undefined =>
        arrowPlan.find((entry) => entry.rank === rank)?.arrow.emphasis;
    const arrowToggle = (label: string) =>
        arrows && (
            <div className="flex shrink-0 items-center gap-2">
                <label htmlFor={arrowSwitchId} className="text-xs text-muted-foreground">
                    {label}
                </label>
                <Switch
                    id={arrowSwitchId}
                    aria-label="矢印を表示"
                    checked={arrows.enabled}
                    onCheckedChange={arrows.onChange}
                />
            </div>
        );
    /**
     * 結果の見出しの 1 行（深さ・秒・局面数など）。盤の矢印のスイッチを右端に置く（見出しの文が長ければ
     * 折り返し、スイッチは押しやすい大きさのまま）。
     */
    const resultHeader = (meta: ReactNode, action?: ReactNode) => (
        <div className="flex min-h-7 items-center gap-2 px-1">
            <div className="min-w-0 flex-1 text-xs text-muted-foreground">{meta}</div>
            {action}
            {shownCandidates.length > 0 && arrowToggle("矢印")}
        </div>
    );

    const controls = (
        <>
            {elsewhere && <ElsewhereActivityLine activity={elsewhere} />}

            {/* 詰み探索の結果は押したボタンの真下に出す（候補手が多い局面でも、列を送らずに見えるように）。 */}
            {mate && onAddPvAsVariation && (
                <StudyMateResult
                    node={node}
                    moveLabel={mate.moveLabel}
                    state={mate.state}
                    shortest={{ ...mate.shortest, disabled: startDisabled }}
                    onPreviewPv={onPreviewPv}
                    onAddPvAsVariation={onAddPvAsVariation}
                />
            )}
        </>
    );

    return (
        <section
            aria-label="候補手"
            className={cn(
                cardVariants({ variant: "wafuu", elevation: "raised" }),
                "flex flex-col gap-3 p-3",
                className,
            )}
        >
            {/* 欄の名前は見出しとして画面に出さない（PC は欄の並び、スマートフォンはタブで分かる）。 */}
            <h2 className="sr-only">候補手</h2>
            {band}
            {!controlsLast && controls}
            {/* 読んでいる途中の候補。満足したら「止める」で、その時点の結果を残せる。 */}
            {live && (
                <div className="flex flex-col gap-1 rounded-lg bg-wafuu-washi px-2 py-2">
                    {resultHeader(
                        // 深さ・秒数は 1 秒ごとに変わるので、読み上げの領域にはしない（読み続ける間ずっと
                        // 読み上げられてしまう）。今の読みであることは、帯で走るラムで分かる。
                        <p>
                            <span className="sr-only">今の読み</span>
                            {/* 「読む」間は局面を移るまで読み続けるので、残りの時間は無い。 */}
                            {!autoOn && (
                                <span className="tabular-nums">
                                    <DeepProgressNote live={live} />
                                </span>
                            )}
                            {live.preview && (
                                <span className="tabular-nums">{searchStats(live.preview)}</span>
                            )}
                        </p>,
                        // 読み方の「読む」でない読みは、ここで止める。読む・パスの間は「停止」で止める。
                        !autoOn && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={COMPACT_BUTTON_CLASS}
                                onClick={onCancel}
                            >
                                止める
                            </Button>
                        ),
                    )}
                    {/* エンジンの起動中など、最初の途中経過が届くまで。 */}
                    {!hasStudyLiveStarted(live) && (
                        <p className="px-1 text-sm text-muted-foreground">{PREPARING_TEXT}</p>
                    )}
                    {live.preview && (
                        <ol className="flex flex-col">
                            {live.preview.candidates.map((candidate) => (
                                <CandidateRow
                                    key={candidate.rank}
                                    node={node}
                                    candidate={candidate}
                                    groupLabel="途中の"
                                    arrowEmphasis={arrowEmphasisOf(candidate.rank)}
                                    onPreviewPv={onPreviewPv}
                                    onAddPvAsVariation={onAddPvAsVariation}
                                />
                            ))}
                        </ol>
                    )}
                </div>
            )}

            {autoPreparing && (
                <div className="flex flex-col gap-1 rounded-lg bg-wafuu-washi px-2 py-2">
                    <p className="flex min-h-7 items-center px-1 text-sm text-muted-foreground">
                        <span className="sr-only">今の読み</span>
                        {PREPARING_TEXT}
                    </p>
                </div>
            )}

            {/* 深く解析した結果があれば、それを候補手の一覧にする（同じ局面をより深く読んだ結果なので）。
                全体の解析の結果は、最善手だけを 1 行で添える。読んでいる間は今の読みだけを出す（前に深く
                読んだ記録は、帯か今の読みの見出しの下に 1 行で出す）。 */}
            {!live && !autoPreparing && (
                <div className="flex flex-col gap-1">
                    {mainResult &&
                        resultHeader(
                            // 1 行に収まらないときは省略し、全文はマウスを載せると見られるようにする。
                            <p className="truncate" title={mainNote ?? undefined}>
                                {mainNote}
                            </p>,
                        )}
                    {mainResult ? (
                        <ol className="flex flex-col">
                            {mainResult.result.candidates.map((candidate) => (
                                <CandidateRow
                                    key={candidate.rank}
                                    node={node}
                                    candidate={candidate}
                                    groupLabel=""
                                    arrowEmphasis={arrowEmphasisOf(candidate.rank)}
                                    onPreviewPv={onPreviewPv}
                                    onAddPvAsVariation={onAddPvAsVariation}
                                />
                            ))}
                        </ol>
                    ) : (
                        <p className="px-1 text-sm text-muted-foreground">
                            この局面はまだ解析していません。
                        </p>
                    )}
                    {deeperResult && positionResult && (
                        <ShallowResultLine node={node} result={positionResult} />
                    )}
                </div>
            )}

            {source && (sourceText !== "" || source.pv) && (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
                    <span>対局時の評価値</span>
                    {sourceText !== "" && (
                        <span
                            className={cn(
                                "font-mono tabular-nums",
                                sideClass(studyScoreSide(source.score)),
                            )}
                        >
                            {sourceText}
                        </span>
                    )}
                    {source.pv && source.pv.length > 0 && (
                        <button
                            type="button"
                            onClick={() =>
                                onPreviewPv({
                                    nodeId: node.id,
                                    pv: source.pv ?? [],
                                    score: source.score,
                                })
                            }
                            className="rounded-sm text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            対局時の読み筋を見る
                        </button>
                    )}
                </div>
            )}
            {controlsLast && (
                <div className="flex flex-col gap-3 border-t border-border pt-3">{controls}</div>
            )}
        </section>
    );
}

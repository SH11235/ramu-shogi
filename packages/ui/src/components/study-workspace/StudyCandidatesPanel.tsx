/**
 * 候補手（解析結果）。
 *
 * いま見ている手が悪手・疑問手のときは、「この手の代わりに」（1 手前の局面の候補手）を先に出す。
 * 悪手を見つけた人がまず知りたいのは「代わりに何を指すべきだったか」なので、1 操作で届くようにする。
 *
 * 「この手の代わりに」と「この局面の候補手」は、どちらも表示中の設定の結果（悪手・疑問手の
 * 印と同じ結果）。同じ AI でより深く読んだ結果がその局面にあるときは、差し替えずに、別の小さな段
 * （「より深い解析」）として添える。
 */

import type {
    KifuNode,
    StudyAnalysisResult,
    StudyCandidate,
    StudyHighlightKind,
    StudyScore,
    StudySource,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useEffect, useId, useState } from "react";
import { Button } from "../button";
import { cardVariants } from "../card";
import { ChevronIcon } from "../chevron-icon";
import { RamRunningIcon } from "../ram-running-icon";
import { convertPvToDisplay } from "../shogi-match/utils/kifFormat";
import { Switch } from "../switch";
import { StudyIconButton } from "./StudyIconButton";
import { AddBranchIcon, PlayIcon } from "./StudyIcons";
import {
    COMPACT_BUTTON_CLASS,
    StudyMateControl,
    StudyMateResult,
    studyMateProgressText,
    studyShortestProgressText,
} from "./StudyMateSection";
import {
    formatStudyScore,
    type StudyPositionResult,
    studyBestCandidate,
    studyFirstMoveLabel,
    studyScoreSide,
} from "./studyView";
import { STUDY_DEEP_TIME_MS, type StudyLiveSearch } from "./useStudyAnalysis";

const DEEP_SEGMENT_SECONDS = STUDY_DEEP_TIME_MS / 1000;

/** 自動で読むで、続きから読めずに読み終えたときの知らせ。 */
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
interface CandidateGroup {
    /** 候補手を読んだ局面のノード。 */
    node: KifuNode;
    result: StudyPositionResult;
}

interface StudyCandidatesPanelProps {
    /** いま見ている局面のノード。 */
    node: KifuNode;
    /** いま見ている局面の解析結果。無ければ null。 */
    positionResult: StudyPositionResult | null;
    /**
     * いま見ている手が悪手・疑問手のときの、1 手前の局面の候補手（代わりに指すべきだった手）。
     * `playedLabel` は実際に指した手、`kindLabel` は判定（悪手 / 疑問手）。
     */
    alternative: (CandidateGroup & { playedLabel: string; kindLabel: string }) | null;
    /**
     * いま見ている手が悪手・疑問手で、かつ 1 手前の局面の 1 位の候補と同じ手のとき、その手の表記。
     * 代わりの手は無いので、「この手の代わりに」は出さない。
     */
    playedBestLabel?: string | null;
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
     * 「自動で読む」。`reading` はスイッチの行に出す状態（読んでいる局面など）で、無ければ null。
     * 渡さなければ出さない（編集できないとき）。
     */
    autoAnalyze?: {
        enabled: boolean;
        onChange: (enabled: boolean) => void;
        reading: string | null;
    };
    /** 「自動で読む」のスイッチを欄の外（局面の帯）に置くので、ここには出さない。 */
    autoSwitchElsewhere?: boolean;
    /** 読んでいる途中は、前回の読みを 1 行にたたむ（画面の狭いスマートフォン）。 */
    collapsePreviousWhileReading?: boolean;
    /**
     * いまの局面でパスを指し（変化として足し）、その局面を深く解析する。手番でない側が何を狙って
     * いるかを見るため。渡さなければ出さない（編集できないとき）。
     */
    onStartDeepAfterPass?: () => void;
    /**
     * 深く読んだ結果で、いま見ている手の判定が変わったときの、元の判定と新しい判定
     * （悪手でも疑問手でもないなら null）。
     */
    revision?: { from: StudyHighlightKind | null; to: StudyHighlightKind | null } | null;
    onCancel: () => void;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation?: (request: StudyPvRequest) => void;
    /** 詰み探索。使えないエンジンでは渡さない。 */
    mate?: {
        /** この局面の結果（調べていなければ undefined）。 */
        state: StudyMateState | undefined;
        /** この局面に至った手の表記。開始局面は null。 */
        moveLabel: string | null;
        onStart: () => void;
        onStop: () => void;
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
     * 読む操作（自動で読む・深く解析など）を候補手の下に置く。狭い画面では、答え（候補手）を
     * 欄の上に出すため。
     */
    controlsLast?: boolean;
    className?: string;
}

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
    const remaining =
        live.startedAt === null
            ? null
            : // 読み始めた直後の描画では `now` がまだ古いので、上限の秒数で抑える。
              Math.min(
                  live.budgetMs / 1_000,
                  Math.max(0, Math.ceil((live.startedAt + live.budgetMs - now) / 1_000)),
              );
    // 深さ・読んだ時間などは、途中の候補の見出しに出す。
    return remaining !== null ? <>（残り {remaining} 秒）</> : null;
}

const FINISHED_TEXT = {
    deep: "の深く解析が終わりました",
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
                を深く解析中
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

function CandidateRow({
    node,
    candidate,
    groupLabel,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    candidate: StudyCandidate;
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
                <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-wafuu-sumi">
                        {firstLabel ?? "（読み筋なし）"}
                    </span>
                    <span
                        className={cn(
                            "shrink-0 font-mono text-sm tabular-nums",
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

const KIND_LABEL: Record<StudyHighlightKind, string> = { blunder: "悪手", dubious: "疑問手" };

export function StudyCandidatesPanel({
    node,
    positionResult,
    alternative,
    playedBestLabel = null,
    deeperResult = null,
    source,
    analysisMode,
    isPreparing,
    live,
    autoAnalyze,
    autoSwitchElsewhere = false,
    collapsePreviousWhileReading = false,
    onStartDeepAfterPass,
    revision = null,
    onCancel,
    onPreviewPv,
    onAddPvAsVariation,
    mate,
    elsewhere,
    controlsLast = false,
    className,
}: StudyCandidatesPanelProps): ReactElement {
    const autoAnalyzeId = useId();
    const autoAnalyzeStatusId = useId();
    const previousListId = useId();
    const autoOn = autoAnalyze?.enabled ?? false;
    const autoFinished = autoAnalyze?.reading === STUDY_AUTO_ANALYZE_FINISHED;
    const isDeepHere = live !== undefined;
    const [isPreviousOpen, setIsPreviousOpen] = useState(false);
    // 別の局面の深い解析・詰み探索は、押せばそれを止めて切り替える。全体の解析の途中だけは始めない。
    const startDisabled = isPreparing || analysisMode === "full";
    const sourceText = formatStudyScore(source?.score);
    const mainResult = deeperResult ?? positionResult;
    const mainNote = mainResult
        ? `${deeperResult ? "深く解析・" : ""}${resultNote(mainResult)}`
        : null;

    const controls = (
        <>
            {/* 入れたままにする設定なので、押すと始まる操作ボタンの列とは段を分ける。 */}
            {autoAnalyze && !autoSwitchElsewhere && (
                <div className="flex items-center gap-3 rounded-lg border border-wafuu-border bg-wafuu-washi px-3 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <label
                            htmlFor={autoAnalyzeId}
                            className="shrink-0 text-sm font-medium text-wafuu-sumi"
                        >
                            自動で読む
                        </label>
                        {/* 名前・ラム・スイッチを 1 行に収める。読んでいる局面と深さは下の「今の読み」に
                            出ているので、ここでは画面読み上げ向けにだけ添える。ラムは切っている間も
                            透明にして幅を取り、入り切りで横にずれないようにする。 */}
                        <span
                            id={autoAnalyzeStatusId}
                            className="flex min-w-0 items-center gap-1.5 text-xs"
                        >
                            <RamRunningIcon
                                running={isDeepHere && !autoFinished}
                                className={cn(autoAnalyze.reading === null && "invisible")}
                            />
                            {autoFinished && (
                                <span aria-hidden="true" className="truncate text-muted-foreground">
                                    読み終えました
                                </span>
                            )}
                            {autoAnalyze.reading !== null && (
                                <span className="sr-only">{autoAnalyze.reading}</span>
                            )}
                        </span>
                    </div>
                    <Switch
                        id={autoAnalyzeId}
                        aria-describedby={autoAnalyzeStatusId}
                        checked={autoAnalyze.enabled}
                        onCheckedChange={autoAnalyze.onChange}
                    />
                </div>
            )}
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                    {onStartDeepAfterPass && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={COMPACT_BUTTON_CLASS}
                            title="手番の側がパスした局面を深く解析し、相手の狙いを見ます（パスは変化として足します）"
                            onClick={onStartDeepAfterPass}
                            disabled={startDisabled}
                        >
                            パスして解析
                        </Button>
                    )}
                    {mate && (
                        <StudyMateControl
                            state={mate.state}
                            disabled={startDisabled}
                            onStart={mate.onStart}
                            onStop={mate.onStop}
                        />
                    )}
                </div>
                {/* 押せなくはせず、押すと自動で読むが切れることを押す前に知らせる。 */}
                {autoOn && (
                    <p className="px-1 text-xs text-muted-foreground">
                        押すと、自動で読むを切ってから始めます
                    </p>
                )}
                {elsewhere && <ElsewhereActivityLine activity={elsewhere} />}
            </div>

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
            {!controlsLast && controls}
            {/* 読んでいる途中の候補。満足したら「止める」で、その時点の結果を残せる。 */}
            {live && (
                <div className="flex flex-col gap-1 rounded-lg bg-wafuu-washi px-2 py-2">
                    {/* 自動で読む間はラムをスイッチの行に、スイッチを帯に置くときは帯に出す（同じ読みに 2 つ
                        動かさない）。 */}
                    <div className="flex min-h-7 items-center gap-1.5 px-1">
                        {!autoOn && !autoSwitchElsewhere && <RamRunningIcon />}
                        {/* 深さ・秒数は 1 秒ごとに変わるので、読み上げの領域にはしない（読み続ける間ずっと
                            読み上げられてしまう）。読んでいることは、ボタン・スイッチの状態で伝わる。 */}
                        <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-wafuu-sumi">今の読み</span>
                            {/* 自動で読む間は局面を移るまで読み続けるので、残りの時間は無い。 */}
                            {!autoOn && (
                                <span className="tabular-nums">
                                    <DeepProgressNote live={live} />
                                </span>
                            )}
                            {live.preview && (
                                <span className="tabular-nums">
                                    （{searchStats(live.preview)}）
                                </span>
                            )}
                        </p>
                        {/* 自動で読むでない読み（パスして解析）は、ここで止める。自動で読む間はスイッチで止める。 */}
                        {!autoOn && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className={cn(COMPACT_BUTTON_CLASS, "ml-auto")}
                                onClick={onCancel}
                            >
                                止める
                            </Button>
                        )}
                    </div>
                    {/* 保存は「区切りまで読み切った」「深い」の順で勝つ方を残すので、読み直しても黙って
                        前の結果が残ったように見えないよう、いつ置き換わるかを添える。 */}
                    {mainResult && (
                        <p className="px-1 text-xs text-muted-foreground">
                            {live.preview && live.preview.depth > mainResult.result.depth
                                ? `保存済みの読みより深くなりました。区切り（${DEEP_SEGMENT_SECONDS} 秒ごと）まで読むと、この読みで置き換えます`
                                : `保存済みの読み（深さ ${mainResult.result.depth}）より深くなり、区切り（${DEEP_SEGMENT_SECONDS} 秒ごと）まで読むと、この読みで置き換えます`}
                        </p>
                    )}
                    {live.preview && (
                        <ol className="flex flex-col">
                            {live.preview.candidates.map((candidate) => (
                                <CandidateRow
                                    key={candidate.rank}
                                    node={node}
                                    candidate={candidate}
                                    groupLabel="途中の"
                                    onPreviewPv={onPreviewPv}
                                    onAddPvAsVariation={onAddPvAsVariation}
                                />
                            ))}
                        </ol>
                    )}
                </div>
            )}

            {revision && (
                <p className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-wafuu-sumi">
                    {revision.to !== null
                        ? `深く解析した結果、${KIND_LABEL[revision.to]}と分かりました。`
                        : revision.from !== null
                          ? `深く解析した結果、${KIND_LABEL[revision.from]}ではありませんでした。`
                          : "深く解析した結果、判定が変わりました。"}
                    <span className="ml-1 text-muted-foreground">
                        （全体の解析では
                        {revision.from === null ? "問題なし" : KIND_LABEL[revision.from]}）
                    </span>
                </p>
            )}

            {alternative && (
                <div className="flex flex-col gap-1 rounded-lg bg-wafuu-washi px-2 py-2">
                    <div className="flex flex-col px-1">
                        <h3 className="text-sm font-medium text-wafuu-sumi">
                            この手の代わりに（1 手前の局面の候補）
                        </h3>
                        <span className="text-xs text-muted-foreground">
                            指した手 {alternative.playedLabel}（{alternative.kindLabel}）・
                            {resultNote(alternative.result)}
                        </span>
                    </div>
                    <ol className="flex flex-col">
                        {alternative.result.result.candidates.map((candidate) => (
                            <CandidateRow
                                key={candidate.rank}
                                node={alternative.node}
                                candidate={candidate}
                                groupLabel="代わりの"
                                onPreviewPv={onPreviewPv}
                                onAddPvAsVariation={onAddPvAsVariation}
                            />
                        ))}
                    </ol>
                </div>
            )}

            {!alternative && playedBestLabel !== null && (
                <p className="px-1 text-xs text-muted-foreground">
                    指した手 {playedBestLabel} は、1 手前の局面の候補の 1
                    位と同じ手です（代わりの手はありません）。
                </p>
            )}

            {/* 深く解析した結果があれば、それを候補手の一覧にする（同じ局面をより深く読んだ結果なので）。
                全体の解析の結果は、最善手だけを 1 行で添える。 */}
            <div className="flex flex-col gap-1">
                {/* 悪手・疑問手の局面では「この手の代わりに」と分けるため、ここにも見出しと注記を置く。 */}
                {live && mainResult ? (
                    // 狭い画面では、今の読みを見やすくするため 1 行にたたむ。
                    collapsePreviousWhileReading ? (
                        <button
                            type="button"
                            aria-expanded={isPreviousOpen}
                            aria-controls={previousListId}
                            onClick={() => setIsPreviousOpen(!isPreviousOpen)}
                            className="flex min-h-11 min-w-0 items-center gap-1 rounded-md px-1 text-left text-xs text-muted-foreground hover:text-wafuu-sumi focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            <span className="shrink-0 font-medium text-wafuu-sumi">
                                保存済みの読み
                            </span>
                            <span className="min-w-0 truncate">{mainNote}</span>
                            <ChevronIcon expanded={isPreviousOpen} className="ml-auto" />
                        </button>
                    ) : (
                        <p className="flex min-w-0 gap-1 px-1 text-xs text-muted-foreground">
                            <span className="shrink-0 font-medium text-wafuu-sumi">
                                保存済みの読み
                            </span>
                            <span className="min-w-0 truncate" title={mainNote ?? undefined}>
                                {mainNote}
                            </span>
                        </p>
                    )
                ) : alternative ? (
                    <div className="flex flex-col px-1">
                        <h3 className="text-sm font-medium text-wafuu-sumi">この局面の候補手</h3>
                        {mainResult && (
                            <span className="text-xs text-muted-foreground">{mainNote}</span>
                        )}
                    </div>
                ) : (
                    mainResult && (
                        // 1 行に収まらないときは省略し、全文はマウスを載せると見られるようにする。
                        <p
                            className="truncate px-1 text-xs text-muted-foreground"
                            title={mainNote ?? undefined}
                        >
                            {mainNote}
                        </p>
                    )
                )}
                {mainResult ? (
                    <ol
                        id={previousListId}
                        className="flex flex-col"
                        hidden={
                            live !== undefined && collapsePreviousWhileReading && !isPreviousOpen
                        }
                    >
                        {mainResult.result.candidates.map((candidate) => (
                            <CandidateRow
                                key={candidate.rank}
                                node={node}
                                candidate={candidate}
                                groupLabel=""
                                onPreviewPv={onPreviewPv}
                                onAddPvAsVariation={onAddPvAsVariation}
                            />
                        ))}
                    </ol>
                ) : (
                    // 深く解析している間は、上の途中経過で分かる。
                    !live && (
                        <p className="px-1 text-sm text-muted-foreground">
                            この局面はまだ解析していません。
                        </p>
                    )
                )}
                {deeperResult && positionResult && (
                    <ShallowResultLine node={node} result={positionResult} />
                )}
            </div>

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

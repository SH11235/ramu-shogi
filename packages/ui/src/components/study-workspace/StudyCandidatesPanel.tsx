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
import { useEffect, useState } from "react";
import { Button } from "../button";
import { cardVariants } from "../card";
import { convertPvToDisplay } from "../shogi-match/utils/kifFormat";
import { StudyIconButton } from "./StudyIconButton";
import { AddBranchIcon, ClockPlusIcon, PlayIcon } from "./StudyIcons";
import { COMPACT_BUTTON_CLASS, StudyMateControl, StudyMateResult } from "./StudyMateSection";
import {
    formatStudyScore,
    type StudyPositionResult,
    studyBestCandidate,
    studyFirstMoveLabel,
    studyScoreSide,
} from "./studyView";
import type { StudyLiveSearch } from "./useStudyAnalysis";
import type { StudyMateState } from "./useStudyMate";

/** 読み筋を盤で見る・変化として足すときに渡す内容。 */
export interface StudyPvRequest {
    /** 読み筋の始まる局面のノード。 */
    nodeId: string;
    pv: string[];
    score: StudyScore | null;
}

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
    onStartDeep: () => void;
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
    /** この局面で止めた「深く解析」を、続きから読める。 */
    canContinueDeep?: boolean;
    onContinueDeep?: () => void;
    onCancel: () => void;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
    /** 詰み探索。使えないエンジンでは渡さない。 */
    mate?: {
        /** この局面の結果（調べていなければ undefined）。 */
        state: StudyMateState | undefined;
        /** 別の局面を調べている途中。 */
        busyElsewhere: boolean;
        onStart: () => void;
        onStop: () => void;
    };
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
            : Math.max(0, Math.ceil((live.startedAt + live.budgetMs - now) / 1_000));
    // 深さ・読んだ時間などは、途中の候補の見出しに出す。
    return remaining !== null ? <>（残り {remaining} 秒）</> : null;
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
    onAddPvAsVariation: (request: StudyPvRequest) => void;
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
                    <StudyIconButton
                        label={`${groupLabel}候補 ${candidate.rank} の読み筋を変化として追加`}
                        onClick={() => onAddPvAsVariation(request)}
                    >
                        <AddBranchIcon />
                    </StudyIconButton>
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
    onStartDeep,
    onStartDeepAfterPass,
    revision = null,
    canContinueDeep = false,
    onContinueDeep,
    onCancel,
    onPreviewPv,
    onAddPvAsVariation,
    mate,
    className,
}: StudyCandidatesPanelProps): ReactElement {
    const isDeepHere = live !== undefined;
    const mateRunning =
        mate !== undefined && (mate.state?.status === "running" || mate.busyElsewhere);
    const sourceText = formatStudyScore(source?.score);
    const mainResult = deeperResult ?? positionResult;

    return (
        <section
            aria-label="候補手"
            className={cn(
                cardVariants({ variant: "wafuu", elevation: "raised" }),
                "flex flex-col gap-3 p-3",
                className,
            )}
        >
            <div className="flex flex-col gap-2">
                {/* 欄の名前は見出しとして画面に出さない（PC は欄の並び、スマートフォンはタブで分かる）。 */}
                <h2 className="sr-only">候補手</h2>
                <div className="flex items-center gap-1.5">
                    {/* 深く解析・止める・続けて読むは同じ枠で入れ替え、枠の幅をいちばん長い文言に合わせる
                        （切り替わるたびに隣のボタンが動かないように）。深さ・残りの時間は下の行に出す。 */}
                    <div className="grid">
                        <span
                            aria-hidden="true"
                            className={cn(
                                COMPACT_BUTTON_CLASS,
                                "invisible col-start-1 row-start-1 flex items-center border border-transparent",
                            )}
                        >
                            <ClockPlusIcon />
                            続けて読む
                        </span>
                        <div className="col-start-1 row-start-1 flex">
                            {isDeepHere ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={cn(COMPACT_BUTTON_CLASS, "w-full")}
                                    onClick={onCancel}
                                >
                                    止める
                                </Button>
                            ) : canContinueDeep && onContinueDeep ? (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={cn(COMPACT_BUTTON_CLASS, "w-full")}
                                    onClick={onContinueDeep}
                                    disabled={isPreparing || analysisMode !== null || mateRunning}
                                >
                                    <ClockPlusIcon />
                                    続けて読む
                                </Button>
                            ) : (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className={cn(COMPACT_BUTTON_CLASS, "w-full")}
                                    aria-label="この局面を深く解析"
                                    onClick={onStartDeep}
                                    disabled={isPreparing || analysisMode !== null || mateRunning}
                                >
                                    深く解析
                                </Button>
                            )}
                        </div>
                    </div>
                    {onStartDeepAfterPass && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className={COMPACT_BUTTON_CLASS}
                            title="手番の側がパスした局面を深く解析し、相手の狙いを見ます（パスは変化として足します）"
                            onClick={onStartDeepAfterPass}
                            disabled={isPreparing || analysisMode !== null || mateRunning}
                        >
                            パスして解析
                        </Button>
                    )}
                    {mate && (
                        <StudyMateControl
                            state={mate.state}
                            busyElsewhere={mate.busyElsewhere}
                            disabled={isPreparing || analysisMode !== null}
                            onStart={mate.onStart}
                            onStop={mate.onStop}
                        />
                    )}
                </div>
                {live && (
                    <output
                        aria-live="polite"
                        className="text-xs tabular-nums text-muted-foreground"
                    >
                        深く解析中
                        <DeepProgressNote live={live} />
                    </output>
                )}
            </div>

            {/* 読んでいる途中の候補。満足したら「止める」で、その時点の結果を残せる。 */}
            {live?.preview && (
                <div className="flex flex-col gap-1 rounded-lg bg-wafuu-washi px-2 py-2">
                    <span className="px-1 text-xs text-muted-foreground">
                        読んでいる途中の候補（{searchStats(live.preview)}）
                    </span>
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

            {mate && (
                <StudyMateResult
                    node={node}
                    state={mate.state}
                    onPreviewPv={onPreviewPv}
                    onAddPvAsVariation={onAddPvAsVariation}
                />
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
                <div className="flex flex-col px-1">
                    {alternative && (
                        <h3 className="text-sm font-medium text-wafuu-sumi">この局面の候補手</h3>
                    )}
                    {mainResult && (
                        <span className="text-xs text-muted-foreground">
                            {deeperResult ? "深く解析・" : ""}
                            {resultNote(mainResult)}
                        </span>
                    )}
                </div>
                {mainResult ? (
                    <ol className="flex flex-col">
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
                    <p className="px-1 text-sm text-muted-foreground">
                        この局面はまだ解析していません。
                    </p>
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
        </section>
    );
}

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
    StudyCandidate,
    StudyHighlightKind,
    StudyScore,
    StudySource,
} from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { useState } from "react";
import { Button } from "../button";
import { convertPvToDisplay } from "../shogi-match/utils/kifFormat";
import { StudyIconButton } from "./StudyIconButton";
import { AddBranchIcon, AnalyzeIcon, PlayIcon } from "./StudyIcons";
import { StudyMateControl, StudyMateResult } from "./StudyMateSection";
import {
    formatStudyScore,
    type StudyPositionResult,
    studyBestCandidate,
    studyFirstMoveLabel,
    studyScoreSide,
} from "./studyView";
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
    /** `deeperResult` が、利用者がいま「この局面を深く解析」で得た結果か（開いた状態で目立たせる）。 */
    deeperIsFresh?: boolean;
    /** 表示する解析結果を、その設定に切り替える。 */
    onShowLayer?: (layerId: string) => void;
    /** いま見ている手に棋譜から付いていた評価値・読み筋（対局時の評価値）。 */
    source: StudySource | null;
    analysisMode: "full" | "deep" | null;
    isPreparing: boolean;
    /** この局面を深く解析している途中経過。別の局面を解析中・解析していなければ undefined。 */
    liveDepth: number | null | undefined;
    onStartDeep: () => void;
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

/** どの設定の結果かの注記（例: `RAMU・1 秒・深さ 15`）。 */
function resultNote(result: StudyPositionResult): string {
    return [
        result.layer.display.label,
        `深さ ${result.result.depth}`,
        ...(result.result.completion === "aborted" ? ["途中まで"] : []),
    ].join("・");
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
function DeeperResultSection({
    node,
    result,
    isFresh,
    onShowLayer,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    result: StudyPositionResult;
    isFresh: boolean;
    onShowLayer?: (layerId: string) => void;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
}): ReactElement {
    // 開いた・閉じた局面を覚える（別の局面へ移ったら、既定の状態に戻る）。
    const [openedNodeId, setOpenedNodeId] = useState<string | null>(null);
    const [closedNodeId, setClosedNodeId] = useState<string | null>(null);
    const isOpen = isFresh ? closedNodeId !== node.id : openedNodeId === node.id;
    const best = studyBestCandidate(result.result);
    const bestLabel = best ? studyFirstMoveLabel(node, best.pv) : null;
    const toggle = (): void => {
        setOpenedNodeId(isOpen ? null : node.id);
        setClosedNodeId(isOpen ? node.id : null);
    };
    return (
        <div
            className={cn(
                "flex flex-col gap-1 rounded-lg border px-2 py-1",
                isFresh ? "border-wafuu-shu/40 bg-wafuu-shu/5" : "border-border bg-wafuu-washi",
            )}
        >
            <button
                type="button"
                aria-expanded={isOpen}
                onClick={toggle}
                className="flex min-h-10 w-full flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1 text-left text-xs text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                <span className={cn("font-medium", isFresh && "text-wafuu-shu")}>
                    {isFresh ? "深く解析した結果" : "より深い解析"}（{resultNote(result)}）
                </span>
                {best && bestLabel && (
                    <span className="flex items-baseline gap-1.5">
                        <span className="text-sm font-medium text-wafuu-sumi">{bestLabel}</span>
                        <span
                            className={cn(
                                "font-mono text-sm tabular-nums",
                                sideClass(studyScoreSide(best.score)),
                            )}
                        >
                            {formatStudyScore(best.score)}
                        </span>
                    </span>
                )}
                <span className="ml-auto shrink-0 underline underline-offset-2">
                    {isOpen ? "閉じる" : "読み筋を見る"}
                </span>
            </button>
            {isOpen && (
                <>
                    <ol className="flex flex-col">
                        {result.result.candidates.map((candidate) => (
                            <CandidateRow
                                key={candidate.rank}
                                node={node}
                                candidate={candidate}
                                groupLabel="深い解析の"
                                onPreviewPv={onPreviewPv}
                                onAddPvAsVariation={onAddPvAsVariation}
                            />
                        ))}
                    </ol>
                    {onShowLayer && (
                        <button
                            type="button"
                            onClick={() => onShowLayer(result.layer.id)}
                            className="min-h-10 self-start rounded-md px-1 text-left text-xs text-wafuu-ai underline underline-offset-2 hover:text-wafuu-ai-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                            表示を「{result.layer.display.label}」の結果に切り替える
                        </button>
                    )}
                </>
            )}
        </div>
    );
}

const KIND_LABEL: Record<StudyHighlightKind, string> = { blunder: "悪手", dubious: "疑問手" };

export function StudyCandidatesPanel({
    node,
    positionResult,
    alternative,
    playedBestLabel = null,
    deeperResult = null,
    deeperIsFresh = false,
    onShowLayer,
    source,
    analysisMode,
    isPreparing,
    liveDepth,
    onStartDeep,
    revision = null,
    canContinueDeep = false,
    onContinueDeep,
    onCancel,
    onPreviewPv,
    onAddPvAsVariation,
    mate,
    className,
}: StudyCandidatesPanelProps): ReactElement {
    const isDeepHere = liveDepth !== undefined;
    const mateRunning =
        mate !== undefined && (mate.state?.status === "running" || mate.busyElsewhere);
    const sourceText = formatStudyScore(source?.score);

    return (
        <section
            aria-label="候補手"
            className={cn(
                "flex flex-col gap-3 rounded-xl border border-wafuu-border bg-card p-3 shadow-sm",
                className,
            )}
        >
            <div className="flex flex-col gap-2">
                <h2 className="font-display text-base font-semibold text-wafuu-sumi">候補手</h2>
                <div className="flex flex-wrap items-center gap-2">
                    {isDeepHere ? (
                        <div className="flex items-center gap-2">
                            <output aria-live="polite" className="text-xs text-muted-foreground">
                                深く解析中{liveDepth ? `（深さ ${liveDepth}）` : ""}
                            </output>
                            <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                                止める
                            </Button>
                        </div>
                    ) : canContinueDeep && onContinueDeep ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={onContinueDeep}
                            disabled={isPreparing || analysisMode !== null || mateRunning}
                        >
                            <AnalyzeIcon />
                            続けて読む
                        </Button>
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-1.5"
                            onClick={onStartDeep}
                            disabled={isPreparing || analysisMode !== null || mateRunning}
                        >
                            <AnalyzeIcon />
                            この局面を深く解析
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
            </div>

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

            {/* いま深く解析して得た結果は、押したボタンのすぐ下に出す（見当たらない、を防ぐ）。 */}
            {deeperResult && deeperIsFresh && (
                <DeeperResultSection
                    node={node}
                    result={deeperResult}
                    isFresh={deeperIsFresh}
                    onShowLayer={onShowLayer}
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

            <div className="flex flex-col gap-1">
                <div className="flex flex-col px-1">
                    {alternative && (
                        <h3 className="text-sm font-medium text-wafuu-sumi">この局面の候補手</h3>
                    )}
                    {positionResult && (
                        <span className="text-xs text-muted-foreground">
                            {resultNote(positionResult)}
                        </span>
                    )}
                </div>
                {positionResult ? (
                    <ol className="flex flex-col">
                        {positionResult.result.candidates.map((candidate) => (
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
            </div>

            {deeperResult && !deeperIsFresh && (
                <DeeperResultSection
                    node={node}
                    result={deeperResult}
                    isFresh={deeperIsFresh}
                    onShowLayer={onShowLayer}
                    onPreviewPv={onPreviewPv}
                    onAddPvAsVariation={onAddPvAsVariation}
                />
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
        </section>
    );
}

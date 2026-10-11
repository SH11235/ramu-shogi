/**
 * 候補手（解析結果）。
 *
 * いま見ている手が悪手・疑問手のときは、「この手の代わりに」（1 手前の局面の候補手）を先に出す。
 * 悪手を見つけた人がまず知りたいのは「代わりに何を指すべきだったか」なので、1 操作で届くようにする。
 */

import type { KifuNode, StudyCandidate, StudyScore, StudySource } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement } from "react";
import { Button } from "../button";
import { convertPvToDisplay } from "../shogi-match/utils/kifFormat";
import { StudyIconButton } from "./StudyIconButton";
import { AddBranchIcon, AnalyzeIcon, PlayIcon } from "./StudyIcons";
import { formatStudyScore, type StudyPositionResult, studyScoreSide } from "./studyView";

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
    /** いま見ている手に棋譜から付いていた評価値・読み筋（対局時の評価値）。 */
    source: StudySource | null;
    analysisMode: "full" | "deep" | null;
    isPreparing: boolean;
    /** この局面を深く解析している途中経過。別の局面を解析中・解析していなければ undefined。 */
    liveDepth: number | null | undefined;
    onStartDeep: () => void;
    onCancel: () => void;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
    className?: string;
}

const sideClass = (side: "sente" | "gote" | null): string =>
    side === "sente" ? "text-wafuu-shu" : side === "gote" ? "text-wafuu-ai" : "text-foreground";

/** どの設定の結果かの注記（例: `RAMU・1 秒・深さ 15`、`深く解析した結果（RAMU・10 秒）・深さ 22`）。 */
function resultNote(result: StudyPositionResult): string {
    const { label } = result.layer.display;
    return [
        result.fromDisplayLayer ? label : `深く解析した結果（${label}）`,
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
    const [first, ...rest] = display;
    const hasPv = display.length > 0;
    const request: StudyPvRequest = { nodeId: node.id, pv: candidate.pv, score: candidate.score };
    return (
        <li className="flex items-start gap-2 rounded-md px-1 py-1">
            <span className="w-4 shrink-0 pt-0.5 text-center font-mono text-xs tabular-nums text-muted-foreground">
                {candidate.rank}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-wafuu-sumi">
                        {first?.displayText ?? "（読み筋なし）"}
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
                <div className="flex shrink-0 items-center">
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

export function StudyCandidatesPanel({
    node,
    positionResult,
    alternative,
    source,
    analysisMode,
    isPreparing,
    liveDepth,
    onStartDeep,
    onCancel,
    onPreviewPv,
    onAddPvAsVariation,
    className,
}: StudyCandidatesPanelProps): ReactElement {
    const isDeepHere = liveDepth !== undefined;
    const sourceText = formatStudyScore(source?.score);

    return (
        <section
            aria-label="候補手"
            className={cn(
                "flex flex-col gap-3 rounded-xl border border-wafuu-border bg-card p-3 shadow-sm",
                className,
            )}
        >
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-display text-base font-semibold text-wafuu-sumi">候補手</h2>
                {isDeepHere ? (
                    <div className="flex items-center gap-2">
                        <output aria-live="polite" className="text-xs text-muted-foreground">
                            深く解析中{liveDepth ? `（深さ ${liveDepth}）` : ""}
                        </output>
                        <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                            中止
                        </Button>
                    </div>
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={onStartDeep}
                        disabled={isPreparing || analysisMode !== null}
                    >
                        <AnalyzeIcon />
                        この局面を深く解析
                    </Button>
                )}
            </div>

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

            {source && (sourceText !== "" || source.pv) && (
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border pt-2 text-xs text-muted-foreground">
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

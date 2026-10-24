/**
 * 候補手の欄に出す詰み探索 (調べるボタン・途中経過・結果)。手番側の詰みと、手番側に掛かっている詰めろ（手番を相手に渡したら
 * 詰まされるか）を 1 行ずつ出す。
 */

import type { KifuNode } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { MateResult } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { Button } from "../button";
import { convertPvToDisplay } from "../shogi-match/utils/kifFormat";
import type { StudyPvRequest } from "./StudyCandidatesPanel";
import { StudyIconButton } from "./StudyIconButton";
import { AddBranchIcon, PlayIcon } from "./StudyIcons";
import { studyFirstMoveLabel } from "./studyView";
import { STUDY_MATE_TIME_MS, type StudyMateState } from "./useStudyMate";

const sideClass = (turn: "sente" | "gote"): string =>
    turn === "sente" ? "text-wafuu-shu" : "text-wafuu-ai";

const opponent = (turn: "sente" | "gote"): "sente" | "gote" =>
    turn === "sente" ? "gote" : "sente";

const TIME_LIMIT_SECONDS = STUDY_MATE_TIME_MS / 1000;

/** 調べている途中の表示（例: `詰みを調べています（3 秒・120 万局面）`）。 */
export function studyMateProgressText(state: StudyMateState & { status: "running" }): string {
    const what = state.phase === "mate" ? "詰み" : "詰めろ";
    const seconds = Math.floor(state.elapsedMs / 1000);
    const nodes =
        state.nodes >= 10_000
            ? `${Math.floor(state.nodes / 10_000)} 万局面`
            : `${state.nodes} 局面`;
    return `${what}を調べています（${seconds} 秒・${nodes}）`;
}

function MateLine({
    label,
    turn,
    result,
    moves,
    unknownText,
    actions,
}: {
    label: string;
    /** 詰ませる側。 */
    turn: "sente" | "gote";
    result: MateResult;
    moves: string[];
    unknownText: string;
    actions?: ReactElement;
}): ReactElement {
    return (
        <div className="flex items-baseline gap-2 px-1 py-1">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {result.kind === "mate" ? (
                    <>
                        {/* 見つけた手順は最短とも、受けの最善とも限らないので「N 手詰め」とは言わない */}
                        <span className="flex items-baseline gap-1.5">
                            <span className={cn("text-sm font-medium", sideClass(turn))}>
                                {turn === "sente" ? "☗" : "☖"}詰みあり
                            </span>
                            <span className="text-xs text-muted-foreground">
                                {result.pv.length} 手の手順
                            </span>
                        </span>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                            {moves.join(" ")}
                        </p>
                    </>
                ) : (
                    <span className="text-sm text-wafuu-sumi">
                        {result.kind === "noMate"
                            ? "なし"
                            : result.kind === "unknown"
                              ? unknownText
                              : "この局面は調べられません"}
                    </span>
                )}
            </div>
            {result.kind === "mate" && actions}
        </div>
    );
}

export function StudyMateSection({
    node,
    state,
    busyElsewhere,
    onStart,
    onStop,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    /** この局面の結果（調べていなければ undefined）。 */
    state: StudyMateState | undefined;
    /** 別の局面を調べている途中（終わるまで始められない）。 */
    busyElsewhere: boolean;
    onStart: () => void;
    onStop: () => void;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
}): ReactElement {
    if (state?.status === "running") {
        return (
            <div className="flex min-h-10 items-center justify-between gap-2 px-1">
                <output aria-live="polite" className="text-xs text-muted-foreground">
                    {studyMateProgressText(state)}
                </output>
                <Button type="button" variant="outline" size="sm" onClick={onStop}>
                    中止
                </Button>
            </div>
        );
    }
    if (state?.status !== "done") {
        return (
            <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-2 gap-y-1 px-1">
                {state?.status === "error" ? (
                    <p role="alert" className="text-xs text-destructive">
                        {state.message}
                    </p>
                ) : (
                    <span className="text-xs text-muted-foreground">詰み・詰めろ</span>
                )}
                <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onStart}
                    disabled={busyElsewhere}
                >
                    詰みを調べる
                </Button>
            </div>
        );
    }
    const turn = node.positionAfter.turn;
    const { mate, threat } = state;
    const mateMoves =
        mate.kind === "mate"
            ? [
                  studyFirstMoveLabel(node, mate.pv) ?? "",
                  ...convertPvToDisplay(mate.pv, node.positionAfter)
                      .slice(1)
                      .map((move) => move.displayText),
              ]
            : [];
    const threatMoves =
        threat?.kind === "mate"
            ? convertPvToDisplay(threat.pv, { ...node.positionAfter, turn: opponent(turn) }).map(
                  (move) => move.displayText,
              )
            : [];
    const request: StudyPvRequest | null =
        mate.kind === "mate" ? { nodeId: node.id, pv: mate.pv, score: null } : null;
    return (
        <div className="flex flex-col rounded-lg border border-border px-1 py-1">
            <MateLine
                label="詰み"
                turn={turn}
                result={mate}
                moves={mateMoves}
                unknownText={`${TIME_LIMIT_SECONDS} 秒では読み切れませんでした`}
                actions={
                    request ? (
                        <div className="flex shrink-0 items-center self-start">
                            <StudyIconButton
                                label="詰み手順を盤で見る"
                                onClick={() => onPreviewPv(request)}
                            >
                                <PlayIcon />
                            </StudyIconButton>
                            <StudyIconButton
                                label="詰み手順を変化として追加"
                                onClick={() => onAddPvAsVariation(request)}
                            >
                                <AddBranchIcon />
                            </StudyIconButton>
                        </div>
                    ) : undefined
                }
            />
            {threat && (
                <MateLine
                    label="詰めろ"
                    turn={opponent(turn)}
                    result={threat}
                    moves={threatMoves}
                    unknownText={`${TIME_LIMIT_SECONDS} 秒では読み切れませんでした`}
                />
            )}
        </div>
    );
}

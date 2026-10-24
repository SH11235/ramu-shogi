/**
 * 候補手の欄に出す詰み探索（調べるボタン・途中経過・結果）。手番側の詰みと、手番側に掛かっている
 * 詰めろ（手番を相手に渡したら詰まされるか）を 1 行ずつ出す。
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

type Side = "sente" | "gote";

const sideClass = (side: Side): string => (side === "sente" ? "text-wafuu-shu" : "text-wafuu-ai");
const sideMark = (side: Side): string => (side === "sente" ? "☗" : "☖");
const opponent = (side: Side): Side => (side === "sente" ? "gote" : "sente");

const UNKNOWN_TEXT = `${STUDY_MATE_TIME_MS / 1000} 秒では読み切れませんでした`;

/** 調べている途中の表示（例: `詰みを調べています（3 秒・120 万局面）`）。 */
export function studyMateProgressText(state: StudyMateState & { status: "running" }): string {
    const what = state.phase === "mate" ? "詰み" : "詰めろ";
    // 最初の途中経過はエンジンの起動を待つ間なので、数字を出さない
    if (state.nodes === 0) return `${what}を調べています`;
    const seconds = Math.floor(state.elapsedMs / 1000);
    const nodes =
        state.nodes >= 10_000
            ? `${Math.floor(state.nodes / 10_000)} 万局面`
            : `${state.nodes} 局面`;
    return `${what}を調べています（${seconds} 秒・${nodes}）`;
}

function StopButton({ onStop }: { onStop: () => void }): ReactElement {
    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="詰み探索を中止"
            onClick={onStop}
        >
            中止
        </Button>
    );
}

function MateLine({
    label,
    mover,
    result,
    moves,
    unsupportedText,
    actions,
}: {
    label: string;
    /** 詰ませる側。 */
    mover: Side;
    result: MateResult;
    moves: string[];
    /** 扱えない局面のときの文言（詰めろの行は扱えない局面を出さないので省く）。 */
    unsupportedText?: string;
    actions?: ReactElement;
}): ReactElement {
    return (
        <div className="flex items-baseline gap-2 px-1 py-1">
            <span className="w-12 shrink-0 text-xs text-muted-foreground">{label}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {result.kind === "mate" ? (
                    <>
                        {/* 見つけた手順は最短とも、受けの最善とも限らないので「N 手詰め」とは言わない */}
                        <span className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className={cn("text-sm font-medium", sideClass(mover))}>
                                あり
                            </span>
                            <span className="text-xs text-muted-foreground">
                                （{sideMark(mover)}の詰み・{result.pv.length} 手の手順）
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
                              ? UNKNOWN_TEXT
                              : unsupportedText}
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
    /** 別の局面を調べている途中（終わるか中止するまで始められない）。 */
    busyElsewhere: boolean;
    onStart: () => void;
    onStop: () => void;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
}): ReactElement {
    if (state?.status === "running" || busyElsewhere) {
        const progress = (
            <div className="flex min-h-10 items-center justify-between gap-2 px-1">
                <output aria-live="polite" className="text-xs text-muted-foreground">
                    {state?.status === "running"
                        ? studyMateProgressText(state)
                        : "別の局面の詰みを調べています"}
                </output>
                <StopButton onStop={onStop} />
            </div>
        );
        // この局面の結果があれば、それも出す（別の局面を調べている間に戻ってきたとき）
        if (state?.status !== "done") return progress;
        return (
            <div className="flex flex-col gap-1">
                <MateResults
                    node={node}
                    state={state}
                    onPreviewPv={onPreviewPv}
                    onAddPvAsVariation={onAddPvAsVariation}
                />
                {progress}
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
                <Button type="button" variant="outline" size="sm" onClick={onStart}>
                    詰みを調べる
                </Button>
            </div>
        );
    }
    return (
        <MateResults
            node={node}
            state={state}
            onPreviewPv={onPreviewPv}
            onAddPvAsVariation={onAddPvAsVariation}
        />
    );
}

function MateResults({
    node,
    state,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    state: StudyMateState & { status: "done" };
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
}): ReactElement {
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
                mover={turn}
                result={mate}
                moves={mateMoves}
                unsupportedText="玉の無い局面は調べられません"
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
                    mover={opponent(turn)}
                    result={threat}
                    moves={threatMoves}
                />
            )}
        </div>
    );
}

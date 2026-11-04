/**
 * 候補手の欄に出す詰み探索。操作（調べるボタン・中止）は「この局面を深く解析」と並べ、途中経過と
 * 結果（手番側の詰みと、手番側に掛かっている詰めろ）は、調べた局面の詰み探索の枠に出す。
 */

import type { KifuNode } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { MateResult } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { Button } from "../button";
import { sidesWithoutKing } from "../shogi-match/utils/boardUtils";
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

const LIMIT_SECONDS = STUDY_MATE_TIME_MS / 1000;
const UNKNOWN_TEXT = `${LIMIT_SECONDS} 秒では読み切れませんでした`;

/**
 * 調べている途中の表示（例: `詰みを調べています（3 / 10 秒）`）。上限も出し、すぐ終わったのが
 * 打ち切りではないと分かるようにする。狭い列でも 1 行に収まる長さにする。`short` は、局面の表記と
 * 並べる別の局面の行に使う短い言い方（`詰みを調べ中`）。
 */
export function studyMateProgressText(
    state: StudyMateState & { status: "running" },
    { short = false }: { short?: boolean } = {},
): string {
    const what = `${state.phase === "mate" ? "詰み" : "詰めろ"}を${short ? "調べ中" : "調べています"}`;
    // 最初の途中経過はエンジンの起動を待つ間なので、数字を出さない
    if (state.nodes === 0) return what;
    return `${what}（${Math.floor(state.elapsedMs / 1000)} / ${LIMIT_SECONDS} 秒）`;
}

/** 調べるのに掛かった時間。一瞬で終わっても、調べ終えたことが分かるように 0 秒とは書かない。 */
function formatMateSeconds(elapsedMs: number): string {
    if (elapsedMs < 100) return "0.1 秒未満";
    return `${(elapsedMs / 1000).toFixed(1)} 秒`;
}

/** 候補手の欄の操作のボタン。1 行に並べて候補手の場所を空けるため、小さめにする。 */
export const COMPACT_BUTTON_CLASS = "h-8 gap-1 whitespace-nowrap px-2 text-xs";

function StopButton({ onStop }: { onStop: () => void }): ReactElement {
    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="詰み探索を中止"
            className={cn(COMPACT_BUTTON_CLASS, "w-full")}
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
    elapsedMs,
    moves,
    unsupportedText,
    actions,
}: {
    label: string;
    /** 詰ませる側。 */
    mover: Side;
    result: MateResult;
    /** 調べるのに掛かった時間（ミリ秒）。 */
    elapsedMs: number;
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
                                （{sideMark(mover)}の詰み・{result.pv.length} 手・
                                {formatMateSeconds(elapsedMs)}）
                            </span>
                        </span>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                            {moves.join(" ")}
                        </p>
                    </>
                ) : result.kind === "noMate" ? (
                    // 「なし」は打ち切りではなく、王手を続けて詰む手順が無いと読み切った結論
                    <span className="flex flex-wrap items-baseline gap-x-1.5">
                        <span className="text-sm text-wafuu-sumi">なし</span>
                        <span className="text-xs text-muted-foreground">
                            （読み切り・{formatMateSeconds(elapsedMs)}）
                        </span>
                    </span>
                ) : (
                    <span className="text-sm text-wafuu-sumi">
                        {result.kind === "unknown" ? UNKNOWN_TEXT : unsupportedText}
                    </span>
                )}
            </div>
            {result.kind === "mate" && actions}
        </div>
    );
}

/**
 * 「詰みを読む」のボタン。この局面を調べている間は同じ場所が「中止」に替わる。枠の幅は「詰みを読む」
 * に合わせ、途中経過は詰み探索の枠に出す（ボタンの行の幅を変えない）。別の局面を調べている途中に
 * 押すと、そちらを止めてこの局面を調べる（呼び出し側が切り替える）。
 */
export function StudyMateControl({
    state,
    disabled,
    onStart,
    onStop,
}: {
    /** この局面の結果（調べていなければ undefined）。 */
    state: StudyMateState | undefined;
    /** 準備中か、全体の解析の途中（解析と詰み探索は同時に動かさない）。 */
    disabled: boolean;
    onStart: () => void;
    onStop: () => void;
}): ReactElement {
    const running = state?.status === "running";
    return (
        <div className="grid">
            <span
                aria-hidden="true"
                className={cn(
                    COMPACT_BUTTON_CLASS,
                    "invisible col-start-1 row-start-1 flex items-center border border-transparent font-medium",
                )}
            >
                詰みを読む
            </span>
            <div className="col-start-1 row-start-1 flex">
                {running ? (
                    <StopButton onStop={onStop} />
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(COMPACT_BUTTON_CLASS, "w-full")}
                        onClick={onStart}
                        disabled={disabled}
                    >
                        詰みを読む
                    </Button>
                )}
            </div>
        </div>
    );
}

/**
 * 調べた局面の詰み探索の枠（調べていない局面は何も出さない）。見出しに途中経過を出し、調べ直して
 * いる間は前の結果を薄く出しておく（欄が消えて下の内容が動かないように）。
 */
export function StudyMateResult({
    node,
    state,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    state: StudyMateState | undefined;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
}): ReactElement | null {
    if (state === undefined) return null;
    if (state.status === "error") {
        return (
            <p role="alert" className="px-1 text-xs text-destructive">
                {state.message}
            </p>
        );
    }
    const done = state.status === "done" ? state : (state.previous ?? null);
    return (
        <section
            aria-label="詰み探索"
            className="flex flex-col rounded-lg border border-border px-1 py-1"
        >
            <div className="flex items-baseline gap-1.5 px-1 py-0.5 text-xs text-muted-foreground">
                <h3 className="font-medium text-wafuu-sumi">詰み探索</h3>
                {state.status === "running" ? (
                    <output aria-live="polite" className="tabular-nums">
                        {studyMateProgressText(state)}
                    </output>
                ) : (
                    <span>（詰み・詰めろをそれぞれ最大 {LIMIT_SECONDS} 秒）</span>
                )}
            </div>
            {done && (
                <div
                    aria-busy={state.status === "running" ? true : undefined}
                    className={cn("flex flex-col", state.status === "running" && "opacity-50")}
                >
                    <MateResults
                        node={node}
                        state={done}
                        onPreviewPv={onPreviewPv}
                        onAddPvAsVariation={onAddPvAsVariation}
                    />
                </div>
            )}
        </section>
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
    const { mate, mateMs, threat, threatMs } = state;
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
        <>
            <MateLine
                label="詰み"
                mover={turn}
                result={mate}
                elapsedMs={mateMs}
                moves={mateMoves}
                unsupportedText={
                    sidesWithoutKing(node.positionAfter).includes(opponent(turn))
                        ? "相手の玉が無い局面は調べられません"
                        : "王手を放置した局面（手番でない側の玉に王手が掛かっている）は調べられません"
                }
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
            {threat && threatMs !== null && (
                <MateLine
                    label="詰めろ"
                    mover={opponent(turn)}
                    result={threat}
                    elapsedMs={threatMs}
                    moves={threatMoves}
                />
            )}
        </>
    );
}

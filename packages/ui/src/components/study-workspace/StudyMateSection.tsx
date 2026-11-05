/**
 * 候補手の欄に出す詰み探索。操作（調べるボタン・中止）は「この局面を深く解析」と並べ、途中経過と
 * 結果は、調べた局面の詰み探索の枠に出す。結果は「☗玉の詰み」「☖玉に詰めろ」のように、どちらの玉の
 * 話かで言う（詰み・詰めろという言葉に慣れていなくても、どちらが危ないかが分かるように）。
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
import {
    STUDY_MATE_TIME_MS,
    STUDY_SHORTEST_MATE_TIME_MS,
    type StudyMateState,
    type StudyShortestLine,
    type StudyShortestState,
} from "./useStudyMate";

type Side = "sente" | "gote";

const sideClass = (side: Side): string => (side === "sente" ? "text-wafuu-shu" : "text-wafuu-ai");
const sideMark = (side: Side): string => (side === "sente" ? "☗" : "☖");
const opponent = (side: Side): Side => (side === "sente" ? "gote" : "sente");
const king = (side: Side): string => `${sideMark(side)}玉`;

const LIMIT_SECONDS = STUDY_MATE_TIME_MS / 1000;
const UNKNOWN_TEXT = `${LIMIT_SECONDS} 秒では読み切れませんでした`;
const SHORTEST_LIMIT_SECONDS = STUDY_SHORTEST_MATE_TIME_MS / 1000;

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

/** 最短手順を求めている途中の表示（例: `最短手順を求めています（3 / 120 秒）`）。 */
export function studyShortestProgressText(
    state: StudyShortestState & { status: "running" },
    { short = false }: { short?: boolean } = {},
): string {
    const what = `最短手順を${short ? "求め中" : "求めています"}`;
    if (state.nodes === 0) return what;
    return `${what}（${Math.floor(state.elapsedMs / 1000)} / ${SHORTEST_LIMIT_SECONDS} 秒）`;
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
    caption,
    moves,
    unsupportedText,
    actions,
}: {
    /** どちらの玉の話か（例: `☗玉の詰み`）。 */
    label: string;
    /** 詰ませる側。 */
    mover: Side;
    result: MateResult;
    /** 調べるのに掛かった時間（ミリ秒）。 */
    elapsedMs: number;
    /** 見つけた手順の前に添える、何の手順かの説明。 */
    caption: string;
    moves: string[];
    /** 扱えない局面のときの文言（詰めろの行は扱えない局面を出さないので省く）。 */
    unsupportedText?: string;
    actions?: ReactElement;
}): ReactElement {
    return (
        <div className="flex items-baseline gap-2 px-1 py-1">
            <span className="w-20 shrink-0 text-xs text-muted-foreground">{label}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                {result.kind === "mate" ? (
                    <>
                        {/* 見つけた手順は最短とも、受けの最善とも限らないので「N 手詰め」とは言わない */}
                        <span className="flex flex-wrap items-baseline gap-x-1.5">
                            <span className={cn("text-sm font-medium", sideClass(mover))}>
                                あり
                            </span>
                            <span className="text-xs text-muted-foreground">
                                （{result.pv.length} 手・{formatMateSeconds(elapsedMs)}）
                            </span>
                        </span>
                        <p className="text-xs text-wafuu-sumi">{caption}</p>
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
    moveLabel,
    state,
    shortest,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    /** この局面に至った手の表記（例: `☗7六歩(77)`）。開始局面は null。 */
    moveLabel: string | null;
    state: StudyMateState | undefined;
    /** 最短手順。詰みがあると分かった局面で出す（渡さなければ出さない）。 */
    shortest?: StudyShortestProps;
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
                        moveLabel={moveLabel}
                        state={done}
                        onPreviewPv={onPreviewPv}
                        onAddPvAsVariation={onAddPvAsVariation}
                    />
                    {shortest && done.mate.kind === "mate" && (
                        <StudyShortestMate
                            node={node}
                            shortest={{
                                ...shortest,
                                disabled: shortest.disabled || state.status === "running",
                            }}
                            onPreviewPv={onPreviewPv}
                            onAddPvAsVariation={onAddPvAsVariation}
                        />
                    )}
                </div>
            )}
            <MateGlossary />
        </section>
    );
}

/** 言葉の説明。詰み・詰めろに慣れていない人向けなので、開いたときだけ出す。 */
function MateGlossary(): ReactElement {
    return (
        <details className="px-1 py-0.5 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">詰み・詰めろとは</summary>
            <dl className="flex flex-col gap-1 pt-1 leading-relaxed">
                <div>
                    <dt className="inline font-medium text-wafuu-sumi">詰み</dt>
                    <dd className="inline">
                        ：王手を続けて、相手がどう応じても最後には王手を防げなくなる手順があること。いまの手番の側が、相手の玉を詰ませられるかを調べます。
                    </dd>
                </div>
                <div>
                    <dt className="inline font-medium text-wafuu-sumi">詰めろ</dt>
                    <dd className="inline">
                        ：受けの手を指さないと、次に詰まされる状態。いまの手番の側がこの局面で何もしなかったら（手番を相手に渡したら）、王手の連続で自分の玉が詰まされるかを調べます。詰めろが掛かっている側は、受けるか、先に相手の玉を詰ませる必要があります。
                    </dd>
                </div>
                <div>
                    <dt className="inline font-medium text-wafuu-sumi">なし（読み切り）</dt>
                    <dd className="inline">
                        ：王手を続けて詰ませる手順が無いと、最後まで調べた結果です。時間内に調べ切れなかったときは「読み切れませんでした」と出します。
                    </dd>
                </div>
            </dl>
        </details>
    );
}

function MateResults({
    node,
    moveLabel,
    state,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    moveLabel: string | null;
    state: StudyMateState & { status: "done" };
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
}): ReactElement {
    const turn = node.positionAfter.turn;
    const { mate, mateMs, threat, threatMs } = state;
    const mateMoves = mate.kind === "mate" ? mateMovesText(node, mate.pv) : [];
    const threatMoves =
        threat?.kind === "mate"
            ? convertPvToDisplay(threat.pv, { ...node.positionAfter, turn: opponent(turn) }).map(
                  (move) => move.displayText,
              )
            : [];
    const request: StudyPvRequest | null =
        mate.kind === "mate" ? { nodeId: node.id, pv: mate.pv, score: null } : null;
    // 開始局面は直前の手が無いので、どの手が詰めろかは言わない
    const threatPrefix = moveLabel ? `${moveLabel} は詰めろ。` : "";
    return (
        <>
            <MateLine
                label={`${king(opponent(turn))}の詰み`}
                mover={turn}
                result={mate}
                elapsedMs={mateMs}
                caption={`${sideMark(turn)}が王手を続けて詰ませる手順`}
                moves={mateMoves}
                unsupportedText={
                    sidesWithoutKing(node.positionAfter).includes(opponent(turn))
                        ? "相手の玉が無い局面は調べられません"
                        : "王手を放置した局面（手番でない側の玉に王手が掛かっている）は調べられません"
                }
                actions={
                    request ? (
                        <PvActions
                            request={request}
                            onPreviewPv={onPreviewPv}
                            onAddPvAsVariation={onAddPvAsVariation}
                        />
                    ) : undefined
                }
            />
            {threat && threatMs !== null && (
                <MateLine
                    label={`${king(turn)}に詰めろ`}
                    mover={opponent(turn)}
                    result={threat}
                    elapsedMs={threatMs}
                    caption={`${threatPrefix}${sideMark(turn)}が受けないと、次の手順で詰まされる`}
                    moves={threatMoves}
                />
            )}
        </>
    );
}

/** 手番側の詰み手順の表記（1 手目は局面に至った手との同・不同を見て書く）。 */
function mateMovesText(node: KifuNode, pv: string[]): string[] {
    return [
        studyFirstMoveLabel(node, pv) ?? "",
        ...convertPvToDisplay(pv, node.positionAfter)
            .slice(1)
            .map((move) => move.displayText),
    ];
}

/** 詰み手順を盤で見る・変化として足すボタン。 */
function PvActions({
    request,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    request: StudyPvRequest;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
}): ReactElement {
    return (
        <div className="flex shrink-0 items-center self-start">
            <StudyIconButton label="詰み手順を盤で見る" onClick={() => onPreviewPv(request)}>
                <PlayIcon />
            </StudyIconButton>
            <StudyIconButton
                label="詰み手順を変化として追加"
                onClick={() => onAddPvAsVariation(request)}
            >
                <AddBranchIcon />
            </StudyIconButton>
        </div>
    );
}

/** 最短手順の段階ごとの言い方。推定・上限の手順は最短と言わない。 */
function shortestLineText({ stage, pv }: StudyShortestLine): string {
    switch (stage) {
        case "estimated":
            return `推定した手順（${pv.length} 手、未証明）`;
        case "bounded":
            return `${pv.length} 手以内に詰むことを証明`;
        case "proven":
            return `最短 ${pv.length} 手（証明済み）`;
    }
}

/** 最短手順の操作と結果を出す。 */
export interface StudyShortestProps {
    /** この局面の最短手順（求めていなければ undefined）。 */
    state: StudyShortestState | undefined;
    /** 準備中か、全体の解析・この局面の詰み探索の途中。 */
    disabled: boolean;
    onStart: () => void;
    onStop: () => void;
}

/**
 * 詰みのある局面の最短手順（詰将棋のルールで無駄合いを数えない）。求めている間は、途中で分かった手順
 * （推定 → N 手以内の証明）を順に出す。時間切れや中止で求め終わらなくても、分かった手順は残す。
 */
function StudyShortestMate({
    node,
    shortest,
    onPreviewPv,
    onAddPvAsVariation,
}: {
    node: KifuNode;
    shortest: StudyShortestProps;
    onPreviewPv: (request: StudyPvRequest) => void;
    onAddPvAsVariation: (request: StudyPvRequest) => void;
}): ReactElement {
    const { state, disabled, onStart, onStop } = shortest;
    const line = state && state.status !== "error" ? state.line : null;
    const finished = line?.stage === "proven";
    const request: StudyPvRequest | null = line
        ? { nodeId: node.id, pv: line.pv, score: null }
        : null;
    return (
        <div className="flex flex-col gap-0.5 px-1 py-1">
            <div className="flex items-center gap-2">
                <span className="w-20 shrink-0 text-xs text-muted-foreground">最短手順</span>
                <div className="flex min-w-0 flex-1 items-baseline">
                    {state?.status === "running" ? (
                        <output
                            aria-live="polite"
                            className="text-xs text-muted-foreground tabular-nums"
                        >
                            {studyShortestProgressText(state)}
                        </output>
                    ) : state?.status === "done" && !finished ? (
                        <span className="text-xs text-muted-foreground">
                            求め終わりませんでした
                        </span>
                    ) : state?.status === "error" ? (
                        <span role="alert" className="text-xs text-destructive">
                            {state.message}
                        </span>
                    ) : null}
                </div>
                {state?.status === "running" ? (
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        aria-label="最短手順を求めるのを中止"
                        className={COMPACT_BUTTON_CLASS}
                        onClick={onStop}
                    >
                        中止
                    </Button>
                ) : (
                    !finished && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            title={`詰将棋のルール（無駄合いを数えない）で最短の詰み手順を求めます（最大 ${SHORTEST_LIMIT_SECONDS} 秒）`}
                            className={COMPACT_BUTTON_CLASS}
                            onClick={onStart}
                            disabled={disabled}
                        >
                            最短手順を求める
                        </Button>
                    )
                )}
            </div>
            {line && request && (
                <div className="flex items-baseline gap-2">
                    <span className="w-20 shrink-0" />
                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <p className="text-xs text-wafuu-sumi">{shortestLineText(line)}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                            {mateMovesText(node, line.pv).join(" ")}
                        </p>
                        <p className="text-xs text-muted-foreground">
                            詰将棋のルールの手順なので、最後に受け方の無駄合いが残ることがあります
                        </p>
                    </div>
                    <PvActions
                        request={request}
                        onPreviewPv={onPreviewPv}
                        onAddPvAsVariation={onAddPvAsVariation}
                    />
                </div>
            )}
        </div>
    );
}

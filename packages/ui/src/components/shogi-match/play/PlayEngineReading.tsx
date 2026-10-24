/**
 * 対局画面の AI の読み。
 *
 * - 対局者の帯: AI が考えている間の深さ・局面数（考え終えたら、その手の値を残す）。押すと詳しく出す。
 * - 棋譜の欄の上: 盤に出している局面までで最後の AI の手の読み（評価値・読み筋・深さ・局面数・速さ）。
 *
 * 人が指している対局の途中は、評価値と読み筋を出さない（読み筋の 2 手目は人への次の一手の答えになる）。
 * 棋譜の評価値を出す設定にしているときと、終局後・AI 同士では出す。
 */

import type { Player, PositionState } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { EngineInfoEvent } from "@shogi/engine-client";
import type { ReactElement } from "react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "../../popover";
import { BottomSheet } from "../components/BottomSheet";
import { MobileKifuBar } from "../components/MobileKifuBar";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useIsMobile } from "../hooks/useMediaQuery";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import type { EngineSearchSummary, KifMove } from "../utils/kifFormat";
import { convertPvToDisplay, formatEval, getEvalTooltipInfo } from "../utils/kifFormat";
import { formatNodeCount } from "../utils/searchLimits";

/** 1 回の探索の読み。評価値は先手視点。 */
interface Reading extends EngineSearchSummary {
    /** 指した（考えている）側 */
    side: Player;
    /** 読み筋を始める局面 */
    pvStart?: PositionState;
}

/** 考えている途中の探索を、手ごとの記録と同じ形に直す（評価値は考えている側の視点で届く）。 */
function liveReadingOf(
    live: { side: Player; event: EngineInfoEvent },
    position: PositionState,
): Reading {
    const { side, event } = live;
    const sign = side === "sente" ? 1 : -1;
    return {
        side,
        depth: event.depth,
        seldepth: event.seldepth,
        nodes: event.nodes,
        nps: event.nps,
        timeMs: event.timeMs,
        scoreCp: event.scoreCp === undefined ? undefined : sign * event.scoreCp,
        scoreMate: event.scoreMate === undefined ? undefined : sign * event.scoreMate,
        pv: event.pv,
        pvStart: position,
    };
}

/** 指した手の記録から読みを作る。読み筋の先頭はその手なので、指した後の局面から続きを出す。 */
function recordedReadingOf(move: KifMove, positionAfter: PositionState | undefined): Reading {
    const search = move.engineSearch ?? {};
    const mover = move.mover ?? (move.ply % 2 === 1 ? "sente" : "gote");
    const pv = search.pv?.[0] === move.usiMove ? search.pv.slice(1) : undefined;
    return { ...search, side: mover, pv, pvStart: positionAfter };
}

/** 「深さ 18（最大 26）・52万局面・66万局面/秒」。 */
function statsText(reading: EngineSearchSummary): string {
    const parts: string[] = [];
    if (reading.depth !== undefined) {
        parts.push(
            reading.seldepth !== undefined && reading.seldepth > reading.depth
                ? `深さ ${reading.depth}（最大 ${reading.seldepth}）`
                : `深さ ${reading.depth}`,
        );
    }
    if (reading.nodes !== undefined) parts.push(`${formatNodeCount(reading.nodes)}局面`);
    if (reading.nps !== undefined && reading.nps > 0) {
        parts.push(`${formatNodeCount(reading.nps)}局面/秒`);
    }
    return parts.join("・");
}

function pvText(reading: Reading): string {
    if (!reading.pv || reading.pv.length === 0 || !reading.pvStart) return "";
    // 読み筋では移動元の「(77)」を省く（短くして 2 行に多くの手を入れる）。
    return convertPvToDisplay(reading.pv, reading.pvStart)
        .map((move) => move.displayText.replace(/\(\d+\)$/, ""))
        .join(" ");
}

/** 「11手目 ☗2三歩成 の読み」（移動元の「(24)」は省く）。 */
const readingTitle = (move: KifMove): string =>
    `${move.ply}手目 ${move.displayText.replace(/\(\d+\)$/, "")} の読み`;

const evalColor = (side: Player) => (side === "sente" ? "text-wafuu-shu" : "text-wafuu-ai");

/** 評価値と読み筋を見せてよいか（人が指している対局の途中は、棋譜の評価値を出す設定のときだけ）。 */
function useRevealEval(): boolean {
    const { play } = useShogiMatchConfig();
    const { sides, displaySettings } = useMatchState();
    const hasHuman = sides.sente.role === "human" || sides.gote.role === "human";
    return play?.phase === "finished" || !hasHuman || displaySettings.showKifuEval;
}

/** 盤に出している局面までで、最後に AI が指した手（読みの記録があるもの）。 */
function useLastEngineMove(owner?: Player): KifMove | undefined {
    const { kifMoves, navigationState } = useNavigation();
    for (let index = kifMoves.length - 1; index >= 0; index--) {
        const move = kifMoves[index];
        if (move.ply > navigationState.currentPly || !move.engineSearch) continue;
        const mover = move.mover ?? (move.ply % 2 === 1 ? "sente" : "gote");
        if (owner === undefined || mover === owner) return move;
    }
    return undefined;
}

/** 読みの詳しい中身（帯から開く）。 */
function ReadingDetail({
    title,
    reading,
    reveal,
}: {
    title: string;
    reading: Reading;
    reveal: boolean;
}): ReactElement {
    const hasEval = reading.scoreCp !== undefined || reading.scoreMate !== undefined;
    const pv = reveal ? pvText(reading) : "";
    const label = "w-14 shrink-0 text-xs text-wafuu-sumi-light";
    return (
        <div className="flex flex-col gap-2.5 text-sm text-wafuu-sumi">
            {title && <p className="font-semibold">{title}</p>}
            {reveal && hasEval && (
                <div className="flex items-baseline gap-3">
                    <span className={label}>評価値</span>
                    <span
                        className={cn(
                            "text-lg font-semibold tabular-nums",
                            evalColor(reading.side),
                        )}
                    >
                        {formatEval(reading.scoreCp, reading.scoreMate)}
                    </span>
                    <span className="text-xs text-wafuu-sumi-light">
                        {getEvalTooltipInfo(reading.scoreCp, reading.scoreMate).description}
                    </span>
                </div>
            )}
            {reveal && (
                <div className="flex items-baseline gap-3">
                    <span className={label}>読み筋</span>
                    {pv ? (
                        <span className="leading-relaxed">{pv}</span>
                    ) : (
                        <span className="text-xs text-wafuu-sumi-light">
                            この手は、続きの読み筋が届いていません。
                        </span>
                    )}
                </div>
            )}
            <div className="flex items-baseline gap-3">
                <span className={label}>読み</span>
                <span className="tabular-nums">{statsText(reading) || "—"}</span>
            </div>
            {!reveal && (
                <p className="text-xs text-wafuu-sumi-light">
                    評価値と読み筋は、終局後に棋譜の上に出します。
                </p>
            )}
        </div>
    );
}

/**
 * 対局者の帯に置く、AI の読みの数字（深さ・局面数）。考え中はその途中経過、考え終えたら最後の手の値。
 * 押すと詳しく出す（PC は帯の下、スマホは下から出るシート）。
 */
export function PlayBarReading({ owner }: { owner: Player }): ReactElement | null {
    const { play } = useShogiMatchConfig();
    const { position } = useMatchState();
    const { positionHistory } = useNavigation();
    const isMobile = useIsMobile();
    const reveal = useRevealEval();
    const [open, setOpen] = useState(false);
    const lastMove = useLastEngineMove(owner);
    const live = play?.liveSearch?.side === owner ? play.liveSearch : null;
    const reading = live
        ? liveReadingOf(live, position)
        : lastMove
          ? recordedReadingOf(lastMove, positionHistory[lastMove.ply - 1])
          : null;
    if (!reading || reading.depth === undefined) return null;
    const nodesText = reading.nodes !== undefined ? `・${formatNodeCount(reading.nodes)}局面` : "";
    const title = live ? "考えている手の読み" : lastMove ? readingTitle(lastMove) : "";
    const trigger = (
        <button
            type="button"
            aria-label={`AI の読み 深さ ${reading.depth}${nodesText}`}
            className={cn(
                "shrink-0 whitespace-nowrap rounded px-1 text-xs font-normal tabular-nums underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                live ? "text-wafuu-sumi" : "text-wafuu-sumi-light",
            )}
            onClick={isMobile ? () => setOpen(true) : undefined}
        >
            深さ {reading.depth}
            {/* 幅の狭い端末では、名前を削らないよう深さだけにする。 */}
            <span className="max-[479px]:hidden">{nodesText}</span>
        </button>
    );
    const detail = (
        <ReadingDetail title={isMobile ? "" : title} reading={reading} reveal={reveal} />
    );
    if (isMobile) {
        return (
            <>
                {trigger}
                <BottomSheet open={open} onOpenChange={setOpen} title={title} height="auto">
                    <div className="px-1 pb-4">{detail}</div>
                </BottomSheet>
            </>
        );
    }
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{trigger}</PopoverTrigger>
            <PopoverContent align="end" className="w-80 border-wafuu-border bg-background">
                {detail}
            </PopoverContent>
        </Popover>
    );
}

/**
 * スマホの終局後の棋譜の帯。いまの手が AI の手なら評価値を添え、もう一度押すとその手の読みを
 * 下から出すシートで詳しく出す（ほかの手を押すと、その局面へ移る）。
 */
export function PlayKifuStrip({
    showReading,
    className,
}: {
    showReading: boolean;
    className?: string;
}): ReactElement {
    const { kifMoves, navigationState, positionHistory, handlePlySelect } = useNavigation();
    const reveal = useRevealEval();
    const [open, setOpen] = useState(false);
    const move = kifMoves.find((candidate) => candidate.ply === navigationState.currentPly);
    const reading =
        showReading && move?.engineSearch
            ? recordedReadingOf(move, positionHistory[move.ply - 1])
            : null;
    const hasEval = reading && (reading.scoreCp !== undefined || reading.scoreMate !== undefined);
    return (
        <>
            <MobileKifuBar
                moves={kifMoves.map((kifMove) => ({
                    ply: kifMove.ply,
                    displayText: kifMove.displayText,
                }))}
                currentPly={navigationState.currentPly}
                onPlySelect={handlePlySelect}
                tone="wafuu"
                className={className}
                currentExtra={
                    reading ? (
                        <span className="ml-1 text-xs tabular-nums">
                            {reveal && hasEval && (
                                <span className={cn("font-semibold", evalColor(reading.side))}>
                                    {formatEval(reading.scoreCp, reading.scoreMate)}
                                </span>
                            )}
                            <span aria-hidden className="ml-1 font-normal text-wafuu-sumi-light">
                                ›
                            </span>
                        </span>
                    ) : undefined
                }
                onCurrentSelect={reading ? () => setOpen(true) : undefined}
            />
            {move && reading && (
                <BottomSheet
                    open={open}
                    onOpenChange={setOpen}
                    title={readingTitle(move)}
                    height="auto"
                >
                    <div className="px-1 pb-4">
                        <ReadingDetail title="" reading={reading} reveal={reveal} />
                    </div>
                </BottomSheet>
            )}
        </>
    );
}

/**
 * 棋譜の欄の上に置く、盤に出している局面までで最後の AI の手の読み。高さは固定して、手が進んでも
 * 下の棋譜を動かさない（読み筋は 2 行で切る）。
 */
export function PlayKifuReading({ className }: { className?: string }): ReactElement {
    const { positionHistory } = useNavigation();
    const reveal = useRevealEval();
    const move = useLastEngineMove();
    const reading = move ? recordedReadingOf(move, positionHistory[move.ply - 1]) : null;
    const heading = move ? readingTitle(move) : "AI の読み";
    const hasEval = reading && (reading.scoreCp !== undefined || reading.scoreMate !== undefined);
    const body = reading ? (
        <p className="text-xs tabular-nums text-wafuu-sumi-light">{statsText(reading) || "—"}</p>
    ) : (
        <p className="text-xs text-wafuu-sumi-light">AI が指すと、その手の読みをここに出します。</p>
    );
    return (
        <section
            aria-label="AI の読み"
            className={cn(
                "flex flex-col gap-1.5 rounded-lg bg-wafuu-border/40 px-3 py-2.5 text-sm text-wafuu-sumi",
                className,
            )}
        >
            <div className="flex items-center gap-3">
                {reveal && (
                    <div className="flex w-[4.5rem] shrink-0 flex-col items-center">
                        <span
                            className={cn(
                                "text-2xl font-semibold leading-none tabular-nums",
                                reading && hasEval
                                    ? evalColor(reading.side)
                                    : "text-wafuu-sumi-light",
                            )}
                        >
                            {reading && hasEval
                                ? formatEval(reading.scoreCp, reading.scoreMate)
                                : "—"}
                        </span>
                        <span className="mt-1 text-xs text-wafuu-sumi-light">評価値</span>
                    </div>
                )}
                <div className="flex min-w-0 flex-col gap-0.5">
                    <h3 className="truncate font-semibold">{heading}</h3>
                    {body}
                </div>
            </div>
            {reveal && (
                // 読み筋は 2 行分の高さを常に取り、長さが変わっても下を動かさない。
                <p className="line-clamp-2 min-h-[2.75rem] leading-relaxed">
                    {reading &&
                        (pvText(reading) || (
                            <span className="text-xs text-wafuu-sumi-light">
                                この手は、続きの読み筋が届いていません。
                            </span>
                        ))}
                </p>
            )}
        </section>
    );
}

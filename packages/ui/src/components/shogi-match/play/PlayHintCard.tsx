/**
 * 対局中のヒント。いまの局面の候補手と、その先の読み筋を出す欄。
 *
 * 評価関数は選ばせない（準備の済んでいるものを自動で使う）。押すと上限の時間まで読み続け、候補と読み筋を
 * 更新し続ける（「止める」で、そこまでの結果を残して止める）。結果はその局面を見ている間だけ出し、
 * 手が進んだら消える。いちばんの候補は盤にも示す（`usePlayHintMove`）。棋譜全体の解析は研究ノートで行う。
 */

import type { Player, PositionState } from "@shogi/app-core";
import { cn } from "@shogi/design-system";
import type { ReactElement, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Button } from "../../button";
import { cardVariants } from "../../card";
import type { AiHintMove } from "../components/AiHintPanel";
import { BottomSheet } from "../components/BottomSheet";
import { useMatchState } from "../contexts/MatchStateContext";
import { useNavigation } from "../contexts/NavigationContext";
import { useCurrentPositionAiHints } from "../hooks/useCurrentPositionAiHints";
import { hintPositionKey } from "../hooks/usePlayHintSearch";
import { useShogiMatchConfig } from "../ShogiMatchContext";
import { convertPvToDisplay } from "../utils/kifFormat";
import { formatNodeCount } from "../utils/searchLimits";
import { PLAY_OUTLINE_BUTTON } from "./playStyles";

/** 読み筋のうち、候補の手のあとに書く手の数。 */
const PV_SHOWN_MOVES = 7;

interface ShownHints {
    moves: AiHintMove[];
    /** 止めた・読み終えたあと、続きを読める（この局面のヒントを出していて、あなたの手番） */
    canContinue: boolean;
    /** 読み始めて、まだ候補が 1 つも無い */
    isThinking: boolean;
    isAnalyzing: boolean;
    /** この局面のヒントを読んでいる最中（候補が出たあとも、読み終えるまで） */
    isSearching: boolean;
}

/**
 * 読んでいる途中の候補を並べ直す。MultiPV の読み筋は 1 本ずつ届くので、途中では前の深さと今の深さの
 * 読み筋が混ざり、同じ手が 2 か所に出たり、2 番目のほうが評価が高かったりする。手ごとにいちばん深く
 * 読んだものだけを残し、手番の側から見て良い順に並べる。
 */
export function rankHintMoves(moves: AiHintMove[], turn: Player): AiHintMove[] {
    const deepest = new Map<string, AiHintMove>();
    for (const move of moves) {
        const current = deepest.get(move.usi);
        if (!current || (move.depth ?? 0) > (current.depth ?? 0)) deepest.set(move.usi, move);
    }
    const sign = turn === "sente" ? 1 : -1;
    // 詰みは評価値より強く、勝ちは早いほど・負けは遅いほど良い。
    const score = (move: AiHintMove): number => {
        if (move.evalMate !== undefined && move.evalMate !== null) {
            const mate = move.evalMate * sign;
            return mate > 0 ? 1e9 - mate : -1e9 - mate;
        }
        return (move.evalCp ?? 0) * sign;
    };
    return [...deepest.values()].sort((a, b) => score(b) - score(a));
}

/** ヒントを求めた局面を見ている間だけ、その結果を返す。 */
function useShownHints(): ShownHints {
    const { play } = useShogiMatchConfig();
    const { navigationState } = useNavigation();
    const { position, sides, moves: playedMoves } = useMatchState();
    const { moves, isAnalyzing } = useCurrentPositionAiHints({ maxMoves: play?.hintMultiPv });
    // 対局エンジンの読み筋を勝手に出さないよう、ヒントを求めた局面でだけ出す（手数でなく局面で照らし合わせる）。
    const isForThisPosition =
        play?.phase === "playing" &&
        play.hintPly === navigationState.currentPly &&
        play.hintStatus.positionKey ===
            hintPositionKey(play.startSfen, playedMoves.slice(0, navigationState.currentPly));
    const shown = isForThisPosition ? rankHintMoves(moves, position.turn) : [];
    const hintPhase = play?.hintStatus.phase;
    const isSearching =
        isForThisPosition && (hintPhase === "preparing" || hintPhase === "searching");
    const isMyTurn = play?.phase === "playing" && sides[position.turn].role === "human";
    return {
        moves: shown,
        // 続きを読めるのは、読みの状態を残してあるとき（再開できるエンジン）だけ。
        canContinue:
            isForThisPosition && !isSearching && isMyTurn && play?.hintStatus.canContinue === true,
        isThinking: isSearching && shown.length === 0,
        isAnalyzing,
        isSearching,
    };
}

/** 読み始めてからの秒数。読んでいる間は刻々と進め、読み終えたらその時刻で止める。 */
function useHintElapsedSeconds(
    startedAt: number | null,
    endedAt: number | null,
    running: boolean,
): number | null {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!running) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 500);
        return () => clearInterval(timer);
    }, [running]);
    if (startedAt === null) return null;
    return Math.max(0, Math.floor(((running ? now : (endedAt ?? now)) - startedAt) / 1000));
}

/** 「深さ 18 ・ 120万局面 ・ 12秒」（止めどきの目安）。候補がまだ無ければ分かるものだけ。 */
function HintSearchStatus({ moves, className }: { moves: AiHintMove[]; className?: string }) {
    const { play } = useShogiMatchConfig();
    const { isSearching } = useShownHints();
    const status = play?.hintStatus;
    const seconds = useHintElapsedSeconds(
        status?.startedAt ?? null,
        status?.endedAt ?? null,
        isSearching,
    );
    const depth = moves[0]?.depth;
    if (seconds === null || (!isSearching && moves.length === 0)) return null;
    const parts = [
        depth !== undefined ? `深さ ${depth}` : null,
        status?.nodes ? `${formatNodeCount(status.nodes)}局面` : null,
        `${seconds}秒`,
    ].filter((part): part is string => part !== null);
    return (
        <span
            className={cn(
                "whitespace-nowrap text-xs tabular-nums text-wafuu-sumi-light",
                className,
            )}
        >
            {parts.join(" ・ ")}
        </span>
    );
}

/** 読み筋のうち、候補の手のあとを「△3四歩 ▲2六歩 …」と書く。 */
function describePv(move: AiHintMove, position: PositionState): string {
    const pv = move.pv ?? [];
    if (pv.length < 2) return "";
    const rest = convertPvToDisplay(pv, position).slice(1, 1 + PV_SHOWN_MOVES);
    const more = pv.length > 1 + PV_SHOWN_MOVES ? " …" : "";
    return rest.map((item) => item.displayText).join(" ") + more;
}

/** 候補の一覧。押すと、その候補の読み筋を盤で順に見られる。 */
function HintCandidateList({
    moves,
    onSelect,
}: {
    moves: AiHintMove[];
    /** 候補を押したとき（読み筋の盤を開く前に、シートを閉じるのに使う） */
    onSelect?: () => void;
}): ReactElement {
    const { position } = useMatchState();
    const { navigationState, handlePreviewPv } = useNavigation();
    return (
        <ol className="flex flex-col gap-1" aria-live="polite">
            {moves.map((move, index) => {
                const evaluation = describeEval(move, position.turn);
                const pvText = describePv(move, position);
                return (
                    <li key={move.usi}>
                        <button
                            type="button"
                            disabled={!move.pv?.length}
                            onClick={() => {
                                if (!move.pv?.length) return;
                                onSelect?.();
                                handlePreviewPv(
                                    navigationState.currentPly,
                                    move.pv,
                                    move.evalCp,
                                    move.evalMate,
                                    position,
                                );
                            }}
                            className={cn(
                                "flex w-full flex-col gap-0.5 rounded-md px-2 py-1 text-left text-sm transition-colors hover:bg-wafuu-washi-warm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                index === 0 && "bg-background",
                            )}
                        >
                            <span className="flex w-full items-baseline gap-2">
                                <span className="w-14 shrink-0 whitespace-nowrap text-xs text-wafuu-sumi-light">
                                    {index === 0 ? "おすすめ" : `${index + 1}番目`}
                                </span>
                                <span
                                    className={cn(
                                        "flex-1 text-wafuu-sumi",
                                        index === 0 && "font-semibold",
                                    )}
                                >
                                    {move.displayText}
                                </span>
                                <span className="shrink-0 text-xs text-wafuu-sumi">
                                    {evaluation.text}
                                    {move.scoreText && (
                                        <span
                                            className={cn(
                                                "pl-1 tabular-nums",
                                                position.turn === "sente"
                                                    ? "text-wafuu-shu"
                                                    : "text-wafuu-ai",
                                            )}
                                        >
                                            {move.scoreText}
                                        </span>
                                    )}
                                </span>
                            </span>
                            {pvText && (
                                <span className="truncate pl-16 text-xs text-wafuu-sumi-light">
                                    {pvText}
                                </span>
                            )}
                        </button>
                    </li>
                );
            })}
        </ol>
    );
}

/** 盤に示すヒントの手（いちばんの候補）。無ければ null。 */
export function usePlayHintMove(): { from: string | null; to: string; side: Player } | null {
    const { position } = useMatchState();
    const { moves } = useShownHints();
    const side = position.turn;
    const usi = moves[0]?.usi;
    if (!usi) return null;
    // 打つ手は "P*5e"、動かす手は "7g7f" / "7g7f+"
    if (usi[1] === "*") return { from: null, to: usi.slice(2, 4), side };
    return { from: usi.slice(0, 2), to: usi.slice(2, 4), side };
}

/** 評価値を、手番の人から見た言葉にする。 */
export function describeEval(
    move: Pick<AiHintMove, "evalCp" | "evalMate">,
    viewer: Player,
): { text: string; tone: "good" | "bad" | "even" } {
    const sign = viewer === "sente" ? 1 : -1;
    if (move.evalMate !== undefined && move.evalMate !== null) {
        return move.evalMate * sign > 0
            ? { text: "詰みがあります", tone: "good" }
            : { text: "詰まされそうです", tone: "bad" };
    }
    if (move.evalCp === undefined || move.evalCp === null) return { text: "", tone: "even" };
    const value = move.evalCp * sign;
    const size = Math.abs(value);
    if (size < 150) return { text: "互角", tone: "even" };
    const good = value > 0;
    const word =
        size < 500
            ? good
                ? "やや有利"
                : "やや不利"
            : size < 1200
              ? good
                  ? "有利"
                  : "不利"
              : size < 2500
                ? good
                    ? "優勢"
                    : "劣勢"
                : good
                  ? "勝勢"
                  : "敗勢";
    return { text: word, tone: good ? "good" : "bad" };
}

interface PlayHintCardProps {
    /** 枠で囲まず、詰めて出す（スマホの盤の下） */
    compact?: boolean;
    className?: string;
}

export function PlayHintCard({ compact = false, className }: PlayHintCardProps): ReactElement {
    const { play } = useShogiMatchConfig();
    const { position, sides, gameMode } = useMatchState();
    const { moves, isThinking, isAnalyzing, isSearching, canContinue } = useShownHints();
    const continueHint = () => play?.resumeHint();

    const isMyTurn = gameMode === "playing" && sides[position.turn].role === "human";
    const idleText =
        gameMode === "paused"
            ? "一時停止中は使えません。"
            : isMyTurn
              ? "AI が勧める手を、盤に枠で示します。"
              : "あなたの手番で使えます。";

    return (
        <section
            aria-label="ヒント"
            className={cn(
                "flex flex-col gap-2",
                !compact && cn(cardVariants({ variant: "washi" }), "p-4"),
                className,
            )}
        >
            <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-wafuu-sumi">ヒント</h2>
                <HintSearchStatus moves={moves} className="ml-auto" />
                {/* 出し直しはしない（押すたびに答えが変わると、どれを信じるか迷う）。読み足すだけにする。 */}
                {isSearching ? (
                    <Button
                        type="button"
                        variant="outline"
                        className={cn(PLAY_OUTLINE_BUTTON, "ml-auto shrink-0")}
                        onClick={() => play?.stopHint()}
                    >
                        止める
                    </Button>
                ) : moves.length > 0 ? (
                    canContinue && (
                        <Button
                            type="button"
                            variant="outline"
                            className={cn(PLAY_OUTLINE_BUTTON, "ml-auto shrink-0")}
                            onClick={continueHint}
                        >
                            続けて読む
                        </Button>
                    )
                ) : (
                    <Button
                        type="button"
                        variant="outline"
                        className={cn(PLAY_OUTLINE_BUTTON, "ml-auto shrink-0")}
                        onClick={() => play?.requestHint()}
                        disabled={!isMyTurn || isAnalyzing}
                    >
                        ヒントを見る
                    </Button>
                )}
            </div>
            {moves.length > 0 ? (
                <>
                    <HintCandidateList moves={moves} />
                    <p className="text-[11px] text-wafuu-sumi-light">
                        候補を押すと、読み筋を盤で見られます。
                    </p>
                </>
            ) : (
                <p className="text-xs leading-relaxed text-wafuu-sumi-light" aria-live="polite">
                    {isThinking ? "候補手を調べています…" : idleText}
                </p>
            )}
        </section>
    );
}

/** ヒントを求めるボタン（スマホの操作の行に置く）。読んでいる間は「止める」になる。 */
export function PlayHintButton({ className }: { className?: string }): ReactElement {
    const { play } = useShogiMatchConfig();
    const { position, sides, gameMode } = useMatchState();
    const { moves, isAnalyzing, isSearching, canContinue } = useShownHints();
    const continueHint = () => play?.resumeHint();
    const isMyTurn = gameMode === "playing" && sides[position.turn].role === "human";
    if (canContinue) {
        return (
            <Button
                type="button"
                variant="outline"
                className={cn(PLAY_OUTLINE_BUTTON, className)}
                onClick={continueHint}
            >
                続けて読む
            </Button>
        );
    }
    if (isSearching) {
        return (
            // 隣に「一時停止」が並ぶことがあるので、何を止めるかを書く。幅の狭い端末では文字を小さくする。
            <Button
                type="button"
                variant="outline"
                className={cn(PLAY_OUTLINE_BUTTON, className, "max-[449px]:text-[11px]")}
                onClick={() => play?.stopHint()}
            >
                読みを止める
            </Button>
        );
    }
    return (
        <Button
            type="button"
            variant="outline"
            className={cn(PLAY_OUTLINE_BUTTON, className)}
            onClick={() => play?.requestHint()}
            disabled={!isMyTurn || isAnalyzing || moves.length > 0}
        >
            ヒント
        </Button>
    );
}

/**
 * ヒントの結果を 1 行で出す（スマホの盤のすぐ下）。結果が無いときは `fallback` を出す。
 * 盤の枠と合わせて読むので、いちばんの候補だけを書く。押すと、全部の候補と読み筋を下から出す。
 */
export function PlayHintLine({
    fallback,
    className,
}: {
    fallback: ReactNode;
    className?: string;
}): ReactElement {
    const { play } = useShogiMatchConfig();
    const { position } = useMatchState();
    const { moves, isThinking, isSearching, canContinue } = useShownHints();
    const continueHint = () => play?.resumeHint();
    const [sheetOpen, setSheetOpen] = useState(false);
    const best = moves[0];
    if (!best) {
        return (
            <div className={className} aria-live="polite">
                {isThinking ? (
                    <span className="text-sm text-wafuu-sumi-light">候補手を調べています…</span>
                ) : (
                    fallback
                )}
            </div>
        );
    }
    const evaluation = describeEval(best, position.turn);
    return (
        <>
            <button
                type="button"
                onClick={() => setSheetOpen(true)}
                aria-label="ヒントの候補と読み筋を見る"
                className={cn(
                    "flex items-baseline gap-2 rounded text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    className,
                )}
            >
                <span className="shrink-0 rounded border border-wafuu-sumi px-1.5 py-0.5 text-xs font-semibold text-wafuu-sumi">
                    ヒント
                </span>
                <span className="truncate font-semibold text-wafuu-sumi">{best.displayText}</span>
                <span className="shrink-0 text-xs text-wafuu-sumi">
                    {evaluation.text}
                    {best.scoreText && (
                        <span
                            className={cn(
                                "pl-1 tabular-nums",
                                position.turn === "sente" ? "text-wafuu-shu" : "text-wafuu-ai",
                            )}
                        >
                            {best.scoreText}
                        </span>
                    )}
                </span>
                {best.depth !== undefined && (
                    <span className="shrink-0 text-xs tabular-nums text-wafuu-sumi-light">
                        深さ{best.depth}
                    </span>
                )}
                {/* 押すと、全部の候補と読み筋が下から出る */}
                <span
                    aria-hidden
                    className="shrink-0 self-center text-base leading-none text-wafuu-sumi-light"
                >
                    ›
                </span>
            </button>
            <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen} title="ヒント" height="auto">
                <div className="flex flex-col gap-2 px-1 pb-4">
                    <div className="flex min-h-10 items-center gap-2">
                        <HintSearchStatus moves={moves} />
                        {isSearching ? (
                            <Button
                                type="button"
                                variant="outline"
                                className={cn(PLAY_OUTLINE_BUTTON, "ml-auto")}
                                onClick={() => play?.stopHint()}
                            >
                                止める
                            </Button>
                        ) : (
                            canContinue && (
                                <Button
                                    type="button"
                                    variant="outline"
                                    className={cn(PLAY_OUTLINE_BUTTON, "ml-auto")}
                                    onClick={continueHint}
                                >
                                    続けて読む
                                </Button>
                            )
                        )}
                    </div>
                    <HintCandidateList moves={moves} onSelect={() => setSheetOpen(false)} />
                    <p className="text-[11px] text-wafuu-sumi-light">
                        候補を押すと、読み筋を盤で見られます。
                    </p>
                </div>
            </BottomSheet>
        </>
    );
}
